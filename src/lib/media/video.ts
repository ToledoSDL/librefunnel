import "server-only";
import { execFile } from "node:child_process";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { setPriority } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataDir } from "../db";
import { sendToBucket } from "./backup";
import { bucket, call, listBucket, presign, putFolder } from "./bucket";
import type { Bucket } from "./bucket";
import { FILE, FOLDER, ORIGINAL, PREFIX, mediaDir } from "./files";
import { streams } from "./serving";

const PART_TTL_MS = 86_400_000;

const PROBE_TIMEOUT_MS = 60_000;

// Long enough for a 1 GB video at the lowest priority on one core; only a hung ffmpeg reaches it.
const ENCODE_TIMEOUT_MS = 4 * 3_600_000;

const run = promisify(execFile);

const RENDITIONS = [
  { height: 360, kbps: 800 },
  { height: 720, kbps: 2800 },
  { height: 1080, kbps: 5000 },
];

async function probe(source: string, stream: string, entries: string): Promise<string> {
  const { stdout } = await run(
    "ffprobe",
    [
      ["-v", "error", "-protocol_whitelist", "file", "-select_streams", stream],
      ["-show_entries", `stream=${entries}`, "-of", "csv=p=0", source],
    ].flat(),
    { timeout: PROBE_TIMEOUT_MS },
  );

  return stdout.trim();
}

// Renditions go to `<out>.tmp` and are renamed to `<out>` only when complete, so a half-finished stream is never served.
async function transcode(source: string, out: string): Promise<void> {
  const temp = `${out}.tmp`;
  const [size, audio] = await Promise.all([probe(source, "v:0", "width,height"), probe(source, "a:0", "index")]);
  const [width = 0, height = 0] = size.split(",").map(Number);
  const short = Math.min(width, height);
  const fitting = RENDITIONS.filter((rendition) => rendition.height <= short);
  const renditions = fitting.length ? fitting : [{ height: short - (short % 2), kbps: 800 }];
  const scale = (target: number) => (width >= height ? `-2:${target}` : `${target}:-2`);

  const graph = [
    `[0:v]split=${renditions.length}${renditions.map((rendition) => `[s${rendition.height}]`).join("")}`,
    ...renditions.map((rendition) => `[s${rendition.height}]scale=${scale(rendition.height)}[v${rendition.height}]`),
  ].join(";");

  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });

  // ffmpeg puts each init segment next to its playlist by the last "/", so output paths use "/" even on Windows.
  const encoding = run(
    "ffmpeg",
    [
      ["-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file", "-i", source, "-filter_complex", graph],
      renditions.flatMap((rendition, index) => [
        "-map",
        `[v${rendition.height}]`,
        ...(audio ? ["-map", "0:a:0"] : []),
        `-b:v:${index}`,
        `${rendition.kbps}k`,
        `-maxrate:v:${index}`,
        `${Math.round(rendition.kbps * 1.07)}k`,
        `-bufsize:v:${index}`,
        `${rendition.kbps * 1.5}k`,
      ]),
      ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-profile:v", "main"],
      ["-sc_threshold", "0", "-force_key_frames", "expr:gte(t,n_forced*6)"],
      ["-c:a", "aac", "-b:a", "128k", "-ac", "2"],
      ["-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4"],
      ["-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", `${temp}/%v/%d.m4s`],
      ["-master_pl_name", "master.m3u8", "-var_stream_map"],
      [
        renditions
          .map((rendition, index) => `v:${index}${audio ? `,a:${index}` : ""},name:${rendition.height}`)
          .join(" "),
      ],
      [`${temp}/%v/index.m3u8`],
    ].flat(),
    // A file that makes ffmpeg hang would otherwise hold the one transcoding slot until a restart.
    { timeout: ENCODE_TIMEOUT_MS },
  );

  // Lowest CPU priority: on a one-core server a long encode must not slow down the pages buyers are loading.
  if (encoding.child.pid) setPriority(encoding.child.pid, 19);
  await encoding;
  await rename(temp, out);
}

async function download(target: Bucket, key: string, path: string): Promise<void> {
  const response = await fetch(presign(target, "GET", key, "private"));
  if (!response.ok || !response.body) throw new Error(`download of ${key} answered ${response.status}`);
  const reader = response.body.getReader();
  const handle = await open(path, "w");

  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) await handle.write(chunk.value);
  } finally {
    await handle.close();
  }
}

// The bucket keeps only the original, so the job brings it to a scratch folder, converts it there and sends the stream back.
async function transcodeRemote(target: Bucket, id: string, name: string): Promise<void> {
  const work = join(dataDir(), "transcode");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  try {
    await download(target, `${PREFIX}${name}`, join(work, name));
    await transcode(join(work, name), join(work, id));
    await putFolder(target, id, join(work, id));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export let busy = false;

const failed = new Set<string>();

// One job at a time, started without awaiting: a long video takes minutes and must not hold up the rest of the loop.
function runJob(id: string, job: () => Promise<void>) {
  busy = true;
  void job()
    .catch((error) => {
      failed.add(id);
      console.warn(`[librefunnel] media job for ${id} failed`, error);
    })
    .finally(() => {
      busy = false;
    });
}

export async function transcodeVideos(): Promise<void> {
  if (busy) return;
  const target = await bucket();
  const names = await readdir(mediaDir()).catch((): string[] => []);
  const abandoned = Date.now() - PART_TTL_MS;

  // An upload cut by a crash or a restart leaves its .part file; one a day old is not being written anymore.
  for (const name of names.filter((entry) => entry.endsWith(".part"))) {
    const path = join(mediaDir(), name);
    const modified = (await stat(path).catch(() => undefined))?.mtimeMs ?? Infinity;
    if (modified < abandoned) await rm(path, { force: true });
  }

  if (target) {
    const local = names.find((name) => (FILE.test(name) || FOLDER.test(name)) && !failed.has(name));
    if (local) return runJob(local, () => sendToBucket(target, local));
    const { files, folders } = await listBucket(target);
    const originals = files.filter((name) => ORIGINAL.test(name) && !failed.has(name.slice(0, 32)));
    let pending = originals.find((name) => !folders.has(name.slice(0, 32)));

    // A folder without its master playlist is an upload cut short by a restart: convert that video again.
    for (const name of pending ? [] : originals) {
      const id = name.slice(0, 32);
      if (streams.has(id)) continue;
      if ((await call(target, "HEAD", `${PREFIX}${id}/master.m3u8`)).ok) streams.add(id);
      else {
        pending = name;
        break;
      }
    }

    const chosen = pending;
    if (chosen) runJob(chosen.slice(0, 32), () => transcodeRemote(target, chosen.slice(0, 32), chosen));
    return;
  }

  const existing = new Set(names);

  const pending = names.find((name) => {
    const id = ORIGINAL.exec(name)?.[1];
    return id && !existing.has(id) && !failed.has(id);
  });

  if (!pending) return;
  const id = pending.slice(0, 32);
  runJob(id, () =>
    transcode(join(mediaDir(), pending), join(mediaDir(), id)).catch(async (error) => {
      await rm(join(mediaDir(), `${id}.tmp`), { recursive: true, force: true });
      throw error;
    }),
  );
}
