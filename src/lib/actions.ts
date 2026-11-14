"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import * as catalog from "./catalog";
import type { CatalogCode } from "./catalog";
import {
  cleanEmail,
  cleanName,
  cleanPhone,
  clientIp,
  isAdmin,
  limited,
  printable,
  signInAdmin,
  signOutAdmin,
} from "./guard";
import type { GuardCode } from "./guard";
import { connectCloudflare, connectStorage, testStorage } from "./media";
import type { MediaCode, StorageCode } from "./media";
import * as members from "./members";
import type { MemberCode } from "./members";
import * as messages from "./messages";
import type { AutomationCode, MessageCode } from "./messages";
import * as orders from "./orders";
import type { OrderCode } from "./orders";
import { fbcFor, metaCookie, recordTouch, sendMetaTest, visitor } from "./tracking";
import type { ConversionCode, TrackCode } from "./tracking";
import * as updates from "./updates";
import type { UpdateCode } from "./updates";

export type Code =
  | UpdateCode
  | OrderCode
  | MemberCode
  | GuardCode
  | TrackCode
  | ConversionCode
  | MessageCode
  | CatalogCode
  | AutomationCode
  | MediaCode
  | StorageCode;
// secret is set only by rotateWebhookSecret: the one time the generated value reaches the browser.
export type ActionState = { code: Code | null; ok?: boolean; secret?: string };
export type WhatsAppState = ActionState & { qr?: string; pairingCode?: string };
type FormArgs = [state: ActionState, form: FormData];
type Pix = Pick<catalog.ProductFields, "pixKey" | "pixName" | "pixCity">;

const ORDER_ID = /^[a-z0-9]{20}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MEDIA = /^\/(media|demo)\/[\w.-]{1,100}$/;
const ROW_ID = /^\d{1,12}$/;
const MULTILINE_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CREDENTIAL = /^[\x21-\x7e]{1,4000}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

const REMOVABLE = [
  "smtp",
  "meta",
  "mercadopago",
  "woovi",
  "abacatepay",
  "webhook",
  "evolution",
  "whatsapp",
  "storage",
] as const;

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
// AWS and Backblaze put the region in the host (s3.us-east-2.amazonaws.com); R2 and most others take "auto".
const REGION = /^s3[.-]([a-z]{2}-[a-z]+-\d{1,3})\.(?:amazonaws\.com|backblazeb2\.com)$/;

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function column(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

function done(code: Code | null): ActionState {
  revalidatePath("/", "layout");
  return code ? { code } : { code: null, ok: true };
}

function title(raw: string): string | undefined {
  const value = printable(raw.replace(/\s+/g, " "), 120);
  return value.length >= 2 ? value : undefined;
}

// Optional one-line text: null when left blank, undefined when it cannot be accepted.
function line(raw: string, max = 300): string | null | undefined {
  if (!raw.trim()) return null;
  return printable(raw, max) || undefined;
}

function text(raw: string, max: number): string | undefined {
  const value = raw.replace(/\r\n?/g, "\n").trim();
  return value.length <= max && !MULTILINE_CONTROL.test(value) ? value : undefined;
}

function media(raw: string): string | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  return MEDIA.test(value) ? value : undefined;
}

