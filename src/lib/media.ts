import "server-only";
import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { setPriority } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq, inArray, or, sql } from "drizzle-orm";
import { credentials, saveCredentials } from "./catalog";
import { dataDir, db } from "./db";
import { baseUrl, demoMode, isAdmin, isObject, jsonObject, readBody } from "./guard";
import { currentMember } from "./members";
import { lesson, module, product, recoveryStep, reply as autoReply, setting } from "./schema";

export type MediaCode = "MEDIA_TYPE" | "MEDIA_TOO_LARGE" | "UPLOAD_FAILED";
export type StorageCode =
  | "STORAGE_UNREACHABLE"
  | "STORAGE_DENIED"
  | "STORAGE_NO_BUCKET"
  | "STORAGE_CORS"
  | "INVALID_ENDPOINT"
  | "INVALID_BUCKET"
  | "CLOUDFLARE_TOKEN_INVALID"
  | "CLOUDFLARE_PERMISSION"
  | "CLOUDFLARE_R2_DISABLED";

export type Bucket = { endpoint: string; name: string; region: string; accessKey: string; secret: string };
type Visibility = "public" | "private";

const VIDEO_MAX = 1024 ** 3;
const IMAGE_MAX = 10 * 1024 ** 2;
const CAPTIONS_MAX = 1024 ** 2;
const CHUNK = 256 * 1024;
const PART = 16 * 1024 ** 2;
const PART_TTL_MS = 86_400_000;
const ORPHAN_AGE_MS = 30 * 86_400_000;
// The id is the first 32 hex characters of every file a media upload creates: the original, its stream folder, temp files.
const MEDIA_ID = /^([a-f0-9]{32})(?:[./]|$)/;
const ID_TEXT = "([a-f0-9]{32})";
const PROBE_TIMEOUT_MS = 60_000;
// Long enough for a 1 GB video at the lowest priority on one core; only a hung ffmpeg reaches it.
const ENCODE_TIMEOUT_MS = 4 * 3_600_000;
const FILE = /^[a-f0-9]{32}\.(mp4|webm|jpg|png|webp|vtt)$/;
const FOLDER = /^[a-f0-9]{32}$/;
const ORIGINAL = /^([a-f0-9]{32})\.(?:mp4|webm)$/;
const STREAM = /^([a-f0-9]{32})\/(?:master\.m3u8|\d{2,4}\/(?:index\.m3u8|init(?:_\d)?\.mp4|\d{1,5}\.m4s))$/;
const UPLOAD_ID = /^[\x21-\x7e]{1,1024}$/;
const ETAG = /^"?[\w-]{1,128}"?$/;
const PREFIX = "media/";
const run = promisify(execFile);

// Signed links are cut on fixed windows, so the same file keeps the same URL for a while and the browser can cache it.
const LINKS: Record<Visibility, { window: number; expires: number; cache: string }> = {
  public: { window: 86_400, expires: 604_800, cache: "public, max-age=3600" },
  private: { window: 300, expires: 900, cache: "private, no-store" },
};

const STREAM_TYPES = [
  { ext: "m3u8", mime: "application/vnd.apple.mpegurl" },
  { ext: "m4s", mime: "video/iso.segment" },
  { ext: "mp4", mime: "video/mp4" },
];

const RENDITIONS = [
  { height: 360, kbps: 800 },
  { height: 720, kbps: 2800 },
  { height: 1080, kbps: 5000 },
];

