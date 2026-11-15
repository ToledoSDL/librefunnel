"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import * as catalog from "./catalog";
import type { CatalogCode } from "./catalog";
import * as coupons from "./coupons";
import type { CouponCode } from "./coupons";
import { clientIp, demoMode, isAdmin, limited, signInAdmin, signOutAdmin } from "./guard";
import type { GuardCode } from "./guard";
import * as invoices from "./invoices";
import type { InvoiceCode } from "./invoices";
import { connectStorage, setUpR2, testStorage } from "./media";
import type { MediaCode, StorageCode } from "./media";
import * as members from "./members";
import type { MemberCode } from "./members";
import * as messages from "./messages";
import type { AutomationCode, MessageCode } from "./messages";
import * as charges from "./orders/charges";
import * as checkout from "./orders/checkout";
import * as crypto from "./orders/crypto";
import * as payments from "./orders/payments";
import * as providers from "./orders/psp";
import * as webhooks from "./orders/webhooks";
import type { OrderCode } from "./orders/checkout";
import { fbcFor, metaCookie, recordTouch, sendMetaTest, visitor } from "./tracking";
import type { ConversionCode, TrackCode } from "./tracking";
import * as updates from "./updates";
import type { UpdateCode } from "./updates";
import {
  BUCKET,
  CREDENTIAL,
  HOST,
  ID,
  LINK,
  SLUG,
  parseCents,
  parseCouponCode,
  parseCpfCnpj,
  parseCredential,
  parseEmail,
  parseInteger,
  parseLine,
  parseMedia,
  parseName,
  parsePhone,
  parsePixKey,
  parsePixText,
  parsePrice,
  parsePrintable,
  parseRate,
  parseRowId,
  parseText,
  parseTitle,
} from "./input";
import { formatSlug } from "@/format";
import { company } from "./registry";

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
  | StorageCode
  | InvoiceCode
  | CouponCode;
// secret is set only by rotateWebhookSecret: the one time the generated value reaches the browser.
export type ActionState = { code: Code | null; ok?: boolean; secret?: string };
export type WhatsAppState = ActionState & { qr?: string; pairingCode?: string };
export type CouponState = ActionState & { coupon?: string; discount?: number };
type FormArgs = [state: ActionState, form: FormData];
type Pix = catalog.Product["pix"];

const REMOVABLE = [
  "smtp",
  "meta",
  "mercadopago",
  "woovi",
  "abacatepay",
  "depix",
  "noxpay",
  "webhook",
  "evolution",
  "whatsapp",
  "storage",
  "nfse",
] as const;

const CERTIFICATE_LIMIT = 64 * 1024;
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

// Name and city only label the payment in the payer's bank app, so blank ones come from the CNPJ registry (the key's own
// CNPJ, or the store's) and the store's legal name.
async function pixFields(form: FormData): Promise<Pix | { code: Code }> {
  const key = parsePixKey(field(form, "pixKey"));
  if (!key) return { code: "INVALID_PIX_KEY" };
  const typedName = field(form, "pixName").trim();
  const typedCity = field(form, "pixCity").trim();
  const store = await catalog.settings();
  const cnpj = [key, store.document].find((value) => value && /^\d{14}$/.test(value));
  const found = (!typedName || !typedCity) && cnpj ? await company(cnpj) : undefined;
  const name = parsePixText(typedName || (cnpj === key ? found?.name : "") || store.legalName || store.brand, 25);
  const city = parsePixText(typedCity || found?.town || "", 15);
  if (!name || !city) return { code: "INVALID_PIX_HOLDER" };
  return { key, name, city };
}

