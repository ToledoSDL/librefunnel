import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isObject, jsonObject, readBody } from "../guard";
import { isAdmin } from "../sessions";
import { PART, bucket, call, finishMultipart, objectPath, sign, startMultipart } from "./bucket";
import { FILE, PREFIX, mediaDir, typeOf } from "./files";

export type MediaCode = "MEDIA_TYPE" | "MEDIA_TOO_LARGE" | "UPLOAD_FAILED";

const UPLOAD_ID = /^[\x21-\x7e]{1,1024}$/;

const ETAG = /^"?[\w-]{1,128}"?$/;

function reply(code: MediaCode | "NOT_SIGNED_IN", status: number): Response {
  return Response.json({ code }, { status });
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
  // A runtime folder under DATA_DIR: without the comment the build copies the whole project, .env included, into the server.
  await rename(partial, join(/*turbopackIgnore: true*/ mediaDir(), file));
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
