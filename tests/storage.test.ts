import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { enterFromOrder, saveLesson } from "@/lib/actions";
import { removeCredentials, saveCredentials } from "@/lib/catalog";
import { db } from "@/lib/db";
import { connectCloudflare, directUpload, serveMedia, sign } from "@/lib/media";
import { order, product } from "@/lib/schema";
import { fakeServer, form, freshBrowser, redirected } from "./fakes";
import { buy, pay, signInAsAdmin } from "./flows";

// The examples from the AWS Signature Version 4 documentation for S3, with their published signatures.
const EXAMPLE = {
  endpoint: "https://examplebucket.s3.amazonaws.com",
  region: "us-east-1",
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

const AT = new Date("2013-05-24T00:00:00Z");
const ID = "b".repeat(32);

describe("S3 signature", () => {
  test("a presigned GET matches the documented signature", () => {
    const { url } = sign(EXAMPLE, { method: "GET", path: "/test.txt", at: AT, expires: 86_400 });

    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  test("a header-signed GET with a range matches the documented signature", () => {
    const { headers } = sign(EXAMPLE, {
      method: "GET",
      path: "/test.txt",
      headers: { range: "bytes=0-9" },
      payload: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      at: AT,
    });

    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("one-token Cloudflare setup", () => {
  const TOKEN = "cf-token-0123456789abcdef";
  let calls: { method: string; url: string; body: string }[] = [];
  let bucketExists = false;
  let r2Enabled = true;

  beforeEach(() => {
    calls = [];
    bucketExists = false;
    r2Enabled = true;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? init.body : "" });
      const ok = (result: object) => Response.json({ success: true, errors: [], result });
      if (url.endsWith("/accounts")) return ok([{ id: "acc123" }]);
      if (url.endsWith("/user/tokens/verify")) return ok({ id: "tok-id-1", status: "active" });
      if (url.includes("/r2/buckets/") && url.endsWith("/cors")) return ok({});
      if (url.includes("/r2/buckets/") && method === "GET")
        return bucketExists ? ok({}) : Response.json({ success: false, errors: [{ code: 10006 }] }, { status: 404 });
      if (url.endsWith("/r2/buckets"))
        return r2Enabled ? ok({}) : Response.json({ success: false, errors: [{ code: 10042 }] }, { status: 403 });
      if (url.startsWith("https://acc123.r2.cloudflarestorage.com/")) return new Response("ok");
      return new Response("unexpected", { status: 500 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a pasted token creates a private bucket for this store, opens it to the panel and derives the S3 keys", async () => {
    const connected = await connectCloudflare(TOKEN);
    expect(connected).toEqual({
      target: {
        endpoint: "https://acc123.r2.cloudflarestorage.com",
        name: expect.stringMatching(/^librefunnel-/),
        region: "auto",
        accessKey: "tok-id-1",
        secret: createHash("sha256").update(TOKEN).digest("hex"),
      },
    });
    const created = calls.find((call) => call.method === "POST" && call.url.endsWith("/r2/buckets"));
    expect(JSON.parse(created?.body ?? "{}").name).toMatch(/^librefunnel-/);
    const cors = calls.find((call) => call.url.endsWith("/cors"));
    expect(JSON.parse(cors?.body ?? "{}").rules[0].allowed.methods).toEqual(["GET", "PUT", "HEAD"]);
    expect(
      calls.some((call) => call.method === "PUT" && new URL(call.url).hostname.endsWith(".r2.cloudflarestorage.com")),
    ).toBe(true);
  });

  test("an existing bucket is reused, and R2 still off on the account says so", async () => {
    bucketExists = true;
    await connectCloudflare(TOKEN);
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/r2/buckets"))).toBe(false);

    bucketExists = false;
    r2Enabled = false;
    expect(await connectCloudflare(TOKEN)).toEqual({ code: "CLOUDFLARE_R2_DISABLED" });
  });
});

describe("files in a bucket", () => {
  let bucket: Awaited<ReturnType<typeof fakeServer>>;

  beforeEach(async () => {
    bucket = await fakeServer({ [`GET /loja/media/${ID}/360/index.m3u8`]: { status: 200, body: "#EXTM3U" } });
    await saveCredentials(
      "storage",
      { endpoint: bucket.url, bucket: "loja", region: "auto", accessKey: "AK" },
      { secret: "SK" },
    );
  });

  afterEach(async () => {
    await removeCredentials("storage");
    await bucket.close();
  });

  function get(file: string) {
    return serveMedia(new Request(`https://shop.example/media/${file}`), file);
  }

  test("a lesson file opens only for current buyers, through short signed links", async () => {
    await signInAsAdmin();
    await saveLesson({ code: null }, form({ lesson: "m1a2", title: "Aula paga", video: `/media/${ID}.mp4`, text: "" }));
    freshBrowser("192.0.2.99");
    expect((await get(`${ID}.mp4`)).status).toBe(404);
    expect((await get(`${ID}/360/index.m3u8`)).status).toBe(404);

    const id = await buy({ email: "bucket@example.com" });
    await pay(id, 9700, `bucket-${id}`);
    await redirected(enterFromOrder());
    const video = await get(`${ID}.mp4`);
    const location = new URL(video.headers.get("location") ?? "");
    expect(video.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(`${bucket.url}/loja/media/${ID}.mp4`);
    expect(location.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(video.headers.get("cache-control")).toBe("private, no-store");
    const playlist = await get(`${ID}/360/index.m3u8`);
    expect(playlist.status).toBe(200);
    expect(await playlist.text()).toContain("#EXTM3U");

    await db().update(order).set({ status: "refunded" }).where(eq(order.id, id));
    expect((await get(`${ID}.mp4`)).status).toBe(404);
    expect((await get(`${ID}/360/index.m3u8`)).status).toBe(404);
  });

  test("a direct upload is signed per part, and a file that is not what its name says is deleted", async () => {
    const key = "/loja/media/";
    freshBrowser("192.0.2.101");

    const call = (body: object) =>
      directUpload(
        new Request("https://shop.example/admin/media/direct", { method: "POST", body: JSON.stringify(body) }),
      );

    expect((await call({ step: "start", name: "aula.mp4", size: 100 })).status).toBe(401);
    await signInAsAdmin();
    expect((await call({ step: "start", name: "aula.exe", size: 100 })).status).toBe(415);
    expect((await call({ step: "start", name: "aula.mp4", size: 2 * 1024 ** 3 })).status).toBe(413);

    bucket.routes["POST *"] = { status: 200, body: "<UploadId>up-1</UploadId>" };
    const started = await call({ step: "start", name: "aula.mp4", size: 40 * 1024 ** 2 });
    const { file, uploadId, urls } = await started.json();
    expect(uploadId).toBe("up-1");
    expect(urls).toHaveLength(3);
    expect(new URL(urls[0]).searchParams.get("partNumber")).toBe("1");

    const path = `${key}${file}`;
    bucket.routes[`POST ${path}`] = { status: 200, body: "<CompleteMultipartUploadResult/>" };
    bucket.routes[`HEAD ${path}`] = { status: 200, body: "", headers: { "content-length": "100" } };
    bucket.routes[`GET ${path}`] = { status: 206, body: "not a video at all" };
    bucket.routes[`DELETE ${path}`] = { status: 204, body: "" };

    const parts = [1, 2, 3].map((number) => ({ number, etag: `"etag-${number}"` }));
    expect((await call({ step: "finish", file, uploadId, parts: parts.slice(1) })).status).toBe(400);
    const finished = await call({ step: "finish", file, uploadId, parts });
    expect(await finished.json()).toEqual({ code: "MEDIA_TYPE" });
    expect(bucket.to("DELETE", path)).toHaveLength(1);
  });

  test("a sales video gets a long-lived link that stays the same within the day", async () => {
    await db()
      .update(product)
      .set({ vslVideo: `/media/${ID}.mp4` })
      .where(eq(product.slug, "metodo-demo"));
    freshBrowser("192.0.2.100");
    const [first, second] = await Promise.all([get(`${ID}.mp4`), get(`${ID}.mp4`)]);
    expect(first.status).toBe(302);
    expect(new URL(first.headers.get("location") ?? "").searchParams.get("X-Amz-Expires")).toBe("604800");
    expect(first.headers.get("location")).toBe(second.headers.get("location"));
    expect(first.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
