import "server-only";
import { createHash } from "node:crypto";
import { baseUrl, isObject, jsonObject } from "../guard";
import { saveCredentials } from "../settings";
import { bucket, call, presign, sha256 } from "./bucket";
import type { Bucket } from "./bucket";
import { PREFIX } from "./files";

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
      { allowed: { origins: ["*"], methods: ["GET", "HEAD"], headers: ["*"] }, maxAgeSeconds: 3600 },
      {
        allowed: { origins: [new URL(baseUrl()).origin], methods: ["PUT"], headers: ["*"] },
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
  await applyCors(target).catch(() => undefined);
  return checkStorage(target);
}

// Product domains play the videos too, so any site may read (the signed link is what guards a file); uploads come only
// from the panel. Applied again at every start, so buckets connected before product domains get the open reads.
export async function applyCors(target: Bucket) {
  const origin = new URL(baseUrl()).origin;

  const body = `<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule><CORSRule><AllowedOrigin>${origin}</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;

  await call(target, "PUT", "", {
    query: { cors: "" },
    headers: { "content-md5": createHash("md5").update(body).digest("base64"), "content-type": "application/xml" },
    body,
  });
}

// Writes a file, checks it, reads it back, deletes it, then asks for the CORS rule the browser upload needs.
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