function integer(raw: string, min: number, max: number): number | undefined {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function price(raw: string): number | undefined {
  const cents = orders.parseCents(raw);
  return cents !== undefined && cents >= 100 && cents <= 10_000_000 ? cents : undefined;
}

// Blank keeps the stored secret; undefined when it cannot be a key (spaces, accents, control characters).
function credential(raw: string): string | undefined {
  const value = raw.trim();
  return !value || CREDENTIAL.test(value) ? value : undefined;
}

function rowId(raw: string): number | undefined {
  return ROW_ID.test(raw) ? Number(raw) : undefined;
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function pixFields(form: FormData): Pix | { code: Code } {
  const pixKey = catalog.pixKey(field(form, "pixKey"));
  if (!pixKey) return { code: "INVALID_PIX_KEY" };
  const pixName = catalog.pixText(field(form, "pixName"), 25);
  const pixCity = catalog.pixText(field(form, "pixCity"), 15);
  if (!pixName || !pixCity) return { code: "INVALID_PIX_HOLDER" };
  return { pixKey, pixName, pixCity };
}

function productFields(form: FormData): catalog.ProductFields | { code: Code } {
  const name = title(field(form, "name"));
  if (!name) return { code: "INVALID_TITLE" };
  const cents = price(field(form, "price"));
  if (!cents) return { code: "INVALID_PRICE" };
  const pix = pixFields(form);
  if ("code" in pix) return pix;
  const tagline = line(field(form, "tagline"));
  const ctaText = line(field(form, "ctaText"), 80);
  const bumpHeadline = line(field(form, "bumpHeadline"));
  if (tagline === undefined || ctaText === undefined || bumpHeadline === undefined) return { code: "INVALID_TEXT" };
  const offer = field(form, "offerEndsAt").trim();
  const offerEndsAt = offer ? new Date(offer) : null;
  if (offerEndsAt && Number.isNaN(offerEndsAt.getTime())) return { code: "INVALID_DATE" };
  const guaranteeDays = integer(field(form, "guaranteeDays"), 7, 365);
  if (guaranteeDays === undefined) return { code: "INVALID_GUARANTEE" };
  const ctaSeconds = integer(field(form, "ctaSeconds") || "0", 0, 7200);
  if (ctaSeconds === undefined) return { code: "INVALID_CTA_SECONDS" };
  const bumpProduct = field(form, "bumpProduct") || null;
  const bumpPrice = field(form, "bumpPrice").trim() ? price(field(form, "bumpPrice")) : null;
  if (bumpPrice === undefined || (bumpProduct !== null && !SLUG.test(bumpProduct))) return { code: "INVALID_BUMP" };
  const vslVideo = media(field(form, "vslVideo"));
  const banner = media(field(form, "banner"));
  const cover = media(field(form, "cover"));
  if (vslVideo === undefined || banner === undefined || cover === undefined) return { code: "INVALID_MEDIA" };
  const answers = column(form, "faq_a");
  const faq: catalog.Faq[] = [];
  for (const [index, raw] of column(form, "faq_q").entries()) {
    const q = line(raw);
    const a = text(answers[index] ?? "", 2000);
    if (q === null && !a) continue;
    if (!q || !a) return { code: "INVALID_FAQ" };
    faq.push({ q, a });
  }
  const quotes = column(form, "testimonial_text");
  const stars = column(form, "testimonial_stars");
  const testimonials: catalog.Testimonial[] = [];
  for (const [index, raw] of column(form, "testimonial_name").entries()) {
    const author = title(raw);
    const quote = text(quotes[index] ?? "", 1000);
    const rating = integer(stars[index] ?? "", 1, 5);
    if (!raw.trim() && !quote) continue;
    if (!author || !quote || rating === undefined) return { code: "INVALID_TESTIMONIAL" };
    testimonials.push({ name: author, text: quote, stars: rating });
  }
  const starts = column(form, "trigger_at");
  const ends = column(form, "trigger_until");
  const kinds = column(form, "trigger_kind");
  const triggers: catalog.Trigger[] = [];
  for (const [index, raw] of column(form, "trigger_text").entries()) {
    const label = line(raw, 80);
    const at = integer(starts[index] ?? "", 0, 7200);
    const until = integer(ends[index] ?? "", 1, 7200);
    if (label === null && !starts[index]?.trim() && !ends[index]?.trim()) continue;
    if (!label || at === undefined || until === undefined || until <= at) return { code: "INVALID_TRIGGER" };
    triggers.push({ at, until, text: label, button: kinds[index] === "button" });
  }
  const barText = line(field(form, "barText"), 120);
  if (barText === undefined) return { code: "INVALID_TEXT" };
  const barColor = field(form, "barColor").trim().toLowerCase() || null;
  if (barColor !== null && !/^#[0-9a-f]{6}$/.test(barColor)) return { code: "INVALID_COLOR" };
  const captions = media(field(form, "captions"));
  if (captions === undefined) return { code: "INVALID_MEDIA" };
  return {
    name,
    price: cents,
    tagline,
    ...pix,
    offerEndsAt,
    guaranteeDays,
    bumpProduct,
    bumpPrice,
    bumpHeadline,
    vslVideo,
    ctaSeconds,
    ctaText,
    player: {
      autoplay: field(form, "playerAutoplay") === "1",
      resume: field(form, "playerResume") === "1",
      fastBar: field(form, "playerFastBar") === "1",
      floating: field(form, "playerFloating") === "1",
      button: field(form, "playerButton") === "1",
      speed: field(form, "playerSpeed") === "1",
    },
    captions,
    triggers: triggers.sort((a, b) => a.at - b.at),
    barText,
    barColor,
    banner,
    cover,
    faq,
    testimonials,
  };
}

function item(form: FormData): { kind: "product" | "module" | "lesson"; key: string | number } | undefined {
  const kind = field(form, "kind");
  const raw = field(form, "key");
  if (kind === "product" || kind === "lesson") return SLUG.test(raw) ? { kind, key: raw } : undefined;
  const key = rowId(raw);
  return kind === "module" && key !== undefined ? { kind, key } : undefined;
}

export async function createOrder(...[, form]: FormArgs): Promise<ActionState> {
  const product = await catalog.getProduct(field(form, "slug"));
  if (!product) return { code: "PRODUCT_NOT_FOUND" };
  const name = cleanName(field(form, "name"));
  if (!name) return { code: "INVALID_NAME" };
  const email = cleanEmail(field(form, "email"));
  if (!email) return { code: "INVALID_EMAIL" };
  const { checkoutPhone } = await catalog.settings();
  const rawPhone = checkoutPhone === "hidden" ? "" : field(form, "phone").trim();
  if (!rawPhone && checkoutPhone === "required") return { code: "INVALID_PHONE" };
  const phone = rawPhone ? cleanPhone(rawPhone) : null;
  if (phone === undefined) return { code: "INVALID_PHONE" };
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  if (limited("order", ip, 20, 600)) return { code: "RATE_LIMITED" };
  const visitorId = await visitor();
  await recordTouch(visitorId, field(form, "touch"), "", `/c/${product.slug}`);
  const jar = await cookies();

  const result = await orders.placeOrder({
    product,
    name,
    email,
    phone,
    bump: field(form, "bump") === "1",
    ownOrder: await members.orderFromCookie(),
    visitorId,
    ip,
    userAgent: (requestHeaders.get("user-agent") ?? "").slice(0, 500),
    fbp: metaCookie(jar.get("_fbp")?.value, "_fbp"),
    fbc: metaCookie(jar.get("_fbc")?.value, "_fbc") ?? (await fbcFor(visitorId)),
  });

  if ("code" in result) return { code: result.code };
  await members.rememberOrder(result.id);
  after(orders.attachCharges);
  redirect(`/c/${product.slug}?order=${result.id}`);
}

export async function requestLogin(...[, form]: FormArgs): Promise<ActionState> {
  const email = cleanEmail(field(form, "email"));
  if (!email) return { code: "INVALID_EMAIL" };
  const code = await members.requestLogin(email, clientIp(await headers()));
  return code ? { code } : { code: null, ok: true };
}

export async function confirmLogin(...[, form]: FormArgs): Promise<ActionState> {
  const code = await members.confirmLogin(field(form, "token"));
  if (code) return { code };
  redirect("/m");
}

export async function enterFromOrder(): Promise<ActionState> {
  const code = await members.enterFromOrder();
  if (code) return { code };
  redirect("/m");
}

export async function completeLesson(...[, form]: FormArgs): Promise<ActionState> {
  const code = await members.completeLesson(field(form, "product"), field(form, "lesson"));
  if (code) return { code };
  revalidatePath("/m", "layout");
  return { code: null, ok: true };
}

export async function signOut(): Promise<ActionState> {
  await members.signOut();
  redirect("/m");
}

export async function optOut(...[, form]: FormArgs): Promise<ActionState> {
  return (await messages.optOutByLink(field(form, "token"))) ? { code: null, ok: true } : { code: "LINK_INVALID" };
}

export async function adminSignIn(...[, form]: FormArgs): Promise<ActionState> {
  const code = await signInAdmin(field(form, "password"), clientIp(await headers()));
  if (code) return { code };
  redirect("/admin");
}

export async function adminSignOut(): Promise<ActionState> {
  await signOutAdmin();
  redirect("/admin");
}

export async function releaseOrder(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const orderId = field(form, "orderId");
  if (!ORDER_ID.test(orderId)) return { code: "ORDER_NOT_FOUND" };
  const amount = orders.parseCents(field(form, "amount"));
  if (!amount) return { code: "INVALID_AMOUNT" };
  return done(await orders.releaseOrder(orderId, amount));
}

export async function refundOrder(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done(await orders.refundOrder(field(form, "orderId")));
}

export async function resendMessage(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const id = Number(field(form, "messageId"));
  return done(Number.isSafeInteger(id) && (await messages.resendMessage(id)) ? null : "INVALID_TRANSITION");
}

export async function sendReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const address = field(form, "address");
  if (!/^\d{10,15}$/.test(address)) return { code: "INVALID_ADDRESS" };
  const body = text(field(form, "text"), 2000);
  if (!body) return { code: "INVALID_TEXT" };
  return done(await messages.sendManual(address, body));
}

export async function resendAccess(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.resendAccess(field(form, "orderId"))) ? null : "INVALID_TRANSITION");
}

