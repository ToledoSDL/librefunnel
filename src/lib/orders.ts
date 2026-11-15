import "server-only";
import { createHmac, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import QRCode from "qrcode";
import { credentials, orderBump, saveCredentials, settings } from "./catalog";
import type { Credentials, Product } from "./catalog";
import { addSeconds, db, newId, one } from "./db";
import type { Database } from "./db";
import { baseUrl, demoMode, firstName, hmacHex, isObject, jsonObject, maskEmail, readBody, safeEqual } from "./guard";
import type { GuardCode, Json, JsonObject } from "./guard";
import { enqueueSale, recoverySteps } from "./messages";
import { customer, order, payment } from "./schema";
import { orderStep } from "./tracking";

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
  | "PSP_UNREACHABLE"
  | "CRYPTO_REFUSED"
  | "INVALID_WALLET";
export type CryptoMode = "off" | "balance" | "sale";
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
  payUrl: string | null;
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
type PspKeys = { apiKey: string; webhookSecret: string; publicKeys: string[]; clientId: string; currency: string };
type PspResponse = { status: number; body: JsonObject | undefined; raw: string; retryIn: number };
type ChargeRow = { id: string; product: string; amount: number; name: string; email: string; phone: string | null };
type Movement = { amount: number; externalId: string };
type Fetched = { retryIn: number; limited?: boolean } | { movements: Movement[]; raw: string };
type Notice = { code: GuardCode | "PSP_UNREACHABLE"; status: number } | { match: SQL | undefined };

// One shape per provider: a refund or MED in the re-fetched state yields only debits, so it is never released.
type Adapter = {
  create: (
    row: ChargeRow,
    keys: PspKeys,
    seconds: number,
  ) => Promise<{ txid: string; pixCode: string } | { status: number }>;
  fetch: (row: { id: string; txid: string }, keys: PspKeys) => Promise<Fetched>;
  notice: (raw: string, keys: PspKeys, headers: Headers, url: URL) => Notice;
  test: (keys: PspKeys) => Promise<OrderCode | null>;
};

const ORDER_ID = /^[a-z0-9]{20}$/;
const WEBHOOK_LIMIT = 64 * 1024;
const PSPS = ["mercadopago", "woovi", "abacatepay", "depix", "noxpay"] as const;

const PSP_HOSTS: Record<Psp, string> = {
  mercadopago: "https://api.mercadopago.com",
  woovi: "https://api.woovi.com",
  abacatepay: "https://api.abacatepay.com",
  depix: "https://depix.eulen.app",
  noxpay: "https://checkout.noxpay.io",
};

// Each code is one currency on one network, as NoxPay lists them.
export const NOXPAY_CURRENCIES = [
  { code: "TRX_USDT_S2UZ", label: "USDT na rede Tron" },
  { code: "SOL_USDT_EWAY", label: "USDT na rede Solana" },
  { code: "USDT_ERC20", label: "USDT na rede Ethereum" },
  { code: "SOL_USDC_PTHX", label: "USDC na rede Solana" },
  { code: "USDC", label: "USDC na rede Ethereum" },
  { code: "BTC", label: "Bitcoin" },
] as const;

// Woovi's stablecoin deposits: USDT is not offered on Base, USDC is not offered on Tron.
export const WOOVI_ASSETS = [
  { id: "USDT:POLYGON", label: "USDT na rede Polygon" },
  { id: "USDT:TRON", label: "USDT na rede Tron" },
  { id: "USDT:ETHEREUM", label: "USDT na rede Ethereum" },
  { id: "USDT:CELO", label: "USDT na rede Celo" },
  { id: "USDC:POLYGON", label: "USDC na rede Polygon" },
  { id: "USDC:BASE", label: "USDC na rede Base" },
  { id: "USDC:ETHEREUM", label: "USDC na rede Ethereum" },
  { id: "USDC:CELO", label: "USDC na rede Celo" },
] as const;

// The balance is swept once an hour and only above R$ 50, so conversions are few and the fixed costs stay small.
const SWEEP_MIN = 5000;
const SWEEP_EVERY_MS = 3_600_000;
const CONVERT_RETRY_MS = 600_000;

const MP_FAILED = ["rejected", "failed", "canceled", "cancelled"];

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
    fee: "Sem taxa. O Pix cai na chave cadastrada em cada produto e você libera o pedido ao ver o valor no extrato.",
    events: [],
  },
  {
    id: "mercadopago",
    name: "Mercado Pago",
    needsCnpj: false,
    fee: "0,99% por venda. Libera o acesso sozinho.",
    events: ["Order (Mercado Pago)", "Chargebacks"],
  },
  {
    id: "woovi",
    name: "Woovi",
    needsCnpj: true,
    fee: "0,80% por Pix (de R$ 0,50 a R$ 5,00) ou R$ 0,85 fixo, conforme o plano. Libera o acesso sozinho.",
    events: [
      "OPENPIX:CHARGE_COMPLETED",
      "OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER",
      "PIX_TRANSACTION_REFUND_SENT_CONFIRMED",
      "OPENPIX:DISPUTE_ACCEPTED",
    ],
  },
  {
    id: "abacatepay",
    name: "AbacatePay",
    needsCnpj: true,
    fee: "R$ 0,80 por Pix. Libera o acesso sozinho.",
    events: ["transparent.completed", "transparent.refunded", "transparent.disputed", "transparent.lost"],
  },
  {
    id: "depix",
    name: "DePix (cripto)",
    needsCnpj: false,
    fee: "Você recebe DePix (real tokenizado na rede Liquid) direto na sua carteira. Taxa da Eulen. Libera o acesso sozinho.",
    events: ["deposit", "med"],
  },
  {
    id: "noxpay",
    name: "NoxPay (cripto)",
    needsCnpj: false,
    fee: "Você recebe USDT, USDC ou Bitcoin no saldo NoxPay. O comprador paga numa página da NoxPay, com CPF. Libera o acesso sozinho.",
    events: [],
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
    // A BR Code starts with "000201"; a provider that only hosts its own payment page stores that page's address.
    payUrl: row.pixCode.startsWith("https://") ? row.pixCode : null,
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
    // A buyer correcting their details replaces a live order: Meta already has this checkout.
    if (!open || open.expiresAt <= t) await orderStep(tx, id, "created");
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
  await orderStep(tx, found.id, "paid");
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

// The demo has no bank behind it: this records the full amount through the same path a confirmed Pix takes.
export async function simulatePayment(orderId: string): Promise<OrderCode | GuardCode | null> {
  if (!demoMode()) return "DEMO_ONLY";

  const [open] = await db()
    .select({ amount: order.amount })
    .from(order)
    .where(and(eq(order.id, orderId), eq(order.status, "pending"), gt(order.expiresAt, new Date())));

  return open ? recordPayment(orderId, open.amount, `demo:${orderId}`, "") : "INVALID_TRANSITION";
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

export function pspKeys(read: Credentials<Psp>): PspKeys {
  return {
    apiKey: read("apiKey"),
    webhookSecret: read("webhookSecret"),
    publicKeys: read("publicKeys").split(",").filter(Boolean),
    clientId: read("clientId"),
    currency: read("currency"),
  };
}

// Woovi signs with keys only, so its optional webhook authorization is not required.
export function pspConfigured(psp: Psp, keys: PspKeys): boolean {
  return (
    keys.apiKey !== "" &&
    (psp === "woovi" || keys.webhookSecret !== "") &&
    (psp !== "depix" || keys.clientId !== "") &&
    (psp !== "noxpay" || NOXPAY_CURRENCIES.some((currency) => currency.code === keys.currency))
  );
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

  const keys = pspKeys((await credentials(psp))(psp));
  if (!pspConfigured(psp, keys)) return new Response(null, { status: 404 });
  const raw = await readBody(request, WEBHOOK_LIMIT);
  if (raw === undefined) return webhookReply({ code: "PAYLOAD_TOO_LARGE" }, 413);
  const notice = ADAPTERS[psp].notice(raw, keys, request.headers, url);
  if ("code" in notice) return webhookReply({ code: notice.code }, notice.status);
  if (!notice.match) return webhookReply({ ok: true });

  // The webhook only brings the next re-fetch forward; if the provider is rate limiting, that one re-fetch is paused again.
  const marked = await db()
    .update(order)
    .set({ pspCheckAt: new Date() })
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
  const headers = new Headers({ "Content-Type": "application/json" });
  if (apiKey)
    headers.set(
      psp === "noxpay" ? "api-key" : "Authorization",
      psp === "woovi" || psp === "noxpay" ? apiKey : `Bearer ${apiKey}`,
    );
  if (idempotencyKey) headers.set("X-Idempotency-Key", idempotencyKey);

  const response = await fetch(`${PSP_HOSTS[psp]}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
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

function limited(response: PspResponse): Fetched {
  return { retryIn: response.retryIn, limited: true };
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

// Eulen sends the registered secret as is, with no signature; the re-fetch is what proves the payment.
function depixNotice(raw: string, keys: PspKeys, headers: Headers): Notice {
  if (!safeEqual(headers.get("authorization") ?? "", `Basic ${keys.webhookSecret}`))
    return { code: "INVALID_SIGNATURE", status: 401 };
  const qrId = jsonObject(raw)?.qrId;
  return { match: typeof qrId === "string" ? eq(order.txid, qrId) : undefined };
}

function noxPayNotice(raw: string, keys: PspKeys, headers: Headers): Notice {
  const signature = createHmac("sha256", keys.webhookSecret).update(raw).digest("base64");
  if (!safeEqual(headers.get("x-signature") ?? "", signature)) return { code: "INVALID_SIGNATURE", status: 401 };
  const end2end = jsonObject(raw)?.end2end;
  return { match: typeof end2end === "string" ? eq(order.txid, end2end) : undefined };
}

// Eulen access tokens last minutes and client-credential logins never rotate, so each process keeps its own.
let depixSession: { clientId: string; token: string; until: number } | undefined;

async function callDepix(keys: PspKeys, path: string, body?: Json): Promise<PspResponse> {
  const cached = depixSession?.clientId === keys.clientId && depixSession.until > Date.now();
  const response = await callDepixOnce(keys, path, body);
  // A token revoked before its expiry is replaced by one new login, then the call is repeated.
  if (response.status !== 401 || !cached) return response;
  depixSession = undefined;
  return callDepixOnce(keys, path, body);
}

async function callDepixOnce(keys: PspKeys, path: string, body?: Json): Promise<PspResponse> {
  if (!depixSession || depixSession.clientId !== keys.clientId || depixSession.until <= Date.now()) {
    const login = await callPsp("depix", "", "/api/v2/auth/login", {
      client_id: keys.clientId,
      client_secret: keys.apiKey,
    });

    const token = login.body?.access_token;
    const seconds = cents(login.body?.expires_in) ?? 300;
    if (login.status >= 300 || typeof token !== "string") return login;
    depixSession = { clientId: keys.clientId, token, until: Date.now() + Math.max(30, seconds - 60) * 1000 };
  }
  return callPsp("depix", depixSession.token, path, body);
}

function depixDeposit(response: PspResponse): JsonObject | undefined {
  const deposit = response.body?.response;
  return isObject(deposit) ? deposit : undefined;
}

function label(value: Json | undefined): string | undefined {
  return isObject(value) && typeof value.en === "string" ? value.en : undefined;
}

function noxCents(value: Json | undefined): number | undefined {
  if (typeof value === "string") return parseCents(value);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : undefined;
}

const ADAPTERS: Record<Psp, Adapter> = {
  mercadopago: {
    async create(row, keys, seconds) {
      const value = reais(row.amount);

      const response = await callPsp(
        "mercadopago",
        keys.apiKey,
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
      if (busy(response)) return limited(response);
      const charge = response.body;
      const first = firstPayment(charge);
      const paymentId = first?.id;
      if (response.status >= 300 || !charge || charge.external_reference !== row.id || typeof paymentId !== "string")
        return mismatch("mercadopago", row.id, response.status);
      const paid = typeof charge.total_paid_amount === "string" ? parseCents(charge.total_paid_amount) : undefined;
      const total = typeof charge.total_amount === "string" ? parseCents(charge.total_amount) : undefined;
      const transactions = isObject(charge.transactions) ? charge.transactions : undefined;
      const refunding = charge.status === "refunded" || charge.status_detail === "partially_refunded";

      // Each refund and chargeback is debited by its own id and amount, so a partial refund followed by a full one adds up.
      const debits = [
        ...(refunding ? objects(transactions?.refunds).map((entry) => ({ entry, kind: "refund" })) : []),
        ...objects(transactions?.chargebacks).map((entry) => ({ entry, kind: "chargeback" })),
      ].flatMap(({ entry, kind }) => {
        const amount = typeof entry.amount === "string" ? parseCents(entry.amount) : undefined;
        const failed = typeof entry.status === "string" && MP_FAILED.includes(entry.status);
        return typeof entry.id === "string" && amount && !failed
          ? [{ amount: -amount, externalId: `mp:${kind}:${entry.id}` }]
          : [];
      });

      const revoked =
        refunding || charge.status === "charged_back" || first?.status === "charged_back" || debits.length > 0;

      if (revoked) {
        const fallback = total ? [{ amount: -total, externalId: `mp:${paymentId}:revoked` }] : [];
        return { movements: debits.length ? debits : fallback, raw: response.raw };
      }
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
    async create(row, keys, seconds) {
      const response = await callPsp("woovi", keys.apiKey, "/api/v1/charge?return_existing=true", {
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
      if (busy(response)) return limited(response);
      const charge = response.body?.charge;
      if (response.status >= 300 || !isObject(charge) || charge.correlationID !== row.id || row.txid !== row.id)
        return mismatch("woovi", row.id, response.status);
      if (charge.status !== "COMPLETED") return { movements: [], raw: response.raw };

      // The charge has no paid amount: the Pix transactions carry what actually arrived.
      const transactions = await callPsp("woovi", keys.apiKey, `/api/v1/transaction?charge=${id}&type=PAYMENT`);
      if (busy(transactions)) return limited(transactions);
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
      if (busy(refunds)) return limited(refunds);
      if (refunds.status >= 300) return mismatch("woovi", row.id, refunds.status);

      const revoked = objects(refunds.body?.refunds).flatMap((refund) => {
        const value = cents(refund.value);
        return refund.status === "CONFIRMED" && value && typeof refund.endToEndId === "string"
          ? [{ amount: -value, externalId: `woovi:refund:${refund.endToEndId}` }]
          : [];
      });

      for (const pix of paid) {
        const dispute = await callPsp("woovi", keys.apiKey, `/api/v1/dispute/${encodeURIComponent(pix.endToEndId)}`);
        if (busy(dispute)) return limited(dispute);
        const found = dispute.body?.dispute;
        // A MED can claim part of the Pix: the dispute's value is what goes back.
        if (dispute.status < 300 && isObject(found) && found.status === "ACCEPTED")
          revoked.push({
            amount: -Math.min(pix.value, cents(found.value) ?? pix.value),
            externalId: `woovi:med:${pix.endToEndId}`,
          });
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
    async create(row, keys, seconds) {
      const response = await callPsp("abacatepay", keys.apiKey, "/v2/transparents/create", {
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

      if (busy(response)) return limited(response);
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
  depix: {
    // Eulen takes no idempotency key or reference: the deposit id is the only link to the order.
    async create(row, keys, seconds) {
      const response = await callDepix(keys, "/api/deposit", {
        amountInCents: row.amount,
        endUserFullName: row.name,
        timeout: Math.min(86_400, Math.max(1200, seconds)),
      });

      const deposit = depixDeposit(response);
      return response.status < 300 && typeof deposit?.id === "string" && typeof deposit.qrCopyPaste === "string"
        ? { txid: deposit.id, pixCode: deposit.qrCopyPaste }
        : { status: response.status };
    },
    async fetch(row, keys) {
      const response = await callDepix(keys, `/api/deposit-status?id=${encodeURIComponent(row.txid)}`);
      if (busy(response)) return limited(response);
      const deposit = depixDeposit(response);
      if (response.status >= 300 || !deposit || deposit.qrId !== row.txid)
        return mismatch("depix", row.id, response.status);
      const amount = cents(deposit.valueInCents);
      const status = deposit.status;
      if (status === "refunded" && amount)
        return { movements: [{ amount: -amount, externalId: `depix:${row.txid}:revoked` }], raw: response.raw };
      if ((status === "approved" || status === "depix_sent") && amount)
        return { movements: [{ amount, externalId: `depix:${row.txid}` }], raw: response.raw };
      // A bank block sends no webhook and can last days; polling it every minute would only spend the rate limit.
      if (status === "under_bank_review") return { retryIn: 1800 };
      const expiration = typeof deposit.expiration === "string" ? Date.parse(deposit.expiration) : Number.NaN;
      const over = status === "expired" || status === "canceled" || status === "error";
      // Eulen does not retry webhooks, so an open deposit is polled until it settles or its code expires.
      return over || (status === "pending" && !(expiration > Date.now()))
        ? { movements: [], raw: response.raw }
        : { retryIn: 60 };
    },
    notice: depixNotice,
    async test(keys) {
      return credentialsReply(await callDepix(keys, "/api/ping"));
    },
  },
  noxpay: {
    async create(row, keys) {
      const response = await callPsp("noxpay", keys.apiKey, "/v2/crossramp_checkout", {
        currency_code: keys.currency,
        amount_fiat: row.amount / 100,
        payer_name: row.name,
        webhook: `${baseUrl()}/api/webhooks/payment?psp=noxpay`,
        return_url: `${baseUrl()}/c/${row.product}?order=${row.id}`,
      });

      const link = response.body?.link;

      const end2end =
        typeof link === "string" ? /^https:\/\/checkout\.noxpay\.io\/e2e\/(NOX\w+)$/.exec(link)?.[1] : undefined;

      return response.status < 300 && typeof link === "string" && end2end
        ? { txid: end2end, pixCode: link }
        : { status: response.status };
    },
    async fetch(row, keys) {
      const response = await callPsp("noxpay", keys.apiKey, `/v2/crossramp_checkout/${encodeURIComponent(row.txid)}`);
      if (busy(response)) return limited(response);
      const checkout = response.body;
      const attributes = isObject(checkout?.attributes) ? checkout.attributes : undefined;
      if (response.status >= 300 || !checkout || checkout.end2end !== row.txid || !attributes)
        return mismatch("noxpay", row.id, response.status);
      const status = label(checkout.status);
      const amount = noxCents(attributes.amount_payment);
      // Processing starts once the Pix arrives; a failed conversion leaves the money in the seller's NoxPay account.
      const received = status === "Success" || status === "Processing";
      return {
        movements: received && amount ? [{ amount, externalId: `nox:${row.txid}` }] : [],
        raw: response.raw,
      };
    },
    notice: noxPayNotice,
    async test(keys) {
      const response = await callPsp("noxpay", keys.apiKey, "/v2/crossramp_checkout/librefunnel-test");
      return response.status === 404 ? null : credentialsReply(response);
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
  const keys = pspKeys((await credentials(psp))(psp));
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
  const stored = await credentials("pix", ...PSPS);
  const psp = pspOf(stored("pix")("provider"));
  const keys = psp && pspKeys(stored(psp));
  // Every PSP charge starts here; checks and webhooks only follow orders that have one.
  if (!psp || !keys || !pspConfigured(psp, keys) || demoMode()) return;
  const t = new Date();

  const rows = await db()
    .select({
      id: order.id,
      product: order.product,
      amount: order.amount,
      name: order.name,
      phone: order.phone,
      expiresAt: order.expiresAt,
      email: customer.email,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.status, "pending"), isNull(order.psp), gt(order.createdAt, addSeconds(t, -600))))
    // Newest first: orders the provider keeps refusing never hold back a buyer who is waiting on the page right now.
    .orderBy(desc(order.createdAt))
    .limit(20);

  for (const row of rows) {
    try {
      const charge = await ADAPTERS[psp].create(row, keys, Math.floor((row.expiresAt.getTime() - t.getTime()) / 1000));

      if ("status" in charge) {
        console.warn(`[librefunnel] ${psp} charge for ${row.id} refused with HTTP ${charge.status}`);
        continue;
      }
      await db()
        .update(order)
        // DePix is the one provider whose webhooks are never retried, so it is polled every minute from the start.
        .set({
          psp,
          txid: charge.txid,
          pixCode: charge.pixCode,
          pspCheckAt: psp === "depix" ? addSeconds(t, 60) : reconcileAt("pending", t, row.expiresAt, t),
        })
        .where(and(eq(order.id, row.id), isNull(order.psp), eq(order.status, "pending")));
    } catch (error) {
      console.warn(`[librefunnel] ${psp} unreachable for ${row.id}`, error);
    }
  }
}

// Webhooks get lost, so every order is also re-checked on its own: while it can still be paid, then through the MED
// window (a payer can claim a Pix back for up to 80 days). Points are minutes after creation, then days.
const OPEN_CHECKS_MIN = [5, 30, 120];
const PAID_CHECKS_DAYS = [1, 7, 30, 85];
const LATE_PAYMENT_MIN = 10;

function reconcileAt(status: OrderStatus, createdAt: Date, expiresAt: Date, now: Date): Date | null {
  if (status === "refunded") return null;
  const lastChance = addSeconds(expiresAt, LATE_PAYMENT_MIN * 60);

  const points =
    status === "paid"
      ? PAID_CHECKS_DAYS.map((days) => addSeconds(createdAt, days * 86_400))
      : [
          ...OPEN_CHECKS_MIN.map((minutes) => addSeconds(createdAt, minutes * 60)).filter((at) => at < lastChance),
          lastChance,
        ];

  return points.find((at) => at > now) ?? null;
}

// Each order is checked with the provider that issued it, even after the store switched providers.
export async function checkCharges() {
  const rows = await db()
    .select({
      id: order.id,
      txid: order.txid,
      psp: order.psp,
      status: order.status,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
    })
    .from(order)
    .where(and(lte(order.pspCheckAt, new Date()), isNotNull(order.psp)))
    .orderBy(asc(order.pspCheckAt))
    .limit(20);

  if (rows.length === 0) return;
  const stored = await credentials(...PSPS);
  const paused = new Set<string>();

  for (const row of rows) {
    const checkAt = (at: Date | null) => db().update(order).set({ pspCheckAt: at }).where(eq(order.id, row.id));
    const psp = pspOf(row.psp);
    const keys = psp && pspKeys(stored(psp));
    if (!psp || !keys?.apiKey) {
      await checkAt(null);
      console.warn(`[librefunnel] no credentials to check ${row.id} with ${row.psp}`);
      continue;
    }
    if (paused.has(psp)) continue;
    try {
      const fetched = await ADAPTERS[psp].fetch(row, keys);
      if ("retryIn" in fetched) {
        const at = addSeconds(new Date(), fetched.retryIn);
        if (!fetched.limited) {
          await checkAt(at);
          continue;
        }
        // The provider asked to slow down: every due order of that provider waits, not only this one.
        paused.add(psp);
        await db()
          .update(order)
          .set({ pspCheckAt: at })
          .where(and(eq(order.psp, psp), lte(order.pspCheckAt, at)));
        continue;
      }
      for (const movement of fetched.movements)
        await recordPayment(row.id, movement.amount, movement.externalId, fetched.raw);

      const [after] = fetched.movements.length
        ? await db().select({ status: order.status }).from(order).where(eq(order.id, row.id))
        : [row];

      await checkAt(reconcileAt(after?.status ?? row.status, row.createdAt, row.expiresAt, new Date()));
    } catch (error) {
      await checkAt(addSeconds(new Date(), 60));
      console.warn(`[librefunnel] ${psp} unreachable while checking ${row.id}`, error);
    }
  }
}

type Conversion = { apiKey: string; coin: string; network: string; wallet: string };

const CONVERSION_ERRORS = ["PSP_REJECTED", "PSP_UNREACHABLE", "CRYPTO_REFUSED"] as const;

export function cryptoMode(value: string): CryptoMode {
  return value === "balance" || value === "sale" ? value : "off";
}

export function conversionError(value: string) {
  return CONVERSION_ERRORS.find((code) => code === value);
}

export function wooviAsset(value: string) {
  return WOOVI_ASSETS.find((asset) => asset.id === value)?.id;
}

// Tron addresses are base58 starting with T; the other networks Woovi offers are EVM chains.
export function cryptoWallet(asset: string, raw: string): string | undefined {
  const wallet = raw.trim();

  const valid = asset.endsWith(":TRON")
    ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)
    : /^0x[0-9a-fA-F]{40}$/.test(wallet);

  return valid ? wallet : undefined;
}

function conversionReply(response: PspResponse): OrderCode {
  if (response.status === 401 || response.status === 403) return "PSP_REJECTED";
  return response.status === 400 ? "CRYPTO_REFUSED" : "PSP_UNREACHABLE";
}

// Approval is what debits the BRL balance; the correlation id ties the pair so a retried deposit is not created twice.
async function convert(target: Conversion, value: number, correlationId: string): Promise<OrderCode | null> {
  const created = await callPsp("woovi", target.apiKey, "/api/v1/stablecoin/deposit", {
    value,
    currency: target.coin,
    network: target.network,
    correlationId,
    destinationWalletAddress: target.wallet,
  });

  if (created.status >= 300) return conversionReply(created);
  const approved = await callPsp("woovi", target.apiKey, "/api/v1/stablecoin/deposit/approve", { correlationId });
  if (approved.status < 300) return null;
  // An earlier run approved it but stopped before marking the order: Woovi answers "already completed" or "already being processed".
  if (approved.status === 400 && /already (completed|being processed)/i.test(approved.raw)) return null;
  return conversionReply(approved);
}

async function convertBalance(target: Conversion): Promise<OrderCode | null> {
  const response = await callPsp("woovi", target.apiKey, "/api/v1/account/");
  if (response.status >= 300) return conversionReply(response);
  const main = objects(response.body?.accounts).find((account) => account.isDefault === true);
  const available = isObject(main?.balance) ? cents(main.balance.available) : undefined;
  if (!available || available < SWEEP_MIN) return null;
  return convert(target, available, `librefunnel-${Math.floor(Date.now() / SWEEP_EVERY_MS)}`);
}

async function convertSales(target: Conversion, since: Date): Promise<OrderCode | null> {
  const rows = await db()
    .select({ id: order.id, amount: order.amount })
    .from(order)
    .where(and(eq(order.status, "paid"), eq(order.psp, "woovi"), isNull(order.cryptoAt), gte(order.createdAt, since)))
    .orderBy(asc(order.createdAt))
    .limit(10);

  for (const row of rows) {
    const response = await callPsp("woovi", target.apiKey, `/api/v1/charge/${encodeURIComponent(row.id)}`);
    // An order this Woovi account does not know (keys replaced since the sale) is skipped instead of blocking the rest.
    if (response.status >= 300 && response.status !== 404) return conversionReply(response);
    const charge = response.body?.charge;
    const methods = isObject(charge) ? charge.paymentMethods : undefined;
    const pix = isObject(methods) ? methods.pix : undefined;
    // Woovi takes its Pix fee from the balance; without the fee on the charge, R$ 5 (its highest Pix fee) stays in reais.
    const fee = (isObject(pix) ? cents(pix.fee) : undefined) ?? 500;
    if (response.status !== 404 && row.amount > fee) {
      const code = await convert(target, row.amount - fee, `librefunnel-${row.id}`);
      if (code) return code;
    }
    await db().update(order).set({ cryptoAt: new Date() }).where(eq(order.id, row.id));
  }
  return null;
}

// Runs in the background loop: a refused conversion waits ten minutes and its reason shows in Conexões.
export async function convertToCrypto() {
  const woovi = (await credentials("woovi"))("woovi");
  const mode = woovi("convertMode");
  const [coin, network] = woovi("convertAsset").split(":");
  const apiKey = woovi("apiKey");
  const wallet = woovi("convertWallet");
  if ((mode !== "balance" && mode !== "sale") || !coin || !network || !apiKey || !wallet || demoMode()) return;
  if (Number(woovi("convertNextAt")) > Date.now()) return;
  const target = { apiKey, coin, network, wallet };
  let code: OrderCode | null;
  try {
    code =
      mode === "balance"
        ? await convertBalance(target)
        : await convertSales(target, new Date(Number(woovi("convertSince"))));
  } catch (error) {
    console.warn("[librefunnel] woovi unreachable while converting", error);
    code = "PSP_UNREACHABLE";
  }
  const next = code ? CONVERT_RETRY_MS : mode === "balance" ? SWEEP_EVERY_MS : 0;
  await saveCredentials("woovi", { convertError: code ?? "", convertNextAt: String(Date.now() + next) });
}

export async function testConversion(asset: string): Promise<OrderCode | null> {
  const apiKey = (await credentials("woovi"))("woovi")("apiKey");
  if (!apiKey) return "PSP_NOT_CONFIGURED";
  const coin = asset.split(":")[0] ?? "USDT";
  try {
    const response = await callPsp("woovi", apiKey, `/api/v1/stablecoin/quote?value=10000&currency=${coin}`);
    return response.status < 300 ? null : conversionReply(response);
  } catch {
    return "PSP_UNREACHABLE";
  }
}
