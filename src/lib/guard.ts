import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

export type GuardCode =
  | "INVALID_SIGNATURE"
  | "INVALID_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "INVALID_PASSWORD"
  | "DEMO_BLOCKED"
  | "DEMO_ONLY";
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

const ADMIN_COOKIE = "lf_admin";
const ADMIN_TTL = 12 * 3600;
const CONTROL = /[\u0000-\u001f\u007f]/;

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const NAME = /^[\p{L}\p{M}'’. -]+$/u;
const WINDOW_LIMIT = 50_000;
const windows = new Map<string, { count: number; resetAt: number }>();

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function envProblems(): string[] {
  const problems: string[] = [];
  if ((process.env.SECRET ?? "").length < 32)
    problems.push("SECRET must have at least 32 characters (generate with: openssl rand -hex 32)");
  if ((process.env.ADMIN_PASSWORD ?? "").length < 16) problems.push("ADMIN_PASSWORD must have at least 16 characters");
  if (!/^https?:\/\/[^/\s]+$/.test(process.env.BASE_URL ?? ""))
    problems.push("BASE_URL must look like https://shop.example.com (no path, no trailing slash)");
  return problems;
}

// The public demo store: nothing leaves the server and the data goes back to the seed every night.
export function demoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

export function baseUrl(): string {
  return process.env.BASE_URL ?? "http://localhost:3000";
}

function key(label: string): Buffer {
  const secret = process.env.SECRET ?? "";
  if (secret.length < 32) throw new Error("SECRET is missing or shorter than 32 characters");
  return createHmac("sha256", secret).update(label).digest();
}

export function derive(label: string): string {
  return key(label).toString("hex");
}

export function sign(label: string, payload: string, ttl: number): string {
  const body = `${Buffer.from(payload).toString("base64url")}.${now() + ttl}`;
  return `${body}.${createHmac("sha256", key(label)).update(body).digest("base64url")}`;
}

export function verify(label: string, token: string): string | undefined {
  const [payload, expires, mac, extra] = token.split(".");
  if (!payload || !expires || !mac || extra !== undefined || !(Number(expires) > now())) return undefined;
  const expected = createHmac("sha256", key(label)).update(`${payload}.${expires}`).digest("base64url");
  return safeEqual(mac, expected) ? Buffer.from(payload, "base64url").toString() : undefined;
}

function credentialKey(): Buffer {
  const secret = process.env.SECRET ?? "";
  if (secret.length < 32) throw new Error("SECRET is missing or shorter than 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "", "credentials", 32));
}

// AES-256-GCM as nonce.tag.ciphertext; the context is authenticated, so a sealed value cannot be moved to another field.
export function seal(plain: string, context: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), nonce).setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

// Undefined when tampered with, moved, or sealed under another SECRET.
export function unseal(sealed: string, context: string): string | undefined {
  const [nonce = "", tag = "", body = ""] = sealed.split(".");
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(nonce, "base64url")).setAAD(
      Buffer.from(context),
    );

    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Behind the proxy only its own appended hop is trustworthy; without one every header is client-controlled.
export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY !== "1") return "direct";
  const hops = (headers.get("x-forwarded-for") ?? "").split(",");
  return hops[hops.length - 1]?.trim() || "direct";
}

// An IPv6 client owns its whole /64, so the limit counts the /64 instead of each address in it.
function network(id: string): string {
  if (!id.includes(":") || id.includes(".")) return id;
  const [head = "", tail = ""] = id.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = id.includes("::") && tail ? tail.split(":") : [];

  const groups = id.includes("::")
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;

  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

export function limited(bucket: string, id: string, max: number, windowSeconds: number): boolean {
  const slot = `${bucket}:${network(id)}`;
  const t = now();
  const entry = windows.get(slot);
  if (entry && entry.resetAt > t) {
    entry.count += 1;
    return entry.count > max;
  }
  if (windows.size >= WINDOW_LIMIT) for (const [stale, value] of windows) if (value.resetAt <= t) windows.delete(stale);
  // Still full means a flood of fresh addresses: dropping the oldest keeps memory bounded.
  for (const [oldest] of windows) {
    if (windows.size < WINDOW_LIMIT) break;
    windows.delete(oldest);
  }
  windows.set(slot, { count: 1, resetAt: t + windowSeconds });
  return false;
}

export async function setCookie(name: string, value: string, maxAge: number, sameSite: "lax" | "strict") {
  (await cookies()).set(name, value, {
    httpOnly: true,
    secure: baseUrl().startsWith("https://"),
    sameSite,
    maxAge,
    path: "/",
  });
}

export async function readBody(request: Request, limit: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return undefined;
  const text = await request.text();
  return Buffer.byteLength(text) > limit ? undefined : text;
}

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonObject(text: string): JsonObject | undefined {
  try {
    const value: Json = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function cleanEmail(raw: string): string | undefined {
  const email = raw.trim().toLowerCase();
  return email.length <= 200 && EMAIL.test(email) ? email : undefined;
}

export function cleanName(raw: string): string | undefined {
  const name = raw.trim().replace(/\s+/g, " ");
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  return name.length <= 120 && letters >= 2 && NAME.test(name) ? name : undefined;
}

export function cleanPhone(raw: string): string | undefined {
  if (CONTROL.test(raw) || /[^\d\s().+-]/.test(raw)) return undefined;
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return /^55\d{10,11}$/.test(digits) ? digits : undefined;
}

export function printable(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max && !CONTROL.test(trimmed) ? trimmed : "";
}

export function firstName(name: string): string {
  return (name.split(" ")[0] ?? "").replace(/[^\p{L}'-]/gu, "").slice(0, 30);
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function adminLabel(): string {
  return `admin:${process.env.ADMIN_PASSWORD ?? ""}`;
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return token !== undefined && verify(adminLabel(), token) === "admin";
}

export async function signInAdmin(password: string, ip: string): Promise<GuardCode | null> {
  if (limited("admin", ip, 10, 900)) return "RATE_LIMITED";
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (expected.length < 16 || !safeEqual(password, expected)) return "INVALID_PASSWORD";
  await setCookie(ADMIN_COOKIE, sign(adminLabel(), "admin", ADMIN_TTL), ADMIN_TTL, "strict");
  return null;
}

export async function signOutAdmin() {
  (await cookies()).delete(ADMIN_COOKIE);
}