export async function connectWhatsApp(): Promise<WhatsAppState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const result = await messages.connectWhatsApp();
  revalidatePath("/admin");
  return result;
}

export async function disconnectWhatsApp(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done(await messages.disconnectWhatsApp());
}

// The form field "kind" is smtp, meta, evolution, whatsapp, mercadopago, woovi or abacatepay.
export async function testConnection(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const kind = field(form, "kind");
  const psp = orders.pixProvider(kind);
  const known = ["smtp", "meta", "evolution", "whatsapp", "storage"].includes(kind);
  if (!known && (!psp || psp === "static")) return { code: "INVALID_PAYLOAD" };
  if (limited("test", kind, 10, 600)) return { code: "RATE_LIMITED" };
  if (kind === "storage") return done(await testStorage());
  if (kind === "smtp") return done(await messages.testEmail());
  if (kind === "evolution") return done(await messages.testWhatsApp());
  if (kind === "whatsapp") return done(await messages.testCloud());
  if (kind === "meta") return done(await sendMetaTest());
  return done(psp && psp !== "static" ? await orders.testPsp(psp) : "INVALID_PAYLOAD");
}

export async function saveSmtp(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const preset = messages.SMTP_PRESETS.find((entry) => entry.id === field(form, "preset"));
  const host = preset?.host ?? field(form, "host").trim().toLowerCase();
  if (!HOST.test(host)) return { code: "INVALID_HOST" };
  const port = preset?.port ?? integer(field(form, "port") || "587", 1, 65_535);
  if (port === undefined) return { code: "INVALID_PORT" };
  const user = field(form, "user").trim();
  const password = credential(field(form, "password"));
  if (password === undefined || (user && !CREDENTIAL.test(user))) return { code: "INVALID_CREDENTIAL" };
  const rawFrom = field(form, "from").trim();
  const from = rawFrom ? cleanEmail(rawFrom) : "";
  if (from === undefined || (!from && !cleanEmail(user))) return { code: "INVALID_EMAIL" };
  await catalog.saveCredentials("smtp", { host, port: String(port), user, from }, { password });
  return done(null);
}