function productFields(form: FormData): catalog.ProductFields | { code: Code } {
  const name = parseTitle(field(form, "name"));
  if (!name) return { code: "INVALID_TITLE" };
  const cents = parsePrice(field(form, "price"));
  if (!cents) return { code: "INVALID_PRICE" };
  const tagline = parseLine(field(form, "tagline"));
  const ctaText = parseLine(field(form, "ctaText"), 80);
  const bumpHeadline = parseLine(field(form, "bumpHeadline"));
  if (tagline === undefined || ctaText === undefined || bumpHeadline === undefined) return { code: "INVALID_TEXT" };
  const offer = field(form, "offerEndsAt").trim();
  const offerEndsAt = offer ? new Date(offer) : null;
  if (offerEndsAt && Number.isNaN(offerEndsAt.getTime())) return { code: "INVALID_DATE" };
  const guaranteeDays = parseInteger(field(form, "guaranteeDays"), 7, 365);
  if (guaranteeDays === undefined) return { code: "INVALID_GUARANTEE" };
  const ctaSeconds = parseInteger(field(form, "ctaSeconds") || "0", 0, 7200);
  if (ctaSeconds === undefined) return { code: "INVALID_CTA_SECONDS" };
  const bumpProduct = field(form, "bumpProduct") || null;
  const bumpPrice = field(form, "bumpPrice").trim() ? parsePrice(field(form, "bumpPrice")) : null;
  if (bumpPrice === undefined || (bumpProduct !== null && !SLUG.test(bumpProduct))) return { code: "INVALID_BUMP" };
  const vslVideo = parseMedia(field(form, "vslVideo"));
  const banner = parseMedia(field(form, "banner"));
  const cover = parseMedia(field(form, "cover"));
  if (vslVideo === undefined || banner === undefined || cover === undefined) return { code: "INVALID_MEDIA" };
  const answers = column(form, "faq_a");
  const faq: catalog.Faq[] = [];
  for (const [index, raw] of column(form, "faq_q").entries()) {
    const q = parseLine(raw);
    const a = parseText(answers[index] ?? "", 2000);
    if (q === null && !a) continue;
    if (!q || !a) return { code: "INVALID_FAQ" };
    faq.push({ q, a });
  }
  const quotes = column(form, "testimonial_text");
  const stars = column(form, "testimonial_stars");
  const testimonials: catalog.Testimonial[] = [];
  for (const [index, raw] of column(form, "testimonial_name").entries()) {
    const author = parseTitle(raw);
    const quote = parseText(quotes[index] ?? "", 1000);
    const rating = parseInteger(stars[index] ?? "", 1, 5);
    if (!raw.trim() && !quote) continue;
    if (!author || !quote || rating === undefined) return { code: "INVALID_TESTIMONIAL" };
    testimonials.push({ name: author, text: quote, stars: rating });
  }
  const starts = column(form, "trigger_at");
  const ends = column(form, "trigger_until");
  const kinds = column(form, "trigger_kind");
  const triggers: catalog.Trigger[] = [];
  for (const [index, raw] of column(form, "trigger_text").entries()) {
    const label = parseLine(raw, 80);
    const at = parseInteger(starts[index] ?? "", 0, 7200);
    const until = parseInteger(ends[index] ?? "", 1, 7200);
    if (label === null && !starts[index]?.trim() && !ends[index]?.trim()) continue;
    if (!label || at === undefined || until === undefined || until <= at) return { code: "INVALID_TRIGGER" };
    triggers.push({ at, until, text: label, button: kinds[index] === "button" });
  }
  const barText = parseLine(field(form, "barText"), 120);
  if (barText === undefined) return { code: "INVALID_TEXT" };
  const barColor = field(form, "barColor").trim().toLowerCase() || null;
  if (barColor !== null && !/^#[0-9a-f]{6}$/.test(barColor)) return { code: "INVALID_COLOR" };
  const captions = parseMedia(field(form, "captions"));
  if (captions === undefined) return { code: "INVALID_MEDIA" };
  return {
    name,
    price: cents,
    tagline,
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
  const key = parseRowId(raw);
  return kind === "module" && key !== undefined ? { kind, key } : undefined;
}

export async function createOrder(...[, form]: FormArgs): Promise<ActionState> {
  const product = await catalog.getProduct(field(form, "slug"));
  if (!product) return { code: "PRODUCT_NOT_FOUND" };
  const name = parseName(field(form, "name"));
  if (!name) return { code: "INVALID_NAME" };
  const email = parseEmail(field(form, "email"));
  if (!email) return { code: "INVALID_EMAIL" };
  const { checkoutPhone } = await catalog.settings();
  const rawPhone = checkoutPhone === "hidden" ? "" : field(form, "phone").trim();
  if (!rawPhone && checkoutPhone === "required") return { code: "INVALID_PHONE" };
  const phone = rawPhone ? parsePhone(rawPhone) : null;
  if (phone === undefined) return { code: "INVALID_PHONE" };
  const document = (await invoices.invoicesOn()) ? parseCpfCnpj(field(form, "document")) : null;
  if (document === undefined) return { code: "INVALID_DOCUMENT" };
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  if (limited("order", ip, 20, 600)) return { code: "RATE_LIMITED" };
  const typed = field(form, "coupon").trim();
  const coupon = typed ? await coupons.tryCoupon(typed, product, email, ip) : undefined;
  if (coupon && "code" in coupon) return { code: coupon.code };
  const visitorId = await visitor();
  await recordTouch(visitorId, field(form, "touch"), "", `/c/${product.slug}`);
  const jar = await cookies();

  const result = await checkout.placeOrder({
    product,
    name,
    email,
    phone,
    document,
    coupon,
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
  after(charges.attachCharges);
  redirect(`/c/${product.slug}?order=${result.id}`);
}

// The checkout's "Aplicar" button: the discount it shows is computed here and again when the order is placed.
export async function checkCoupon(...[, form]: FormArgs): Promise<CouponState> {
  const product = await catalog.getProduct(field(form, "slug"));
  if (!product || product.archived) return { code: "PRODUCT_NOT_FOUND" };
  const email = parseEmail(field(form, "email")) ?? null;
  const applied = await coupons.tryCoupon(field(form, "coupon"), product, email, clientIp(await headers()));
  return "code" in applied ? { code: applied.code } : { code: null, ok: true, ...applied };
}

export async function requestLogin(...[, form]: FormArgs): Promise<ActionState> {
  const email = parseEmail(field(form, "email"));
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

export async function simulatePayment(...[, form]: FormArgs): Promise<ActionState> {
  const orderId = field(form, "orderId");
  if (!ID.test(orderId)) return { code: "ORDER_NOT_FOUND" };
  return done(await payments.simulatePayment(orderId));
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
  if (!ID.test(orderId)) return { code: "ORDER_NOT_FOUND" };
  const amount = parseCents(field(form, "amount"));
  if (!amount) return { code: "INVALID_AMOUNT" };
  return done(await payments.releaseOrder(orderId, amount));
}

export async function refundOrder(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done(await payments.refundOrder(field(form, "orderId")));
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
  const body = parseText(field(form, "text"), 2000);
  if (!body) return { code: "INVALID_TEXT" };
  return done(await messages.sendManual(address, body));
}

export async function resendAccess(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.resendAccess(field(form, "orderId"))) ? null : "INVALID_TRANSITION");
}

export async function connectWhatsApp(): Promise<WhatsAppState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const result = await messages.connectWhatsApp();
  revalidatePath("/admin");
  return result;
}

export async function disconnectWhatsApp(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  return done(await messages.disconnectWhatsApp());
}

// The form field "kind" is smtp, meta, evolution, whatsapp, storage or a Pix provider id.
export async function testConnection(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const kind = field(form, "kind");
  const psp = providers.pixProvider(kind);
  const known = ["smtp", "meta", "evolution", "whatsapp", "storage", "nfse"].includes(kind);
  if (!known && (!psp || psp === "static")) return { code: "INVALID_PAYLOAD" };
  if (limited("test", kind, 10, 600)) return { code: "RATE_LIMITED" };
  if (kind === "storage") return done(await testStorage());
  if (kind === "smtp") return done(await messages.testEmail());
  if (kind === "evolution") return done(await messages.testWhatsApp());
  if (kind === "whatsapp") return done(await messages.testCloud());
  if (kind === "meta") return done(await sendMetaTest());
  if (kind === "nfse") return done(await invoices.testNfse());
  return done(psp && psp !== "static" ? await charges.testPsp(psp) : "INVALID_PAYLOAD");
}

export async function saveSmtp(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const preset = messages.SMTP_PRESETS.find((entry) => entry.id === field(form, "preset"));
  const typedHost = field(form, "host").trim().toLowerCase();
  const known = preset || typedHost ? undefined : messages.smtpServer(field(form, "user").trim().toLowerCase());
  const host = preset?.host ?? known?.host ?? typedHost;
  if (!HOST.test(host)) return { code: "INVALID_HOST" };
  const port = preset?.port ?? known?.port ?? parseInteger(field(form, "port") || "587", 1, 65_535);
  if (port === undefined) return { code: "INVALID_PORT" };
  const user = field(form, "user").trim();
  const password = parseCredential(field(form, "password"));
  if (password === undefined || (user && !CREDENTIAL.test(user))) return { code: "INVALID_CREDENTIAL" };
  const rawFrom = field(form, "from").trim();
  const from = rawFrom ? parseEmail(rawFrom) : "";
  if (from === undefined || (!from && !parseEmail(user))) return { code: "INVALID_EMAIL" };
  await catalog.saveCredentials("smtp", { host, port: String(port), user, from }, { password });
  const address = from || parseEmail(user);
  await catalog.fillSettings({ support_email: address, owner_email: address });
  return done(null);
}

export async function connectR2(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const token = field(form, "token").trim();
  if (!/^[\w-]{20,200}$/.test(token)) return { code: "CLOUDFLARE_TOKEN_INVALID" };
  if (limited("test", "storage", 10, 600)) return { code: "RATE_LIMITED" };
  const code = await setUpR2(token);
  return code ? { code } : done(null);
}

export async function saveStorage(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
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
  const secret = parseCredential(field(form, "secret"));
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
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const pixelId = field(form, "pixelId").trim();
  if (!/^\d{5,20}$/.test(pixelId)) return { code: "INVALID_PIXEL_ID" };
  const testEventCode = field(form, "testEventCode").trim();
  if (testEventCode && !/^[A-Za-z0-9]{1,40}$/.test(testEventCode)) return { code: "INVALID_TEST_EVENT_CODE" };
  const token = parseCredential(field(form, "token"));
  if (token === undefined || (!token && !(await catalog.credentials("meta"))("meta")("token")))
    return { code: "INVALID_CREDENTIAL" };
  await catalog.saveCredentials("meta", { pixelId, testEventCode }, { token });
  return done(null);
}

// Saves the provider's keys and makes it the one new orders use; orders already issued keep their provider.
export async function savePix(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const provider = providers.pixProvider(field(form, "provider"));
  if (!provider) return { code: "INVALID_PAYLOAD" };
  if (provider !== "static") {
    const apiKey = parseCredential(field(form, "apiKey"));
    const webhookSecret = parseCredential(field(form, "webhookSecret"));
    const clientId = field(form, "clientId").trim();
    if (apiKey === undefined || webhookSecret === undefined || (clientId && !CREDENTIAL.test(clientId)))
      return { code: "INVALID_CREDENTIAL" };
    if ((provider === "abacatepay" || provider === "depix") && webhookSecret && webhookSecret.length < 32)
      return { code: "INVALID_WEBHOOK_SECRET" };

    const fields =
      provider === "depix" ? { clientId } : provider === "noxpay" ? { currency: field(form, "currency") } : {};

    const stored = providers.pspKeys((await catalog.credentials(provider))(provider));

    const ready = providers.pspConfigured(provider, {
      ...stored,
      ...fields,
      apiKey: apiKey || stored.apiKey,
      webhookSecret: webhookSecret || stored.webhookSecret,
    });

    if (!ready) return { code: "PIX_PROVIDER_NOT_CONFIGURED" };
    await catalog.saveCredentials(provider, fields, { apiKey, webhookSecret });
  }
  await catalog.saveCredentials("pix", { provider });
  return done(null);
}

// The store's key: where the money of "Pix na sua chave" lands, and the fallback code if a provider is down.
export async function savePixKey(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const pix = await pixFields(form);
  if ("code" in pix) return pix;
  await catalog.saveStorePix(pix);
  // A first key in a store that never chose how to receive means receiving on it.
  if (!(await catalog.credentials("pix"))("pix")("provider"))
    await catalog.saveCredentials("pix", { provider: "static" });
  return done(null);
}

// Turning conversion on checks the AppID against Woovi's quote, which needs the same permission as the conversion.
export async function saveWooviCrypto(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const mode = field(form, "mode");
  if (mode !== "off" && mode !== "balance" && mode !== "sale") return { code: "INVALID_PAYLOAD" };
  if (mode === "off") {
    await catalog.saveCredentials("woovi", { convertMode: "off", convertError: "" });
    return done(null);
  }
  const asset = crypto.wooviAsset(field(form, "asset"));
  if (!asset) return { code: "INVALID_PAYLOAD" };
  const wallet = crypto.cryptoWallet(asset, field(form, "wallet"));
  if (!wallet) return { code: "INVALID_WALLET" };
  if (limited("test", "woovi-crypto", 10, 600)) return { code: "RATE_LIMITED" };
  const code = await crypto.testConversion(asset);
  if (code) return { code };
  const previous = (await catalog.credentials("woovi"))("woovi")("convertMode");

  await catalog.saveCredentials("woovi", {
    convertMode: mode,
    convertAsset: asset,
    convertWallet: wallet,
    convertNextAt: "",
    convertError: "",
    // Sales made before conversion per sale was turned on stay in reais.
    ...(mode === "sale" && previous !== "sale" ? { convertSince: String(Date.now()) } : {}),
  });

  return done(null);
}

// A blank address goes back to the Evolution bundled with the server.
export async function saveEvolution(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const url = field(form, "url").trim().replace(/\/+$/, "");
  if (!url) {
    await catalog.removeCredentials("evolution");
    return done(null);
  }
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url) || url.length > 300) return { code: "INVALID_EVOLUTION_URL" };
  const key = parseCredential(field(form, "key"));
  const stored = (await catalog.credentials("evolution"))("evolution");
  // The kept key goes only to the address it was typed for, never to a new one.
  if (key === undefined || (!key && (!stored("key") || stored("url") !== url))) return { code: "INVALID_CREDENTIAL" };
  await catalog.saveCredentials("evolution", { url }, { key });
  return done(null);
}