// SVG is left out on purpose: served from our origin it could run script.
const TYPES = [
  { ext: "mp4", mime: "video/mp4", max: VIDEO_MAX, sniff: (head: Buffer) => head.toString("latin1", 4, 8) === "ftyp" },
  { ext: "webm", mime: "video/webm", max: VIDEO_MAX, sniff: (head: Buffer) => head.readUInt32BE(0) === 0x1a45dfa3 },
  { ext: "jpg", mime: "image/jpeg", max: IMAGE_MAX, sniff: (head: Buffer) => head.toString("hex", 0, 3) === "ffd8ff" },
  {
    ext: "png",
    mime: "image/png",
    max: IMAGE_MAX,
    sniff: (head: Buffer) => head.toString("hex", 0, 8) === "89504e470d0a1a0a",
  },
  {
    ext: "webp",
    mime: "image/webp",
    max: IMAGE_MAX,
    sniff: (head: Buffer) => head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP",
  },
  {
    ext: "vtt",
    mime: "text/vtt",
    max: CAPTIONS_MAX,
    sniff: (head: Buffer) => /^(\xef\xbb\xbf)?WEBVTT/.test(head.toString("latin1")),
  },
];

function mediaDir(): string {
  return join(dataDir(), "media");
}

function reply(code: MediaCode | "NOT_SIGNED_IN", status: number): Response {
  return Response.json({ code }, { status });
}

function typeOf(name: string) {
  return TYPES.find((entry) => entry.ext === name.toLowerCase().split(".").pop()?.replace("jpeg", "jpg"));
}

function mimeOf(file: string): string | undefined {
  return STREAM.test(file)
    ? STREAM_TYPES.find((entry) => file.endsWith(`.${entry.ext}`))?.mime
    : TYPES.find((entry) => entry.ext === FILE.exec(file)?.[1])?.mime;
}

// Pull-based so a slow phone downloading a long video never makes the server read ahead into memory.
async function fileStream(path: string, start: number, end: number): Promise<ReadableStream<Uint8Array>> {
  const handle = await open(path);
  let position = start;
  return new ReadableStream({
    async pull(controller) {
      const length = Math.max(0, Math.min(CHUNK, end + 1 - position));
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, position);
      if (bytesRead === 0) {
        await handle.close();
        controller.close();
        return;
      }
      position += bytesRead;
      controller.enqueue(buffer.subarray(0, bytesRead));
    },
    cancel: () => handle.close(),
  });
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