export async function connectR2(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const token = field(form, "token").trim();
  if (!/^[\w-]{20,200}$/.test(token)) return { code: "CLOUDFLARE_TOKEN_INVALID" };
  if (limited("test", "storage", 10, 600)) return { code: "RATE_LIMITED" };
  const connected = await connectCloudflare(token);
  if ("code" in connected) return { code: connected.code };
  const { endpoint, name, region, accessKey, secret } = connected.target;
  await catalog.saveCredentials("storage", { endpoint, bucket: name, region, accessKey }, { secret });
  return done(null);
}

export async function saveStorage(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  // R2 shows the S3 address with the bucket at the end, so that form is accepted as pasted.
  const endpoint = URL.parse(field(form, "endpoint").trim());
  const path = endpoint?.pathname.replace(/^\/|\/$/g, "") ?? "";
  if (!endpoint || endpoint.protocol !== "https:" || endpoint.search || path.includes("/"))
    return { code: "INVALID_ENDPOINT" };
  const bucket = (field(form, "bucket").trim() || path).toLowerCase();
  if (!BUCKET.test(bucket)) return { code: "INVALID_BUCKET" };

  const region =
    REGION.exec(endpoint.hostname)?.[1] ?? (endpoint.hostname === "s3.amazonaws.com" ? "us-east-1" : "auto");

  const accessKey = field(form, "accessKey").trim();
  const secret = credential(field(form, "secret"));
  if (!CREDENTIAL.test(accessKey) || secret === undefined) return { code: "INVALID_CREDENTIAL" };
  const kept = secret || (await catalog.credentials("storage"))("storage")("secret");
  if (!kept) return { code: "INVALID_CREDENTIAL" };
  if (limited("test", "storage", 10, 600)) return { code: "RATE_LIMITED" };

  const code = await connectStorage({
    endpoint: endpoint.origin,
    name: bucket,
    region,
    accessKey,
    secret: kept,
  });

  if (code) return { code };
  await catalog.saveCredentials("storage", { endpoint: endpoint.origin, bucket, region, accessKey }, { secret });
  return done(null);
}

