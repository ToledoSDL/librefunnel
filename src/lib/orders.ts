import "server-only";
import { createHmac, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import QRCode from "qrcode";
import { credentials, orderBump, saveCredentials, settings } from "./catalog";
import type { Credentials, Product } from "./catalog";
import { addSeconds, db, newId, one } from "./db";
import type { Database } from "./db";
import { firstName, hmacHex, isObject, jsonObject, maskEmail, readBody, safeEqual } from "./guard";
import type { GuardCode, Json, JsonObject } from "./guard";
import { enqueueSale, recoverySteps } from "./messages";
import { conversion, customer, order, payment } from "./schema";

export type OrderStatus = (typeof order.$inferSelect)["status"];
export type OrderCode =
  | "PRODUCT_NOT_FOUND"
  | "OFFER_ENDED"
  | "INVALID_NAME"
  | "INVALID_EMAIL"
  | "INVALID_PHONE"
  | "RATE_LIMITED"
  | "ORDER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_AMOUNT"
  | "UNDERPAID"
  | "DUPLICATE_PAYMENT"
  | "PSP_NOT_CONFIGURED"
  | "PSP_REJECTED"
  | "PSP_UNREACHABLE";
export type Psp = (typeof PSPS)[number];
export type PixProvider = "static" | Psp;
export type PixOrder = {
  id: string;
  product: string;
  bump: string | null;
  amount: number;
  firstName: string;
  maskedEmail: string;
  status: OrderStatus;
  txid: string;
  pixCode: string;
  expiresAt: Date;
};
export type OrderInput = {
  product: Product;
  name: string;
  email: string;
  phone: string | null;
  bump: boolean;
  ownOrder: string | undefined;
  visitorId: string;
  ip: string;
  userAgent: string;
  fbp: string | null;
  fbc: string | null;
};

type StoredOrder = {
  id: string;
  status: OrderStatus;
  amount: number;
  customerId: string;
  email: string;
  phone: string | null;
  name: string;
  product: string;
  bump: string | null;
};
type PspKeys = { apiKey: string; webhookSecret: string; publicKeys: string[] };
type PspResponse = { status: number; body: JsonObject | undefined; raw: string; retryIn: number };
type ChargeRow = { id: string; amount: number; name: string; email: string; phone: string | null };
type Movement = { amount: number; externalId: string };
type Fetched = { retryIn: number } | { movements: Movement[]; raw: string };
type Notice = { code: GuardCode | "PSP_UNREACHABLE"; status: number } | { match: SQL | undefined };

// One shape per provider: a refund or MED in the re-fetched state yields only debits, so it is never released.
type Adapter = {
  create: (
    row: ChargeRow,
    apiKey: string,
    seconds: number,
  ) => Promise<{ txid: string; pixCode: string } | { status: number }>;
  fetch: (row: { id: string; txid: string }, keys: PspKeys) => Promise<Fetched>;
  notice: (raw: string, keys: PspKeys, headers: Headers, url: URL) => Notice;
  test: (keys: PspKeys) => Promise<OrderCode | null>;
};

const ORDER_ID = /^[a-z0-9]{20}$/;
const WEBHOOK_LIMIT = 64 * 1024;
const PSPS = ["mercadopago", "woovi", "abacatepay"] as const;

const PSP_HOSTS: Record<Psp, string> = {
  mercadopago: "https://api.mercadopago.com",
  woovi: "https://api.woovi.com",
  abacatepay: "https://api.abacatepay.com",
};

// Neither Woovi nor AbacatePay documents a maximum expiry; 72 hours is the longest value their docs show working.
const PSP_MAX_SECONDS = 72 * 3600;

// Published on AbacatePay's webhook security page; the same for every account.
const ABACATEPAY_SIGNING_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

export const PIX_PROVIDERS: { id: PixProvider; name: string; needsCnpj: boolean; fee: string; events: string[] }[] = [
  {
    id: "static",
    name: "Pix direto na sua chave",
    needsCnpj: false,
    fee: "Sem taxa. Você confere cada Pix no extrato e libera o pedido.",
    events: [],
  },
  {
    id: "mercadopago",
    name: "Mercado Pago",
    needsCnpj: false,
    fee: "0,99% por venda.",
    events: ["Order (Mercado Pago)"],
  },
  {
    id: "woovi",
    name: "Woovi",
    needsCnpj: true,
    fee: "0,80% por Pix (mínimo R$ 0,50, máximo R$ 5,00) ou R$ 0,85 por Pix, conforme o plano.",
    events: ["OPENPIX:CHARGE_COMPLETED", "PIX_TRANSACTION_REFUND_SENT_CONFIRMED", "OPENPIX:DISPUTE_ACCEPTED"],
  },
  {
    id: "abacatepay",
    name: "AbacatePay",
    needsCnpj: true,
    fee: "R$ 0,80 por Pix.",
    events: ["transparent.completed", "transparent.refunded", "transparent.disputed", "transparent.lost"],
  },
];

export function offerOpen(product: Product): boolean {
  return product.offerEndsAt === undefined || product.offerEndsAt > new Date();
}

export function parseCents(raw: string): number | undefined {
  const compact = raw.trim().replace(/^R\$\s*/i, "");
  const decimal = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Static BR Code per BCB "Manual de Padroes para Iniciacao do Pix"; key, name and city are normalized when saved.
export function brCode(pix: Product["pix"], amount: number | null, txid: string): string {
  const value =
    amount === null ? "" : tlv("54", `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`);

  const body =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", pix.key)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    value +
    tlv("58", "BR") +
    tlv("59", pix.name) +
    tlv("60", pix.city) +
    tlv("62", tlv("05", txid)) +
    "6304";

  return body + crc16(body);
}

export function pixQrSvg(pixCode: string): Promise<string> {
  return QRCode.toString(pixCode, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export async function getPixOrder(id: string, slug: string): Promise<PixOrder | undefined> {
  if (!ORDER_ID.test(id)) return undefined;

  const [row] = await db()
    .select({
      id: order.id,
      product: order.product,
      bump: order.bump,
      amount: order.amount,
      name: order.name,
      email: customer.email,
      status: order.status,
      txid: order.txid,
      pixCode: order.pixCode,
      expiresAt: order.expiresAt,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.id, id), eq(order.product, slug)));

  if (!row) return undefined;
  return {
    id: row.id,
    product: row.product,
    bump: row.bump,
    amount: row.amount,
    firstName: firstName(row.name),
    maskedEmail: maskEmail(row.email),
    status: row.status === "pending" && row.expiresAt <= new Date() ? "expired" : row.status,
    txid: row.txid,
    pixCode: row.pixCode,
    expiresAt: row.expiresAt,
  };
}

export async function placeOrder(input: OrderInput): Promise<{ id: string } | { code: OrderCode }> {
  if (input.product.archived) return { code: "PRODUCT_NOT_FOUND" };
  if (!offerOpen(input.product)) return { code: "OFFER_ENDED" };
  const bump = input.bump ? await orderBump(input.product) : undefined;
  const store = await settings();
  const firstStep = (await recoverySteps())[0];
  const t = new Date();
  return db().transaction(async (tx) => {
    // The upsert locks the customer row, so one buyer's concurrent checkouts run one after the other.
    const { id: customerId } = one(
      await tx
        .insert(customer)
        .values({ id: newId(), email: input.email, createdAt: t })
        .onConflictDoUpdate({ target: customer.email, set: { email: sql`excluded.email` } })
        .returning({ id: customer.id }),
    );

    const [open] = await tx
      .select({ id: order.id, bump: order.bump, name: order.name, phone: order.phone, expiresAt: order.expiresAt })
      .from(order)
      .where(and(eq(order.customerId, customerId), eq(order.product, input.product.slug), eq(order.status, "pending")));

    if (open) {
      // Only the browser that placed the order gets it back: anyone else typing the buyer's details would receive their order id.
      const same =
        open.id === input.ownOrder &&
        open.bump === (bump?.slug ?? null) &&
        open.name === input.name &&
        open.phone === input.phone;

      if (same && open.expiresAt > t) return { id: open.id };
      await tx
        .update(order)
        .set({ status: sql`CASE WHEN ${lte(order.expiresAt, t)} THEN 'expired' ELSE 'canceled' END`, recoveryAt: null })
        .where(and(eq(order.id, open.id), eq(order.status, "pending")));
    }
    const id = newId();
    const amount = input.product.price + (bump?.bumpPrice ?? 0);
    await tx.insert(order).values({
      id,
      customerId,
      product: input.product.slug,
      bump: bump?.slug ?? null,
      productAmount: input.product.price,
      bumpAmount: bump?.bumpPrice ?? null,
      name: input.name,
      phone: input.phone,
      txid: id,
      pixCode: brCode(input.product.pix, amount, id),
      expiresAt: addSeconds(t, store.orderHours * 3600),
      recoveryAt: firstStep ? addSeconds(t, firstStep.afterMinutes * 60) : null,
      visitorId: input.visitorId,
      ip: input.ip,
      userAgent: input.userAgent,
      fbp: input.fbp,
      fbc: input.fbc,
      termsVersion: store.termsVersion,
      createdAt: t,
    });
    await tx.insert(conversion).values({ orderId: id, name: "InitiateCheckout", nextAt: t }).onConflictDoNothing();
    return { id };
  });
}

export async function expireOrders() {
  await db()
    .update(order)
    .set({ status: "expired", recoveryAt: null })
    .where(and(eq(order.status, "pending"), lte(order.expiresAt, new Date())));
}

// Locks the order row: concurrent webhooks and owner releases for one order run one after the other.
async function findOrder(tx: Database, reference: string): Promise<StoredOrder | undefined> {
  const [row] = await tx
    .select({
      id: order.id,
      status: order.status,
      amount: order.amount,
      customerId: order.customerId,
      email: customer.email,
      phone: order.phone,
      name: order.name,
      product: order.product,
      bump: order.bump,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(or(eq(order.id, reference), eq(order.txid, reference)))
    .for("update", { of: order });

  return row;
}

async function insertPayment(
  tx: Database,
  orderId: string,
  amount: number,
  source: "webhook" | "admin",
  externalId: string | null,
  payload: string | null,
): Promise<number | undefined> {
  const inserted = await tx
    .insert(payment)
    .values({ orderId, amount, source, externalId, payload, createdAt: new Date() })
    .onConflictDoNothing({ target: payment.externalId })
    .returning({ id: payment.id });

  return inserted.length === 0 ? undefined : received(tx, orderId);
}

async function received(tx: Database, orderId: string): Promise<number> {
  const { net } = one(
    await tx
      .select({ net: sql<number>`COALESCE(SUM(${payment.amount}), 0)`.mapWith(Number) })
      .from(payment)
      .where(eq(payment.orderId, orderId)),
  );

  return net;
}

async function markPaid(tx: Database, found: StoredOrder): Promise<OrderCode | null> {
  const changed = await tx
    .update(order)
    .set({ status: "paid", recoveryAt: null, pspCheckAt: null })
    .where(and(eq(order.id, found.id), eq(order.status, found.status)))
    .returning({ id: order.id });

  if (changed.length !== 1) return "INVALID_TRANSITION";
  await tx.insert(conversion).values({ orderId: found.id, name: "Purchase", nextAt: new Date() }).onConflictDoNothing();
  await enqueueSale(tx, found);
  return null;
}

function recordPayment(
  reference: string,
  amount: number,
  externalId: string,
  payload: string,
): Promise<OrderCode | null> {
  return db().transaction(async (tx) => {
    const found = await findOrder(tx, reference);
    if (!found) return "ORDER_NOT_FOUND";
    const settled = found.status === "paid" || found.status === "refunded";
    // A released order is never debited past what it received (a refund, then the MED for the same Pix).
    const debit = amount < 0 && settled ? -Math.min(-amount, await received(tx, found.id)) : amount;
    const net = debit === 0 ? 0 : await insertPayment(tx, found.id, debit, "webhook", externalId, payload);
    if (net === undefined) return "DUPLICATE_PAYMENT";
    if (amount < 0) {
      await tx
        .update(order)
        .set({ status: "refunded" })
        .where(and(eq(order.id, found.id), eq(order.status, "paid")));
      return null;
    }
    if (settled) return null;
    return net < found.amount ? "UNDERPAID" : markPaid(tx, found);
  });
}

export async function releaseOrder(orderId: string, amount: number): Promise<OrderCode | null> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return "INVALID_AMOUNT";
  return db().transaction(async (tx) => {
    const found = await findOrder(tx, orderId);
    if (!found) return "ORDER_NOT_FOUND";
    if (found.status === "paid" || found.status === "refunded") return "INVALID_TRANSITION";
    await insertPayment(tx, found.id, amount, "admin", null, null);
    return markPaid(tx, found);
  });
}

export function refundOrder(orderId: string): Promise<OrderCode | null> {
  return db().transaction(async (tx) => {
    const [found] = await tx
      .select({
        status: order.status,
        net: sql<number>`${tx
          .select({ net: sql`COALESCE(SUM(${payment.amount}), 0)` })
          .from(payment)
          .where(eq(payment.orderId, order.id))}`.mapWith(Number),
      })
      .from(order)
      .where(eq(order.id, orderId))
      .for("update");

    if (!found) return "ORDER_NOT_FOUND";
    if (found.status !== "paid") return "INVALID_TRANSITION";
    if (found.net > 0) await insertPayment(tx, orderId, -found.net, "admin", null, null);
    await tx
      .update(order)
      .set({ status: "refunded" })
      .where(and(eq(order.id, orderId), eq(order.status, "paid")));
    return null;
  });
}

function webhookReply(body: { ok: true } | { code: string }, status = 200): Response {
  return Response.json(body, { status });
}

export function pixProvider(value: string): PixProvider | undefined {
  return PIX_PROVIDERS.find((provider) => provider.id === value)?.id;
}

function pspOf(value: string | null): Psp | undefined {
  return PSPS.find((psp) => psp === value);
}

function pspKeys(stored: (kind: Psp) => Credentials<Psp>, psp: Psp): PspKeys {
  const read = stored(psp);
  return {
    apiKey: read("apiKey"),
    webhookSecret: read("webhookSecret"),
    publicKeys: read("publicKeys").split(",").filter(Boolean),
  };
}

// Woovi signs with keys only, so its optional webhook authorization is not required.
function pspConfigured(psp: Psp, keys: PspKeys): boolean {
  return keys.apiKey !== "" && (psp === "woovi" || keys.webhookSecret !== "");
}

export async function rotateWebhookSecret(): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  await saveCredentials("webhook", {}, { secret });
  return secret;
}

export async function paymentWebhook(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("psp");
  const psp = pspOf(name);
  if (!psp) {
    const secret = name === null ? (await credentials("webhook"))("webhook")("secret") : "";
    if (!secret) return new Response(null, { status: 404 });
    const raw = await readBody(request, WEBHOOK_LIMIT);
    return raw === undefined
      ? webhookReply({ code: "PAYLOAD_TOO_LARGE" }, 413)
      : genericWebhook(request.headers, raw, secret);
  }

  const keys = pspKeys(await credentials(psp), psp);
  if (!pspConfigured(psp, keys)) return new Response(null, { status: 404 });
  const raw = await readBody(request, WEBHOOK_LIMIT);
  if (raw === undefined) return webhookReply({ code: "PAYLOAD_TOO_LARGE" }, 413);
  const notice = ADAPTERS[psp].notice(raw, keys, request.headers, url);
  if ("code" in notice) return webhookReply({ code: notice.code }, notice.status);
  if (!notice.match) return webhookReply({ ok: true });

  // The webhook only schedules a re-fetch; a retry time set by a 429 is kept.
  const marked = await db()
    .update(order)
    .set({ pspCheckAt: sql`GREATEST(${order.pspCheckAt}, ${new Date().toISOString()}::timestamptz)` })
    .where(and(notice.match, eq(order.psp, psp)))
    .returning({ id: order.id });

  return webhookReply(marked.length ? { ok: true } : { code: "ORDER_NOT_FOUND" });
}

async function genericWebhook(headers: Headers, raw: string, secret: string): Promise<Response> {
  if (!safeEqual(headers.get("x-signature") ?? "", hmacHex(secret, raw)))
    return webhookReply({ code: "INVALID_SIGNATURE" }, 401);
  const body = jsonObject(raw);
  const reference = body?.order;
  const status = body?.status;
  const amount = body?.amount;
  const id = body?.id;
  if (
    typeof reference !== "string" ||
    reference.length > 64 ||
    (status !== "paid" && status !== "refunded") ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 200
  ) {
    return webhookReply({ code: "INVALID_PAYLOAD" }, 400);
  }
  const code = await recordPayment(reference, status === "paid" ? amount : -amount, id, raw);
  return webhookReply(code ? { code } : { ok: true });
}

async function callPsp(
  psp: Psp,
  apiKey: string,
  path: string,
  body?: Json,
  idempotencyKey?: string,
): Promise<PspResponse> {
  const response = await fetch(`${PSP_HOSTS[psp]}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: psp === "woovi" ? apiKey : `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  const wait = Number(response.headers.get("retry-after") ?? response.headers.get("ratelimit-reset") ?? "");
  return {
    status: response.status,
    body: jsonObject(raw),
    raw,
    retryIn: Number.isFinite(wait) && wait >= 1 ? Math.min(Math.ceil(wait), 3600) : 60,
  };
}

function busy(response: PspResponse): boolean {
  return response.status === 429 || response.status >= 500;
}

function mismatch(psp: Psp, orderId: string, status: number): Fetched {
  console.warn(`[librefunnel] ${psp} charge for ${orderId} did not match (HTTP ${status})`);
  return { movements: [], raw: "" };
}

function credentialsReply(response: PspResponse): OrderCode | null {
  if (response.status < 300) return null;
  return response.status === 401 || response.status === 403 ? "PSP_REJECTED" : "PSP_UNREACHABLE";
}

function reais(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function firstPayment(charge: JsonObject | undefined): JsonObject | undefined {
  const transactions = charge?.transactions;
  const payments = isObject(transactions) ? transactions.payments : undefined;
  const first = Array.isArray(payments) ? payments[0] : undefined;
  return isObject(first) ? first : undefined;
}

function objects(value: Json | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function cents(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

// Accepts the key as PEM, base64 of a PEM or base64 DER, and keeps it as base64 DER so the list fits one field.
function spki(text: string): string {
  const pem = text.includes("-----BEGIN") ? text : Buffer.from(text, "base64").toString("utf8");

  const key = pem.includes("-----BEGIN")
    ? createPublicKey(pem)
    : createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });

  return key.export({ type: "spki", format: "der" }).toString("base64");
}

function wooviSigned(raw: string, signature: string, keys: string[]): boolean {
  return keys.some((der) => {
    try {
      return createVerify("sha256")
        .update(raw)
        .verify(createPublicKey({ key: Buffer.from(der, "base64"), format: "der", type: "spki" }), signature, "base64");
    } catch {
      return false;
    }
  });
}

// Mercado Pago signs `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
function mercadoPagoNotice(raw: string, keys: PspKeys, headers: Headers, url: URL): Notice {
  const parts = new Map(
    (headers.get("x-signature") ?? "").split(",").map((part) => {
      const [name = "", value = ""] = part.split("=");
      return [name.trim(), value.trim()];
    }),
  );

  const data = jsonObject(raw)?.data;
  const dataId = url.searchParams.get("data.id") ?? (isObject(data) && typeof data.id === "string" ? data.id : "");
  const requestId = headers.get("x-request-id");
  const ts = parts.get("ts");

  const manifest = [
    dataId ? `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};` : "",
    requestId ? `request-id:${requestId};` : "",
    ts ? `ts:${ts};` : "",
  ].join("");

  if (!ts || !safeEqual(parts.get("v1") ?? "", hmacHex(keys.webhookSecret, manifest)))
    return { code: "INVALID_SIGNATURE", status: 401 };
  if (!dataId) return { code: "INVALID_PAYLOAD", status: 400 };
  return { match: eq(order.txid, dataId) };
}

// Woovi's key is shared by every Woovi merchant: it proves the sender, not the account, hence the re-fetch with our AppID.
function wooviNotice(raw: string, keys: PspKeys, headers: Headers): Notice {
  const body = jsonObject(raw);
  const charge = body?.charge;
  const source = [body?.originalTransaction, body?.dispute].find(isObject);
  const correlationId = isObject(charge) && typeof charge.correlationID === "string" ? charge.correlationID : undefined;
  const endToEndId = typeof source?.endToEndId === "string" ? source.endToEndId : undefined;
  if (!correlationId && !endToEndId) return { match: undefined };
  const authorization = [headers.get("x-openpix-authorization"), headers.get("authorization")];
  if (keys.webhookSecret && !authorization.some((value) => safeEqual(value ?? "", keys.webhookSecret)))
    return { code: "INVALID_SIGNATURE", status: 401 };
  if (keys.publicKeys.length === 0) return { code: "PSP_UNREACHABLE", status: 503 };
  if (!wooviSigned(raw, headers.get("x-webhook-signature") ?? "", keys.publicKeys))
    return { code: "INVALID_SIGNATURE", status: 401 };
  if (correlationId) return { match: eq(order.txid, correlationId) };

  const paidBy = db()
    .select({ id: payment.orderId })
    .from(payment)
    .where(eq(payment.externalId, `woovi:${endToEndId}`));

  return { match: inArray(order.id, paidBy) };
}

// The secret authenticates; the signature key is public and only proves the body was not altered.
function abacatePayNotice(raw: string, keys: PspKeys, headers: Headers, url: URL): Notice {
  const secret = headers.get("x-webhook-secret") ?? url.searchParams.get("webhookSecret") ?? "";
  const signature = createHmac("sha256", ABACATEPAY_SIGNING_KEY).update(raw).digest("base64");
  if (!safeEqual(secret, keys.webhookSecret) || !safeEqual(headers.get("x-webhook-signature") ?? "", signature))
    return { code: "INVALID_SIGNATURE", status: 401 };
  const data = jsonObject(raw)?.data;
  const charge = isObject(data) ? data.transparent : undefined;
  return { match: isObject(charge) && typeof charge.id === "string" ? eq(order.txid, charge.id) : undefined };
}

const ADAPTERS: Record<Psp, Adapter> = {
  mercadopago: {
    async create(row, apiKey, seconds) {
      const value = reais(row.amount);

      const response = await callPsp(
        "mercadopago",
        apiKey,
        "/v1/orders",
        {
          type: "online",
          processing_mode: "automatic",
          total_amount: value,
          external_reference: row.id,
          payer: { email: row.email, first_name: firstName(row.name) },
          transactions: {
            payments: [
              {
                amount: value,
                payment_method: { id: "pix", type: "bank_transfer" },
                expiration_time: `PT${Math.min(43_200, Math.max(30, Math.floor(seconds / 60)))}M`,
              },
            ],
          },
        },
        row.id,
      );

      const method = firstPayment(response.body)?.payment_method;
      const qrCode = isObject(method) ? method.qr_code : undefined;
      const chargeId = response.body?.id;
      return response.status < 300 && typeof qrCode === "string" && typeof chargeId === "string"
        ? { txid: chargeId, pixCode: qrCode }
        : { status: response.status };
    },
    async fetch(row, keys) {
      const response = await callPsp("mercadopago", keys.apiKey, `/v1/orders/${encodeURIComponent(row.txid)}`);
      if (busy(response)) return { retryIn: response.retryIn };
      const charge = response.body;
      const first = firstPayment(charge);
      const paymentId = first?.id;
      if (response.status >= 300 || !charge || charge.external_reference !== row.id || typeof paymentId !== "string")
        return mismatch("mercadopago", row.id, response.status);
      const paid = typeof charge.total_paid_amount === "string" ? parseCents(charge.total_paid_amount) : undefined;
      const total = typeof charge.total_amount === "string" ? parseCents(charge.total_amount) : undefined;
      const chargebacks = isObject(charge.transactions) ? objects(charge.transactions.chargebacks) : [];

      const revoked =
        charge.status === "refunded" ||
        charge.status === "charged_back" ||
        first?.status === "charged_back" ||
        chargebacks.length > 0;

      if (revoked)
        return {
          movements: total ? [{ amount: -total, externalId: `mp:${paymentId}:revoked` }] : [],
          raw: response.raw,
        };
      return {
        movements: charge.status === "processed" && paid ? [{ amount: paid, externalId: `mp:${paymentId}` }] : [],
        raw: response.raw,
      };
    },
    notice: mercadoPagoNotice,
    async test(keys) {
      return credentialsReply(await callPsp("mercadopago", keys.apiKey, "/users/me"));
    },
  },
  woovi: {
    async create(row, apiKey, seconds) {
      const response = await callPsp("woovi", apiKey, "/api/v1/charge?return_existing=true", {
        correlationID: row.id,
        value: row.amount,
        expiresIn: Math.min(PSP_MAX_SECONDS, Math.max(300, seconds)),
        comment: `Pedido ${row.id}`,
        customer: { name: row.name, email: row.email, ...(row.phone ? { phone: `+${row.phone}` } : {}) },
      });

      const charge = response.body?.charge;
      const brCode = isObject(charge) ? charge.brCode : undefined;
      const matches = isObject(charge) && charge.correlationID === row.id;
      return response.status < 300 && matches && typeof brCode === "string"
        ? { txid: row.id, pixCode: brCode }
        : { status: response.status };
    },
    async fetch(row, keys) {
      const id = encodeURIComponent(row.id);
      const response = await callPsp("woovi", keys.apiKey, `/api/v1/charge/${id}`);
      if (busy(response)) return { retryIn: response.retryIn };
      const charge = response.body?.charge;
      if (response.status >= 300 || !isObject(charge) || charge.correlationID !== row.id || row.txid !== row.id)
        return mismatch("woovi", row.id, response.status);
      if (charge.status !== "COMPLETED") return { movements: [], raw: response.raw };

      // The charge has no paid amount: the Pix transactions carry what actually arrived.
      const transactions = await callPsp("woovi", keys.apiKey, `/api/v1/transaction?charge=${id}&type=PAYMENT`);
      if (busy(transactions)) return { retryIn: transactions.retryIn };
      if (transactions.status >= 300) return mismatch("woovi", row.id, transactions.status);

      const paid = objects(transactions.body?.transactions).flatMap((entry) => {
        const endToEndId = [entry.endToEndId, entry.endToEndID].find(
          (value) => typeof value === "string" && value !== "",
        );

        const value = cents(entry.value);
        const linked = !isObject(entry.charge) || entry.charge.correlationID === row.id;
        return typeof endToEndId === "string" && value && linked ? [{ endToEndId, value }] : [];
      });

      if (paid.length === 0) return { retryIn: 60 };

      const refunds = await callPsp("woovi", keys.apiKey, `/api/v1/charge/${id}/refund`);
      if (busy(refunds)) return { retryIn: refunds.retryIn };
      if (refunds.status >= 300) return mismatch("woovi", row.id, refunds.status);

      const revoked = objects(refunds.body?.refunds).flatMap((refund) => {
        const value = cents(refund.value);
        return refund.status === "CONFIRMED" && value && typeof refund.endToEndId === "string"
          ? [{ amount: -value, externalId: `woovi:refund:${refund.endToEndId}` }]
          : [];
      });

      for (const pix of paid) {
        const dispute = await callPsp("woovi", keys.apiKey, `/api/v1/dispute/${encodeURIComponent(pix.endToEndId)}`);
        if (busy(dispute)) return { retryIn: dispute.retryIn };
        const found = dispute.body?.dispute;
        if (dispute.status < 300 && isObject(found) && found.status === "ACCEPTED")
          revoked.push({ amount: -pix.value, externalId: `woovi:med:${pix.endToEndId}` });
      }
      if (revoked.length) return { movements: revoked, raw: response.raw };
      return {
        movements: paid.map((pix) => ({ amount: pix.value, externalId: `woovi:${pix.endToEndId}` })),
        raw: response.raw,
      };
    },
    notice: wooviNotice,
    async test(keys) {
      const response = await callPsp("woovi", keys.apiKey, "/api/v1/charge/librefunnel-test");
      return response.status === 404 ? null : credentialsReply(response);
    },
  },
  abacatepay: {
    async create(row, apiKey, seconds) {
      const response = await callPsp("abacatepay", apiKey, "/v2/transparents/create", {
        method: "PIX",
        data: {
          amount: row.amount,
          expiresIn: Math.min(PSP_MAX_SECONDS, Math.max(300, seconds)),
          externalId: row.id,
          description: `Pedido ${row.id}`,
          metadata: { orderId: row.id },
        },
      });

      const charge = response.body?.data;
      return response.status < 300 &&
        isObject(charge) &&
        typeof charge.id === "string" &&
        typeof charge.brCode === "string"
        ? { txid: charge.id, pixCode: charge.brCode }
        : { status: response.status };
    },
    async fetch(row, keys) {
      const response = await callPsp(
        "abacatepay",
        keys.apiKey,
        `/v2/transparents/list?id=${encodeURIComponent(row.txid)}`,
      );

      if (busy(response)) return { retryIn: response.retryIn };
      const charge = objects(response.body?.data).find((entry) => entry.id === row.txid);
      const amount = cents(charge?.amount);
      // A test key only sees test charges and the reverse; a mismatch means the charge is not from this account mode.
      if (response.status >= 300 || !charge || !amount || charge.devMode !== keys.apiKey.startsWith("abc_dev_"))
        return mismatch("abacatepay", row.id, response.status);
      if (charge.status === "REFUNDED")
        return { movements: [{ amount: -amount, externalId: `abacate:${row.txid}:revoked` }], raw: response.raw };
      return {
        movements: charge.status === "PAID" ? [{ amount, externalId: `abacate:${row.txid}` }] : [],
        raw: response.raw,
      };
    },
    notice: abacatePayNotice,
    async test(keys) {
      return credentialsReply(await callPsp("abacatepay", keys.apiKey, "/v2/transparents/list"));
    },
  },
};

// Woovi publishes its webhook keys with a one-hour cache; webhooks never call out, so the loop keeps them in the database.
export async function refreshWebhookKeys() {
  const woovi = (await credentials("woovi"))("woovi");
  if (!woovi("apiKey") || Date.now() - Number(woovi("keysAt")) < 3_600_000) return;
  try {
    const response = await fetch(`${PSP_HOSTS.woovi}/api/v1/webhook/public-keys`, {
      signal: AbortSignal.timeout(15_000),
    });

    const keys = objects(jsonObject(await response.text())?.public_keys).flatMap((entry) => {
      try {
        return typeof entry.key === "string" ? [spki(entry.key)] : [];
      } catch {
        return [];
      }
    });

    if (!response.ok || keys.length === 0) {
      console.warn(`[librefunnel] woovi public keys refused with HTTP ${response.status}`);
      return;
    }
    await saveCredentials("woovi", { publicKeys: keys.join(","), keysAt: String(Date.now()) });
  } catch (error) {
    console.warn("[librefunnel] woovi public keys unreachable", error);
  }
}

export async function testPsp(psp: Psp): Promise<OrderCode | null> {
  const keys = pspKeys(await credentials(psp), psp);
  if (!pspConfigured(psp, keys)) return "PSP_NOT_CONFIGURED";
  try {
    const code = await ADAPTERS[psp].test(keys);
    if (psp === "woovi" && !code) await refreshWebhookKeys();
    return code;
  } catch {
    return "PSP_UNREACHABLE";
  }
}

// Static Pix is issued at checkout; the PSP charge replaces it in the background so a PSP outage never blocks the sale.
export async function attachCharges() {
  const stored = await credentials("pix", "mercadopago", "woovi", "abacatepay");
  const psp = pspOf(stored("pix")("provider"));
  const keys = psp && pspKeys(stored, psp);
  if (!psp || !keys || !pspConfigured(psp, keys)) return;
  const t = new Date();

  const rows = await db()
    .select({
      id: order.id,
      amount: order.amount,
      name: order.name,
      phone: order.phone,
      expiresAt: order.expiresAt,
      email: customer.email,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.status, "pending"), isNull(order.psp), gt(order.createdAt, addSeconds(t, -600))))
    .orderBy(asc(order.createdAt))
    .limit(20);

  for (const row of rows) {
    try {
      const charge = await ADAPTERS[psp].create(
        row,
        keys.apiKey,
        Math.floor((row.expiresAt.getTime() - t.getTime()) / 1000),
      );

      if ("status" in charge) {
        console.warn(`[librefunnel] ${psp} charge for ${row.id} refused with HTTP ${charge.status}`);
        continue;
      }
      await db()
        .update(order)
        .set({ psp, txid: charge.txid, pixCode: charge.pixCode })
        .where(and(eq(order.id, row.id), isNull(order.psp), eq(order.status, "pending")));
    } catch (error) {
      console.warn(`[librefunnel] ${psp} unreachable for ${row.id}`, error);
    }
  }
}

// Each order is checked with the provider that issued it, even after the store switched providers.
export async function checkCharges() {
  const rows = await db()
    .select({ id: order.id, txid: order.txid, psp: order.psp })
    .from(order)
    .where(and(lte(order.pspCheckAt, new Date()), isNotNull(order.psp)))
    .orderBy(asc(order.pspCheckAt))
    .limit(20);

  if (rows.length === 0) return;
  const stored = await credentials(...PSPS);

  for (const row of rows) {
    const checkAt = (at: Date | null) => db().update(order).set({ pspCheckAt: at }).where(eq(order.id, row.id));
    const psp = pspOf(row.psp);
    const keys = psp && pspKeys(stored, psp);
    if (!psp || !keys?.apiKey) {
      await checkAt(null);
      console.warn(`[librefunnel] no credentials to check ${row.id} with ${row.psp}`);
      continue;
    }
    try {
      const fetched = await ADAPTERS[psp].fetch(row, keys);
      if ("retryIn" in fetched) {
        await checkAt(addSeconds(new Date(), fetched.retryIn));
        continue;
      }
      await checkAt(null);
      for (const movement of fetched.movements)
        await recordPayment(row.id, movement.amount, movement.externalId, fetched.raw);
    } catch (error) {
      await checkAt(addSeconds(new Date(), 60));
      console.warn(`[librefunnel] ${psp} unreachable while checking ${row.id}`, error);
    }
  }
}