export async function saveCloud(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const stored = (await catalog.credentials("whatsapp"))("whatsapp");
  const token = parseCredential(field(form, "token")) || stored("token");
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

// The certificate is read once here: only its key and chain are kept, sealed; the file and its password are not.
// Blank fiscal fields come from the CNPJ registry, so a first connection needs only the certificate.
export async function saveNfse(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const file = form.get("certificate");
  const fresh = file instanceof File && file.size > 0;
  if (fresh && file.size > CERTIFICATE_LIMIT) return { code: "CERTIFICATE_UNREADABLE" };
  const stored = (await catalog.credentials("nfse"))("nfse");
  if (!fresh && !stored("chain")) return { code: "CERTIFICATE_UNREADABLE" };
  if (limited("test", "nfse", 10, 600)) return { code: "RATE_LIMITED" };

  const certificate = fresh
    ? await invoices.readCertificate(Buffer.from(await file.arrayBuffer()), field(form, "password"))
    : undefined;

  if (typeof certificate === "string") return { code: certificate };
  // A certificate of another company drops the fields typed for the previous one.
  const same = !certificate || certificate.cnpj === stored("cnpj");
  const typedCity = same ? field(form, "city").trim() : "";
  const typedRegime = same ? invoices.regime(field(form, "regime")) : undefined;
  const cnpj = certificate?.cnpj ?? stored("cnpj");
  const found = typedCity && typedRegime ? undefined : await company(cnpj);
  const city = typedCity || found?.city;
  const regime = typedRegime ?? (found && invoices.regimeOf(found));
  if (!city || !regime) return { code: "CNPJ_LOOKUP_FAILED" };
  if (!/^\d{7}$/.test(city)) return { code: "INVALID_CITY" };
  const service = (same ? field(form, "service") : "").replace(/\D/g, "") || "080201";
  if (!/^\d{6}$/.test(service)) return { code: "INVALID_SERVICE" };
  const registration = same ? field(form, "registration").trim() : "";
  if (registration && !/^[A-Za-z0-9.\-/]{1,15}$/.test(registration)) return { code: "INVALID_PAYLOAD" };
  const defaults = invoices.DEFAULT_RATES[regime];
  const taxRate = regime === "mei" ? "" : parseRate((same && field(form, "taxRate")) || defaults.taxRate);
  const issRate = regime === "normal" ? parseRate((same && field(form, "issRate")) || defaults.issRate) : "";
  if (taxRate === undefined || issRate === undefined) return { code: "INVALID_RATE" };

  await catalog.saveCredentials(
    "nfse",
    {
      city,
      place: found ? `${found.town}/${found.uf}` : city === stored("city") ? stored("place") : "",
      regime,
      service,
      registration,
      taxRate,
      issRate,
      ...(certificate
        ? { cnpj: certificate.cnpj, holder: certificate.holder, expiresAt: certificate.expiresAt.toISOString() }
        : {}),
    },
    certificate ? { key: certificate.key, chain: certificate.chain } : {},
  );
  await catalog.fillSettings({ legal_name: found?.name ?? certificate?.holder, document: cnpj });
  return done(await invoices.testNfse());
}

export async function retryInvoice(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const orderId = field(form, "orderId");
  if (!ID.test(orderId)) return { code: "ORDER_NOT_FOUND" };
  return done(await invoices.retryInvoice(orderId));
}

export async function rotateWebhookSecret(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const secret = await webhooks.rotateWebhookSecret();
  revalidatePath("/", "layout");
  return { code: null, ok: true, secret };
}

// The form field "kind" names the connection; removing the active Pix provider goes back to the static Pix.
export async function removeConnection(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const kind = REMOVABLE.find((entry) => entry === field(form, "kind"));
  if (!kind) return { code: "INVALID_PAYLOAD" };
  await catalog.removeCredentials(kind);
  if ((await catalog.credentials("pix"))("pix")("provider") === kind)
    await catalog.saveCredentials("pix", { provider: "static" });
  return done(null);
}

export async function createProduct(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const name = parseTitle(field(form, "name"));
  if (!name) return { code: "INVALID_TITLE" };
  const slug = field(form, "slug").trim() || formatSlug(name);
  if (!SLUG.test(slug)) return { code: "INVALID_SLUG" };
  const cents = parsePrice(field(form, "price"));
  if (!cents) return { code: "INVALID_PRICE" };
  // The second step asks for the store's key only when the store has none yet, and saves it for every product.
  let pix = await catalog.storePix();
  if (!pix) {
    const typed = await pixFields(form);
    if ("code" in typed) return typed;
    await catalog.saveStorePix(typed);
    pix = typed;
  }
  const code = await catalog.createProduct(slug, { name, price: cents }, pix);
  if (code) return { code };
  revalidatePath("/", "layout");
  redirect(`/admin?tab=products&product=${slug}`);
}

export async function saveProduct(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const fields = productFields(form);
  return "code" in fields ? fields : done(await catalog.updateProduct(field(form, "slug"), fields));
}

export async function saveCoupon(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const code = parseCouponCode(field(form, "code"));
  if (!code) return { code: "INVALID_COUPON_CODE" };
  const kind = field(form, "kind");
  if (kind !== "percent" && kind !== "fixed") return { code: "INVALID_PAYLOAD" };
  const value = kind === "percent" ? parseInteger(field(form, "value"), 1, 99) : parsePrice(field(form, "value"));
  if (value === undefined) return { code: "INVALID_DISCOUNT" };
  const expiry = field(form, "expiresAt").trim();
  const expiresAt = expiry ? new Date(expiry) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return { code: "INVALID_DATE" };
  const uses = field(form, "maxUses").trim();
  const maxUses = uses ? parseInteger(uses, 1, 1_000_000) : null;
  if (maxUses === undefined) return { code: "INVALID_USES" };
  const products = column(form, "products");
  if (products.some((slug) => !SLUG.test(slug))) return { code: "INVALID_PAYLOAD" };

  const saved = await coupons.saveCoupon(
    { code, kind, value, products, expiresAt, maxUses, oncePerEmail: field(form, "oncePerEmail") === "1" },
    field(form, "editing") !== "1",
  );

  return done(saved);
}

export async function deleteCoupon(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await coupons.deleteCoupon(field(form, "code"))) ? null : "INVALID_TRANSITION");
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
  const name = parseTitle(field(form, "title"));
  if (!name) return { code: "INVALID_TITLE" };
  const cover = parseMedia(field(form, "cover"));
  if (cover === undefined) return { code: "INVALID_MEDIA" };
  const id = parseRowId(field(form, "id"));
  const target = id === undefined ? { product: field(form, "product") } : { id };
  return done((await catalog.saveModule(target, name, cover)) ? null : "INVALID_TRANSITION");
}