export async function saveMeta(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const pixelId = field(form, "pixelId").trim();
  if (!/^\d{5,20}$/.test(pixelId)) return { code: "INVALID_PIXEL_ID" };
  const testEventCode = field(form, "testEventCode").trim();
  if (testEventCode && !/^[A-Za-z0-9]{1,40}$/.test(testEventCode)) return { code: "INVALID_TEST_EVENT_CODE" };
  const token = credential(field(form, "token"));
  if (token === undefined || (!token && !(await catalog.credentials("meta"))("meta")("token")))
    return { code: "INVALID_CREDENTIAL" };
  await catalog.saveCredentials("meta", { pixelId, testEventCode }, { token });
  return done(null);
}

// Saves the provider's keys and makes it the one new orders use; orders already issued keep their provider.
export async function savePix(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const provider = orders.pixProvider(field(form, "provider"));
  if (!provider) return { code: "INVALID_PAYLOAD" };
  if (provider !== "static") {
    const apiKey = credential(field(form, "apiKey"));
    const webhookSecret = credential(field(form, "webhookSecret"));
    if (apiKey === undefined || webhookSecret === undefined) return { code: "INVALID_CREDENTIAL" };
    if (provider === "abacatepay" && webhookSecret && webhookSecret.length < 32)
      return { code: "INVALID_WEBHOOK_SECRET" };
    const stored = (await catalog.credentials(provider))(provider);
    const ready = (apiKey || stored("apiKey")) && (provider === "woovi" || webhookSecret || stored("webhookSecret"));
    if (!ready) return { code: "PIX_PROVIDER_NOT_CONFIGURED" };
    await catalog.saveCredentials(provider, {}, { apiKey, webhookSecret });
  }
  await catalog.saveCredentials("pix", { provider });
  return done(null);
}

// A blank address goes back to the Evolution bundled with the server.
export async function saveEvolution(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const url = field(form, "url").trim().replace(/\/+$/, "");
  if (!url) {
    await catalog.removeCredentials("evolution");
    return done(null);
  }
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url) || url.length > 300) return { code: "INVALID_EVOLUTION_URL" };
  const key = credential(field(form, "key"));
  if (key === undefined || (!key && !(await catalog.credentials("evolution"))("evolution")("key")))
    return { code: "INVALID_CREDENTIAL" };
  await catalog.saveCredentials("evolution", { url }, { key });
  return done(null);
}

export async function saveCloud(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const stored = (await catalog.credentials("whatsapp"))("whatsapp");
  const token = credential(field(form, "token")) || stored("token");
  if (!token) return { code: "INVALID_CREDENTIAL" };
  const appSecret = field(form, "appSecret").trim().toLowerCase() || stored("appSecret");
  if (!/^[0-9a-f]{32}$/.test(appSecret)) return { code: "CLOUD_APP_SECRET_INVALID" };
  const phoneId = field(form, "phoneId");
  const pin = field(form, "pin").trim();
  if (phoneId && !/^\d{1,30}$/.test(phoneId)) return { code: "INVALID_PAYLOAD" };
  if (pin && !/^\d{6}$/.test(pin)) return { code: "CLOUD_PIN_INVALID" };
  if (limited("cloud", "connect", 10, 600)) return { code: "RATE_LIMITED" };
  return done(await messages.connectCloud({ token, appSecret, phoneId, pin }));
}

export async function rotateWebhookSecret(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const secret = await orders.rotateWebhookSecret();
  revalidatePath("/", "layout");
  return { code: null, ok: true, secret };
}

// The form field "kind" names the connection; removing the active Pix provider goes back to the static Pix.
export async function removeConnection(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const kind = REMOVABLE.find((entry) => entry === field(form, "kind"));
  if (!kind) return { code: "INVALID_PAYLOAD" };
  await catalog.removeCredentials(kind);
  if ((await catalog.credentials("pix"))("pix")("provider") === kind)
    await catalog.saveCredentials("pix", { provider: "static" });
  return done(null);
}

