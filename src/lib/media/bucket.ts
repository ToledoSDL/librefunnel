import "server-only";
import { createHash, createHmac } from "node:crypto";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { credentials } from "../settings";
import { PREFIX, mimeOf } from "./files";

export type Bucket = { endpoint: string; name: string; region: string; accessKey: string; secret: string };

export type Visibility = "public" | "private";

export const PART = 16 * 1024 ** 2;

// Signed links are cut on fixed windows, so the same file keeps the same URL for a while and the browser can cache it.
export const LINKS: Record<Visibility, { window: number; expires: number; cache: string }> = {
  public: { window: 86_400, expires: 604_800, cache: "public, max-age=3600" },
  private: { window: 300, expires: 900, cache: "private, no-store" },
};

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function sha256(data: string | Buffer): string {
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

export async function bucket(): Promise<Bucket | undefined> {
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

export function objectPath(target: Bucket, key: string): string {
  return `/${rfc3986(target.name)}${key ? `/${key.split("/").map(rfc3986).join("/")}` : ""}`;
}

export function call(
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

export function presign(
  target: Bucket,
  method: string,
  key: string,
  visibility: Visibility,
  query?: Record<string, string>,
) {
  const { window, expires } = LINKS[visibility];
  const at = new Date(Math.floor(Date.now() / (window * 1000)) * window * 1000);
  return sign(target, { method, path: objectPath(target, key), query, at, expires }).url;
}

export function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((match) =>
    (match[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

export async function startMultipart(target: Bucket, key: string, mime: string): Promise<string | undefined> {
  const response = await call(target, "POST", key, { query: { uploads: "" }, headers: { "content-type": mime } });
  return response.ok ? xmlValues(await response.text(), "UploadId")[0] : undefined;
}

// S3 can answer 200 with an <Error> body when completing, so the body is checked too.
export async function finishMultipart(
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

export async function putFile(target: Bucket, key: string, path: string, mime: string): Promise<void> {
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
export async function putFolder(target: Bucket, id: string, dir: string): Promise<void> {
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

export async function* listing(target: Bucket, query: Record<string, string>): AsyncGenerator<string> {
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

export async function listBucket(target: Bucket): Promise<{ files: string[]; folders: Set<string> }> {
  const files: string[] = [];
  const folders = new Set<string>();

  for await (const xml of listing(target, { delimiter: "/" })) {
    files.push(...xmlValues(xml, "Key").map((key) => key.slice(PREFIX.length)));
    for (const prefix of xmlValues(xml, "Prefix")) if (prefix !== PREFIX) folders.add(prefix.slice(PREFIX.length, -1));
  }

  return { files, folders };
}