// AWS Signature Version 4: a header signature for server calls, or a presigned URL when `expires` is set.
export function sign(
  target: Pick<Bucket, "endpoint" | "region" | "accessKey" | "secret">,
  request: {
    method: string;
    path: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    payload?: string;
    at?: Date;
    expires?: number;
  },
): { url: string; headers: Record<string, string> } {
  const stamp = (request.at ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${stamp.slice(0, 8)}/${target.region}/s3/aws4_request`;
  const origin = new URL(target.endpoint);
  const payload = request.payload ?? "UNSIGNED-PAYLOAD";
  const presigned = request.expires !== undefined;

  const headers: Record<string, string> = {
    host: origin.host,
    ...Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
    ...(presigned ? {} : { "x-amz-content-sha256": payload, "x-amz-date": stamp }),
  };

  const names = Object.keys(headers).sort();

  const query: Record<string, string> = {
    ...request.query,
    ...(presigned
      ? {
          "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
          "X-Amz-Credential": `${target.accessKey}/${scope}`,
          "X-Amz-Date": stamp,
          "X-Amz-Expires": String(request.expires),
          "X-Amz-SignedHeaders": names.join(";"),
        }
      : {}),
  };

  const search = Object.entries(query)
    .map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`)
    .sort()
    .join("&");

  const canonical = [
    request.method,
    request.path,
    search,
    names.map((name) => `${name}:${(headers[name] ?? "").trim()}\n`).join(""),
    names.join(";"),
    presigned ? "UNSIGNED-PAYLOAD" : payload,
  ].join("\n");

  const key = ["s3", "aws4_request"].reduce(hmac, hmac(hmac(`AWS4${target.secret}`, stamp.slice(0, 8)), target.region));

  const signature = hmac(key, ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n")).toString("hex");
  const url = `${origin.origin}${request.path}${search ? `?${search}` : ""}`;
  if (presigned) return { url: `${url}&X-Amz-Signature=${signature}`, headers: {} };

  return {
    url,
    headers: {
      ...Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host")),
      authorization: `AWS4-HMAC-SHA256 Credential=${target.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
  };
}

async function bucket(): Promise<Bucket | undefined> {
  const stored = (await credentials("storage"))("storage");

  const target = {
    endpoint: stored("endpoint"),
    name: stored("bucket"),
    region: stored("region") || "auto",
    accessKey: stored("accessKey"),
    secret: stored("secret"),
  };

  return target.endpoint && target.name && target.accessKey && target.secret ? target : undefined;
}

function objectPath(target: Bucket, key: string): string {
  return `/${rfc3986(target.name)}${key ? `/${key.split("/").map(rfc3986).join("/")}` : ""}`;
}

function call(
  target: Bucket,
  method: string,
  key: string,
  options: { query?: Record<string, string>; headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<Response> {
  const { url, headers } = sign(target, {
    method,
    path: objectPath(target, key),
    query: options.query,
    headers: options.headers,
    payload: sha256(options.body ?? ""),
  });

  const body =
    typeof options.body === "string" || options.body === undefined ? options.body : new Uint8Array(options.body);

  return fetch(url, { method, headers, body, signal: AbortSignal.timeout(120_000) });
}

function presign(target: Bucket, method: string, key: string, visibility: Visibility, query?: Record<string, string>) {
  const { window, expires } = LINKS[visibility];
  const at = new Date(Math.floor(Date.now() / (window * 1000)) * window * 1000);
  return sign(target, { method, path: objectPath(target, key), query, at, expires }).url;
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((match) =>
    (match[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

async function startMultipart(target: Bucket, key: string, mime: string): Promise<string | undefined> {
  const response = await call(target, "POST", key, { query: { uploads: "" }, headers: { "content-type": mime } });
  return response.ok ? xmlValues(await response.text(), "UploadId")[0] : undefined;
}

// S3 can answer 200 with an <Error> body when completing, so the body is checked too.
async function finishMultipart(
  target: Bucket,
  key: string,
  uploadId: string,
  parts: { number: number; etag: string }[],
): Promise<boolean> {
  const body = `<CompleteMultipartUpload>${parts
    .map((part) => `<Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;

  const response = await call(target, "POST", key, { query: { uploadId }, body });
  return response.ok && !(await response.text()).includes("<Error>");
}

async function putFile(target: Bucket, key: string, path: string, mime: string): Promise<void> {
  const { size } = await stat(path);

  if (size <= PART) {
    const response = await call(target, "PUT", key, { headers: { "content-type": mime }, body: await readFile(path) });
    if (!response.ok) throw new Error(`upload of ${key} answered ${response.status}`);
    return;
  }

  const uploadId = await startMultipart(target, key, mime);
  if (!uploadId) throw new Error(`upload of ${key} could not start`);
  const handle = await open(path);
  const parts: { number: number; etag: string }[] = [];

  try {
    for (let number = 1; (number - 1) * PART < size; number += 1) {
      const length = Math.min(PART, size - (number - 1) * PART);
      const { buffer } = await handle.read(Buffer.alloc(length), 0, length, (number - 1) * PART);

      const response = await call(target, "PUT", key, {
        query: { partNumber: String(number), uploadId },
        body: buffer,
      });

      const etag = response.headers.get("etag");
      if (!response.ok || !etag) throw new Error(`part ${number} of ${key} answered ${response.status}`);
      parts.push({ number, etag });
    }
  } finally {
    await handle.close();
  }

  if (!(await finishMultipart(target, key, uploadId, parts))) throw new Error(`upload of ${key} could not finish`);
}

async function filesIn(dir: string, base = ""): Promise<string[]> {
  const entries = await readdir(join(dir, base), { withFileTypes: true });

  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? filesIn(dir, join(base, entry.name)) : [join(base, entry.name).replaceAll("\\", "/")],
    ),
  );

  return nested.flat();
}

// The master playlist goes last: its presence in the bucket is what marks a stream as complete.
async function putFolder(target: Bucket, id: string, dir: string): Promise<void> {
  const files = (await filesIn(dir)).sort((a, b) => Number(a === "master.m3u8") - Number(b === "master.m3u8"));

  for (const file of files) {
    await putFile(
      target,
      `${PREFIX}${id}/${file}`,
      join(dir, file),
      mimeOf(`${id}/${file}`) ?? "application/octet-stream",
    );
  }
}

async function* listing(target: Bucket, query: Record<string, string>): AsyncGenerator<string> {
  let token: string | undefined;

  do {
    const page: Record<string, string> = { "list-type": "2", prefix: PREFIX, ...query };
    if (token) page["continuation-token"] = token;
    const response = await call(target, "GET", "", { query: page });
    if (!response.ok) throw new Error(`listing the bucket answered ${response.status}`);
    const xml = await response.text();
    yield xml;
    token = xml.includes("<IsTruncated>true</IsTruncated>") ? xmlValues(xml, "NextContinuationToken")[0] : undefined;
  } while (token);
}

async function listBucket(target: Bucket): Promise<{ files: string[]; folders: Set<string> }> {
  const files: string[] = [];
  const folders = new Set<string>();

  for await (const xml of listing(target, { delimiter: "/" })) {
    files.push(...xmlValues(xml, "Key").map((key) => key.slice(PREFIX.length)));
    for (const prefix of xmlValues(xml, "Prefix")) if (prefix !== PREFIX) folders.add(prefix.slice(PREFIX.length, -1));
  }

  return { files, folders };
}

// The browser sends the raw file as the body, so a 1 GB video streams to disk instead of sitting in memory.
export async function uploadMedia(request: Request): Promise<Response> {
  if (!(await isAdmin())) return reply("NOT_SIGNED_IN", 401);
  const type = typeOf(new URL(request.url).searchParams.get("name") ?? "");
  if (!type || !request.body) return reply("MEDIA_TYPE", 415);
  if (Number(request.headers.get("content-length") ?? 0) > type.max) return reply("MEDIA_TOO_LARGE", 413);
  await mkdir(mediaDir(), { recursive: true });
  const file = `${randomBytes(16).toString("hex")}.${type.ext}`;
  const partial = join(mediaDir(), `${file}.part`);
  const reader = request.body.getReader();
  const handle = await open(partial, "wx");
  let head = Buffer.alloc(0);
  let size = 0;
  let failure: Response | undefined;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (head.length < 12) head = Buffer.concat([head, chunk.value]);
      if (size > type.max) failure = reply("MEDIA_TOO_LARGE", 413);
      else if (head.length >= 12 && !type.sniff(head)) failure = reply("MEDIA_TYPE", 415);
      if (failure) break;
      await handle.write(chunk.value);
    }
  } catch {
    failure = reply("UPLOAD_FAILED", 400);
  } finally {
    await handle.close();
  }
  if (!failure && !(head.length >= 12 && type.sniff(head))) failure = reply("MEDIA_TYPE", 415);
  if (failure) {
    await reader.cancel().catch(() => undefined);
    await rm(partial, { force: true });
    return failure;
  }
  await rename(partial, join(mediaDir(), file));
  return Response.json({ path: `/media/${file}` });
}

// With a bucket connected the browser sends the file straight to it in parts; the server signs each part and checks the result.
export async function directUpload(request: Request): Promise<Response> {
  if (!(await isAdmin())) return reply("NOT_SIGNED_IN", 401);
  const body = jsonObject((await readBody(request, 1024 ** 2)) ?? "");
  if (!body) return reply("UPLOAD_FAILED", 400);
  const target = await bucket();
  if (!target) return Response.json({ local: true });

  if (body.step === "start") {
    const type = typeOf(typeof body.name === "string" ? body.name : "");
    const size = typeof body.size === "number" && Number.isInteger(body.size) ? body.size : 0;
    if (!type) return reply("MEDIA_TYPE", 415);
    if (size < 12 || size > type.max) return reply("MEDIA_TOO_LARGE", 413);
    const file = `${randomBytes(16).toString("hex")}.${type.ext}`;
    const uploadId = await startMultipart(target, `${PREFIX}${file}`, type.mime).catch(() => undefined);
    if (!uploadId) return reply("UPLOAD_FAILED", 502);

    const urls = Array.from({ length: Math.ceil(size / PART) }, (_, index) =>
      sign(target, {
        method: "PUT",
        path: objectPath(target, `${PREFIX}${file}`),
        query: { partNumber: String(index + 1), uploadId },
        expires: 43_200,
      }),
    ).map((signed) => signed.url);

    return Response.json({ file, uploadId, partSize: PART, urls });
  }

  const file = typeof body.file === "string" && FILE.test(body.file) ? body.file : undefined;
  const uploadId = typeof body.uploadId === "string" && UPLOAD_ID.test(body.uploadId) ? body.uploadId : undefined;
  const type = file ? typeOf(file) : undefined;

  const sent = Array.isArray(body.parts) ? body.parts : [];

  const parts = sent.flatMap((part, index) =>
    isObject(part) && part.number === index + 1 && typeof part.etag === "string" && ETAG.test(part.etag)
      ? [{ number: index + 1, etag: `"${part.etag.replaceAll('"', "")}"` }]
      : [],
  );

  if (body.step !== "finish" || !file || !uploadId || !type || !parts.length || parts.length !== sent.length)
    return reply("UPLOAD_FAILED", 400);
  const key = `${PREFIX}${file}`;
  if (!(await finishMultipart(target, key, uploadId, parts).catch(() => false))) {
    // Parts of an upload never finished stay billed in the bucket until aborted.
    await call(target, "DELETE", key, { query: { uploadId } }).catch(() => undefined);
    return reply("UPLOAD_FAILED", 502);
  }

  const [head, start] = await Promise.all([
    call(target, "HEAD", key),
    call(target, "GET", key, { headers: { range: "bytes=0-15" } }),
  ]);

  const size = Number(head.headers.get("content-length") ?? 0);
  const failure = !head.ok || size > type.max ? reply("MEDIA_TOO_LARGE", 413) : undefined;
  const sniffed = start.ok && type.sniff(Buffer.from(await start.arrayBuffer()));

  if (failure || !sniffed) {
    await call(target, "DELETE", key).catch(() => undefined);
    return failure ?? reply("MEDIA_TYPE", 415);
  }

  return Response.json({ path: `/media/${file}` });
}

// A lesson file is paid content: only the admin and current buyers of its product get it, so a refund or a shared link opens nothing.
// A VSL plays as dozens of segment requests per viewer; remembering the public verdict for a minute keeps them off the database.
// Only "public" is remembered, since the private answer depends on who asks. Capped so random names cannot grow it.
const publicUntil = new Map<string, number>();
const REMEMBERED = 2000;

async function access(urls: string[]): Promise<Visibility | "denied"> {
  const key = urls.join(" ");
  if ((publicUntil.get(key) ?? 0) > Date.now()) return "public";
  const visibility = await checkAccess(urls);

  if (visibility === "public") {
    if (publicUntil.size >= REMEMBERED) publicUntil.clear();
    publicUntil.set(key, Date.now() + 60_000);
  }

  return visibility;
}

async function checkAccess(urls: string[]): Promise<Visibility | "denied"> {
  const [owners, shown] = await Promise.all([
    db()
      .selectDistinct({ product: module.product })
      .from(lesson)
      .innerJoin(module, eq(module.id, lesson.moduleId))
      .where(inArray(lesson.video, urls)),
    db().$count(
      product,
      or(
        inArray(product.vslVideo, urls),
        inArray(product.captions, urls),
        inArray(product.banner, urls),
        inArray(product.cover, urls),
      ),
    ),
  ]);

  if (owners.length === 0 || shown > 0) return "public";
  if (await isAdmin()) return "private";
  const owned = (await currentMember())?.owned ?? [];
  return owners.some((row) => owned.includes(row.product)) ? "private" : "denied";
}

const streams = new Set<string>();
const missing = new Map<string, number>();

export async function streamFor(url: string): Promise<string | undefined> {
  const id = ORIGINAL.exec(url.replace(/^\/media\//, ""))?.[1];
  if (!id) return;
  const master = `/media/${id}/master.m3u8`;
  if (streams.has(id) || (await stat(join(mediaDir(), id, "master.m3u8")).catch(() => undefined))) return master;
  if ((missing.get(id) ?? 0) > Date.now()) return;
  const target = await bucket();
  if (!target) return;
  const head = await call(target, "HEAD", `${PREFIX}${id}/master.m3u8`).catch(() => undefined);
  if (head?.ok) streams.add(id);
  else missing.set(id, Date.now() + 60_000);
  return head?.ok ? master : undefined;
}

// A finished stream never changes (random names, master playlist uploaded last), so its playlists are kept in memory.
const playlists = new Map<string, string>();

// Playlists pass through here so their relative links come back to this route; every other file is a redirect to a signed link.
async function serveRemote(file: string, mime: string, visibility: Visibility): Promise<Response> {
  const target = await bucket();
  if (!target) return new Response(null, { status: 404 });
  const key = `${PREFIX}${file}`;

  if (file.endsWith(".m3u8")) {
    let text = playlists.get(file);

    if (text === undefined) {
      const response = await fetch(presign(target, "GET", key, visibility), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return new Response(null, { status: 404 });
      text = await response.text();
      if (playlists.size >= REMEMBERED) playlists.clear();
      playlists.set(file, text);
    }

    return new Response(text, { headers: { "Content-Type": mime, "Cache-Control": LINKS[visibility].cache } });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: presign(target, "GET", key, visibility), "Cache-Control": LINKS[visibility].cache },
  });
}

// Names are random, so the files never change. A stream file (`<id>/...`) inherits the access rules of its original video.
export async function serveMedia(request: Request, file: string): Promise<Response> {
  const mime = mimeOf(file);
  if (!mime) return new Response(null, { status: 404 });
  const id = STREAM.exec(file)?.[1];
  const visibility = await access(id ? [`/media/${id}.mp4`, `/media/${id}.webm`] : [`/media/${file}`]);
  if (visibility === "denied") return new Response(null, { status: 404 });
  const path = join(mediaDir(), file);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return serveRemote(file, mime, visibility);
  const cache = visibility === "public" ? "public, max-age=31536000, immutable" : "private, no-store";
  return sendFile(request, path, info.size, mime, cache);
}

// Safari only plays video that answers byte ranges with 206.
export async function sendFile(request: Request, path: string, size: number, mime: string, cache: string) {
  const headers = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": cache };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range) {
    return new Response(await fileStream(path, 0, size - 1), {
      headers: { ...headers, "Content-Length": String(size) },
    });
  }
  const [, from = "", to = ""] = range;
  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if ((from === "" && !(Number(to) > 0)) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  return new Response(await fileStream(path, start, end), {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

// Writes a file, checks it, reads it back, deletes it, then asks for the CORS rule the browser upload needs.
async function cloudflare(token: string, path: string, init: { method?: string; body?: string } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: init.body,
    signal: AbortSignal.timeout(20_000),
  });

  const body = jsonObject(await response.text()) ?? {};
  const errors = Array.isArray(body.errors) ? body.errors : [];

  return {
    ok: response.ok && body.success === true,
    status: response.status,
    result: body.result,
    codes: errors.flatMap((error) => (isObject(error) && typeof error.code === "number" ? [error.code] : [])),
  };
}

// R2 accepts any Cloudflare API token as S3 keys: the token id is the access key and the SHA-256 of the token is the secret.
// So one pasted token is enough to find the account, create a private bucket for this store, open it to uploads from the panel and test it.
export async function connectCloudflare(token: string): Promise<{ code: StorageCode } | { target: Bucket }> {
  try {
    const accounts = await cloudflare(token, "/accounts");
    const account = Array.isArray(accounts.result) ? accounts.result.find(isObject) : undefined;
    if (!accounts.ok || typeof account?.id !== "string") return { code: "CLOUDFLARE_TOKEN_INVALID" };

    const user = await cloudflare(token, "/user/tokens/verify");
    const verified = user.ok ? user : await cloudflare(token, `/accounts/${account.id}/tokens/verify`);
    const tokenId = isObject(verified.result) ? verified.result.id : undefined;
    if (!verified.ok || typeof tokenId !== "string") return { code: "CLOUDFLARE_TOKEN_INVALID" };

    const host = new URL(baseUrl()).hostname.replace(/[^a-z0-9]+/g, "-");
    const name = `librefunnel-${host}`.slice(0, 63).replace(/-+$/, "");
    const buckets = `/accounts/${account.id}/r2/buckets`;
    const existing = await cloudflare(token, `${buckets}/${name}`);

    if (!existing.ok) {
      const created = await cloudflare(token, buckets, { method: "POST", body: JSON.stringify({ name }) });
      if (created.codes.includes(10042)) return { code: "CLOUDFLARE_R2_DISABLED" };
      if (!created.ok) return { code: "CLOUDFLARE_PERMISSION" };
    }

    const rules = [
      {
        allowed: { origins: [new URL(baseUrl()).origin], methods: ["GET", "PUT", "HEAD"], headers: ["*"] },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600,
      },
    ];

    const cors = await cloudflare(token, `${buckets}/${name}/cors`, { method: "PUT", body: JSON.stringify({ rules }) });
    if (!cors.ok) return { code: "CLOUDFLARE_PERMISSION" };

    const target = {
      endpoint: `https://${account.id}.r2.cloudflarestorage.com`,
      name,
      region: "auto",
      accessKey: tokenId,
      secret: sha256(token),
    };

    const code = await checkStorage(target, false);
    return code ? { code } : { target };
  } catch {
    return { code: "STORAGE_UNREACHABLE" };
  }
}

// Shared by the admin button and the installer's first boot, which passes the token once in the environment.
export async function setUpR2(token: string): Promise<StorageCode | null> {
  const connected = await connectCloudflare(token);
  if ("code" in connected) return connected.code;
  const { endpoint, name, region, accessKey, secret } = connected.target;
  await saveCredentials("storage", { endpoint, bucket: name, region, accessKey }, { secret });
  return null;
}

export async function testStorage(): Promise<StorageCode | null> {
  const target = await bucket();
  return target ? checkStorage(target) : "STORAGE_NO_BUCKET";
}

// Run before the keys are saved, so a wrong key never reaches the uploads. The CORS rule is applied when the token may change bucket settings; otherwise the check asks for it.
export async function connectStorage(target: Bucket): Promise<StorageCode | null> {
  const origin = new URL(baseUrl()).origin;

  const body = `<CORSConfiguration><CORSRule><AllowedOrigin>${origin}</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;

  await call(target, "PUT", "", {
    query: { cors: "" },
    headers: { "content-md5": createHash("md5").update(body).digest("base64"), "content-type": "application/xml" },
    body,
  }).catch(() => undefined);

  return checkStorage(target);
}

// `cors` is false right after the Cloudflare API set the rule, which can take a moment to show up on the S3 side.
async function checkStorage(target: Bucket, cors = true): Promise<StorageCode | null> {
  const key = `${PREFIX}librefunnel-test.txt`;

  try {
    const put = await call(target, "PUT", key, { headers: { "content-type": "text/plain" }, body: "ok" });
    if (put.status === 403 || put.status === 401) return "STORAGE_DENIED";
    if (put.status === 404) return "STORAGE_NO_BUCKET";
    if (!put.ok) return "STORAGE_UNREACHABLE";
    const read = await fetch(presign(target, "GET", key, "private"), { signal: AbortSignal.timeout(20_000) });
    await call(target, "DELETE", key);
    if (!read.ok) return "STORAGE_DENIED";
    if (!cors) return null;

    const preflight = await fetch(presign(target, "PUT", key, "private"), {
      method: "OPTIONS",
      headers: { origin: new URL(baseUrl()).origin, "access-control-request-method": "PUT" },
      signal: AbortSignal.timeout(20_000),
    });

    return preflight.headers.get("access-control-allow-origin") ? null : "STORAGE_CORS";
  } catch {
    return "STORAGE_UNREACHABLE";
  }
}

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

let busy = false;
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

const DUMP = /^librefunnel-\d\.sql$/;

// Every id that any row of these tables mentions, in any column: a column added later is covered without a change here.
async function usedMedia(): Promise<Set<string>> {
  const everything = sql.join(
    [product, module, lesson, setting, autoReply, recoveryStep].map(
      (table) => sql`SELECT ${table}::text AS row FROM ${table}`,
    ),
    sql` UNION ALL `,
  );

  const rows = await db()
    .selectDistinct({ id: sql<string>`(regexp_matches(everything.row, ${ID_TEXT}, 'g'))[1]` })
    .from(sql`(${everything}) AS everything`);

  return new Set(rows.map((row) => row.id));
}

async function oldBucketObjects(target: Bucket, before: number): Promise<string[]> {
  const keys: string[] = [];

  for await (const xml of listing(target, {}))
    for (const [, entry = ""] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const [key] = xmlValues(entry, "Key");
      const [modified] = xmlValues(entry, "LastModified");
      if (key && modified && Date.parse(modified) < before) keys.push(key);
    }

  return keys;
}

let sweptDay = "";

// Uploads nothing uses anymore. They are kept for 30 days, so a form saved late or a restored backup still finds its files.
export async function sweepMedia(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (demoMode() || busy || sweptDay === today) return;
  sweptDay = today;
  const used = await usedMedia();
  const before = Date.now() - ORPHAN_AGE_MS;

  const unused = (name: string) => {
    const id = MEDIA_ID.exec(name)?.[1];
    return id !== undefined && !used.has(id);
  };

  for (const name of (await readdir(mediaDir()).catch((): string[] => [])).filter(unused)) {
    const path = join(mediaDir(), name);
    const modified = (await stat(path).catch(() => undefined))?.mtimeMs ?? Infinity;
    if (modified < before) await rm(path, { recursive: true, force: true });
  }

  const target = await bucket();
  if (!target) return;
  for (const key of await oldBucketObjects(target, before))
    if (key.startsWith(PREFIX) && unused(key.slice(PREFIX.length))) await call(target, "DELETE", key);
}
let backupSentAt = 0;

// The daily database dump also goes to the connected bucket, so losing the server does not lose the sales.
// Named after the weekday like on disk, so the bucket keeps the same last 7 days.
export async function sendBackup(): Promise<void> {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return;
  const names = (await readdir(dir).catch((): string[] => [])).filter((name) => DUMP.test(name));
  const dumps = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(dir, name))).mtimeMs })));
  const newest = dumps.sort((a, b) => b.at - a.at)[0];
  if (!newest || newest.at <= backupSentAt) return;
  const target = await bucket();
  if (!target) return;
  await putFile(target, `backups/${newest.name}`, join(dir, newest.name), "application/sql");
  backupSentAt = newest.at;
}

// Once a bucket is connected, files already on disk move to it one by one; the local copy goes only after the upload succeeds.
async function sendToBucket(target: Bucket, name: string): Promise<void> {
  const path = join(mediaDir(), name);
  if (FOLDER.test(name)) await putFolder(target, name, path);
  else await putFile(target, `${PREFIX}${name}`, path, mimeOf(name) ?? "application/octet-stream");
  await rm(path, { recursive: true, force: true });
}