export async function createProduct(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const name = title(field(form, "name"));
  if (!name) return { code: "INVALID_TITLE" };
  const slug = field(form, "slug").trim() || slugify(name);
  if (!SLUG.test(slug)) return { code: "INVALID_SLUG" };
  const cents = price(field(form, "price"));
  if (!cents) return { code: "INVALID_PRICE" };
  const pix = pixFields(form);
  if ("code" in pix) return pix;
  const code = await catalog.createProduct(slug, { name, price: cents, ...pix });
  if (code) return { code };
  revalidatePath("/", "layout");
  redirect(`/admin?tab=products&product=${slug}`);
}

export async function saveProduct(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const fields = productFields(form);
  return "code" in fields ? fields : done(await catalog.updateProduct(field(form, "slug"), fields));
}

export async function moveItem(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const target = item(form);
  const moved = target && (await catalog.move(target.kind, target.key, field(form, "direction") === "up"));
  return done(moved ? null : "INVALID_TRANSITION");
}

export async function archiveItem(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const target = item(form);
  const changed = target && (await catalog.archive(target.kind, target.key, field(form, "archived") === "1"));
  return done(changed ? null : "INVALID_TRANSITION");
}

export async function saveModule(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const name = title(field(form, "title"));
  if (!name) return { code: "INVALID_TITLE" };
  const cover = media(field(form, "cover"));
  if (cover === undefined) return { code: "INVALID_MEDIA" };
  const id = rowId(field(form, "id"));
  const target = id === undefined ? { product: field(form, "product") } : { id };
  return done((await catalog.saveModule(target, name, cover)) ? null : "INVALID_TRANSITION");
}

export async function saveLesson(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const name = title(field(form, "title"));
  if (!name) return { code: "INVALID_TITLE" };
  const video = media(field(form, "video"));
  if (video === undefined) return { code: "INVALID_MEDIA" };
  const body = text(field(form, "text"), 20_000);
  if (body === undefined) return { code: "INVALID_TEXT" };
  const slug = field(form, "lesson");
  const target = SLUG.test(slug) ? { slug } : { module: rowId(field(form, "module")) ?? 0 };
  return done(
    (await catalog.saveLesson(target, { title: name, video: video ?? "", text: body })) ? null : "INVALID_TRANSITION",
  );
}

export async function saveRecoveryStep(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const unit = integer(field(form, "unit"), 1, 1440) ?? 1;
  const afterMinutes = (integer(field(form, "delay"), 1, 43_200) ?? 0) * unit;
  if (afterMinutes < 1 || afterMinutes >= (await catalog.settings()).orderHours * 60) return { code: "INVALID_DELAY" };
  const channel = field(form, "channel");
  if (channel !== "email" && channel !== "whatsapp") return { code: "INVALID_PAYLOAD" };
  const body = text(field(form, "text"), 2000);
  if (!body) return { code: "INVALID_TEXT" };
  if (!messages.validTemplate(body, messages.RECOVERY_FIELDS)) return { code: "INVALID_TEMPLATE" };

  const saved = await messages.saveRecoveryStep(rowId(field(form, "id")) ?? null, {
    afterMinutes,
    channel,
    text: body,
  });

  return done(saved ? null : "INVALID_TRANSITION");
}

export async function deleteRecoveryStep(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.deleteRecoveryStep(rowId(field(form, "id")) ?? 0)) ? null : "INVALID_TRANSITION");
}

export async function saveReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const keywords = field(form, "keywords")
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (keywords.length === 0 || keywords.some((word) => !printable(word, 60))) return { code: "INVALID_KEYWORDS" };
  const body = text(field(form, "text"), 1000);
  if (!body) return { code: "INVALID_TEXT" };
  if (!messages.validTemplate(body, messages.REPLY_FIELDS)) return { code: "INVALID_TEMPLATE" };
  return done(
    (await messages.saveReply(rowId(field(form, "id")) ?? null, keywords, body)) ? null : "INVALID_TRANSITION",
  );
}

export async function deleteReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.deleteReply(rowId(field(form, "id")) ?? 0)) ? null : "INVALID_TRANSITION");
}

const URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s]{2,500}$/;