export async function saveLesson(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const name = parseTitle(field(form, "title"));
  if (!name) return { code: "INVALID_TITLE" };
  const video = parseMedia(field(form, "video"));
  if (video === undefined) return { code: "INVALID_MEDIA" };
  const body = parseText(field(form, "text"), 20_000);
  if (body === undefined) return { code: "INVALID_TEXT" };
  const slug = field(form, "lesson");
  const target = SLUG.test(slug) ? { slug } : { module: parseRowId(field(form, "module")) ?? 0 };
  return done(
    (await catalog.saveLesson(target, { title: name, video: video ?? "", text: body })) ? null : "INVALID_TRANSITION",
  );
}

export async function saveRecoveryStep(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const unit = parseInteger(field(form, "unit"), 1, 1440) ?? 1;
  const afterMinutes = (parseInteger(field(form, "delay"), 1, 43_200) ?? 0) * unit;
  if (afterMinutes < 1 || afterMinutes >= (await catalog.settings()).orderHours * 60) return { code: "INVALID_DELAY" };
  const channel = field(form, "channel");
  if (channel !== "email" && channel !== "whatsapp") return { code: "INVALID_PAYLOAD" };
  const body = parseText(field(form, "text"), 2000);
  if (!body) return { code: "INVALID_TEXT" };
  if (!messages.validTemplate(body, messages.RECOVERY_FIELDS)) return { code: "INVALID_TEMPLATE" };

  const saved = await messages.saveRecoveryStep(parseRowId(field(form, "id")) ?? null, {
    afterMinutes,
    channel,
    text: body,
  });

  return done(saved ? null : "INVALID_TRANSITION");
}

export async function deleteRecoveryStep(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.deleteRecoveryStep(parseRowId(field(form, "id")) ?? 0)) ? null : "INVALID_TRANSITION");
}

export async function saveReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const keywords = field(form, "keywords")
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (keywords.length === 0 || keywords.some((word) => !parsePrintable(word, 60))) return { code: "INVALID_KEYWORDS" };
  const body = parseText(field(form, "text"), 1000);
  if (!body) return { code: "INVALID_TEXT" };
  if (!messages.validTemplate(body, messages.REPLY_FIELDS)) return { code: "INVALID_TEMPLATE" };
  return done(
    (await messages.saveReply(parseRowId(field(form, "id")) ?? null, keywords, body)) ? null : "INVALID_TRANSITION",
  );
}

export async function deleteReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.deleteReply(parseRowId(field(form, "id")) ?? 0)) ? null : "INVALID_TRANSITION");
}

// Each settings screen posts only its own fields, so only the keys present in the form are validated and saved.
export async function saveSettings(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const values: catalog.SettingValues = {};
  const sent = (name: string) => form.has(name);

  if (sent("brand")) {
    const brand = parseTitle(field(form, "brand"));
    if (!brand) return { code: "INVALID_TITLE" };
    values.brand = brand;
  }

  for (const [name, key] of [
    ["ownerEmail", "owner_email"],
    ["supportEmail", "support_email"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const raw = field(form, name).trim();
    const email = raw ? parseEmail(raw) : "";
    if (raw && !email) return { code: "INVALID_EMAIL" };
    values[key] = email ?? "";
  }

  for (const [name, key] of [
    ["ownerWhatsapp", "owner_whatsapp"],
    ["supportWhatsapp", "support_whatsapp"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const raw = field(form, name).trim();
    const phone = raw ? parsePhone(raw) : "";
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
    if (url && !LINK.test(url)) return { code: "INVALID_URL" };
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
    const text = parseLine(field(form, name), max);
    if (text === undefined) return { code: "INVALID_TEXT" };
    values[key] = text ?? "";
  }

  for (const [name, key] of [
    ["logo", "logo"],
    ["icon", "icon"],
    ["shareImage", "share_image"],
  ] satisfies [string, keyof catalog.SettingValues][]) {
    if (!sent(name)) continue;
    const path = parseMedia(field(form, name));
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
    const orderHours = parseInteger(field(form, "orderHours"), 1, 720);
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
    const document = parseCpfCnpj(field(form, "document"));
    if (document === undefined) return { code: "INVALID_DOCUMENT" };
    values.document = document ?? "";
    // A CNPJ brings its legal name when that field was left blank.
    if (document?.length === 14 && sent("legalName") && !values.legal_name)
      values.legal_name = (await company(document))?.name ?? "";
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
  if (demoMode()) return { code: "DEMO_BLOCKED" };

  const code = await updates.startUpdate(field(form, "version"));

  return code ? { code } : { code: null, ok: true };
}

export async function restartStore(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };

  const code = await updates.restartStore();

  return code ? { code } : { code: null, ok: true };
}

export async function saveAutoUpdate(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };

  const code = await updates.setAutoUpdate(field(form, "hour"));

  return code ? { code } : done(null);
}