// Each settings screen posts only its own fields, so only the keys present in the form are validated and saved.
export async function saveSettings(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const values: catalog.SettingValues = {};
  const sent = (name: string) => form.has(name);

  if (sent("brand")) {
    const brand = title(field(form, "brand"));
    if (!brand) return { code: "INVALID_TITLE" };
    values.brand = brand;
  }

  for (const [name, key] of [
    ["ownerEmail", "owner_email"],
    ["supportEmail", "support_email"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const raw = field(form, name).trim();
    const email = raw ? cleanEmail(raw) : "";
    if (raw && !email) return { code: "INVALID_EMAIL" };
    values[key] = email ?? "";
  }

  for (const [name, key] of [
    ["ownerWhatsapp", "owner_whatsapp"],
    ["supportWhatsapp", "support_whatsapp"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const raw = field(form, name).trim();
    const phone = raw ? cleanPhone(raw) : "";
    if (raw && !phone) return { code: "INVALID_PHONE" };
    values[key] = phone ?? "";
  }

  for (const [name, key] of [
    ["termsUrl", "terms_url"],
    ["privacyUrl", "privacy_url"],
    ["thanksUrl", "thanks_url"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const url = field(form, name).trim();
    if (url && !URL_PATTERN.test(url)) return { code: "INVALID_URL" };
    values[key] = url;
  }

  for (const [name, key, max] of [
    ["termsVersion", "terms_version", 40],
    ["legalName", "legal_name", 120],
    ["description", "description", 200],
    ["checkoutButton", "checkout_button", 40],
    ["checkoutNotice", "checkout_notice", 200],
    ["thanksLabel", "thanks_label", 40],
  ] satisfies [string, keyof catalog.SettingValues, number][]) {
    if (!sent(name)) continue;
    const text = line(field(form, name), max);
    if (text === undefined) return { code: "INVALID_TEXT" };
    values[key] = text ?? "";
  }

  for (const [name, key] of [
    ["logo", "logo"],
    ["icon", "icon"],
    ["shareImage", "share_image"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const path = media(field(form, name));
    if (path === undefined) return { code: "INVALID_MEDIA" };
    values[key] = path ?? "";
  }

  for (const [name, key] of [
    ["poweredBy", "powered_by"],
    ["confirmEmail", "confirm_email"],
    ["checkoutCountdown", "checkout_countdown"],
    ["checkoutTrust", "checkout_trust"],
    ["checkoutGuarantee", "checkout_guarantee"],
    ["checkoutTestimonials", "checkout_testimonials"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (sent(name)) values[key] = field(form, name) === "1" ? "1" : "0";
  }

  if (sent("orderHours")) {
    const orderHours = integer(field(form, "orderHours"), 1, 720);
    const lastStep = (await messages.recoverySteps()).at(-1)?.afterMinutes ?? 0;
    if (orderHours === undefined || lastStep >= orderHours * 60) return { code: "INVALID_ORDER_HOURS" };
    values.order_hours = String(orderHours);
  }

  if (sent("accent")) {
    const accent = field(form, "accent").trim().toLowerCase();
    if (accent && !/^#[0-9a-f]{6}$/.test(accent)) return { code: "INVALID_COLOR" };
    values.accent = accent;
  }

  if (sent("document")) {
    const document = field(form, "document").replace(/\D/g, "");
    if (document && document.length !== 11 && document.length !== 14) return { code: "INVALID_DOCUMENT" };
    values.document = document;
  }

  if (sent("home")) {
    const home = field(form, "home");
    const product = home ? await catalog.getProduct(home) : undefined;
    if (home && (!product || product.archived)) return { code: "PRODUCT_NOT_FOUND" };
    values.home = home;
  }

  if (sent("checkoutPhone")) {
    const mode = catalog.CHECKOUT_PHONE.find((option) => option === field(form, "checkoutPhone"));
    if (!mode) return { code: "INVALID_PAYLOAD" };
    values.checkout_phone = mode;
  }

  if (sent("checkoutTheme")) {
    const theme = catalog.CHECKOUT_THEME.find((option) => option === field(form, "checkoutTheme"));
    if (!theme) return { code: "INVALID_PAYLOAD" };
    values.checkout_theme = theme;
  }

  await catalog.saveSettings(values);
  return done(null);
}

export async function updateStore(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const code = await updates.startUpdate(field(form, "version"));

  return code ? { code } : { code: null, ok: true };
}

export async function restartStore(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const code = await updates.restartStore();

  return code ? { code } : { code: null, ok: true };
}

export async function saveAutoUpdate(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const code = await updates.setAutoUpdate(field(form, "hour"));

  return code ? { code } : done(null);
}
