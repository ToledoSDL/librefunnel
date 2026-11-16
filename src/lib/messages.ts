import "server-only";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import nodemailer from "nodemailer";
import { credentials, fillSettings, saveCredentials, settings } from "./settings";
import { productNames } from "./catalog/products";
import type { Credentials } from "./settings";
import { addSeconds, db, one } from "./db";
import type { Database } from "./db";
import { baseUrl, demoMode, derive, hmacHex, isObject, jsonObject, readBody, safeEqual, sign, verify } from "./guard";
import type { Json, JsonObject } from "./guard";
import { mintLogin } from "./members";
import { contact, customer, message, order, recoveryStep, reply } from "./schema";
import { GRAPH } from "./tracking/meta";
import { switchWhatsApp } from "./updates";
import { parsePhone, parsePrintable } from "./input";
import { formatFirstName, formatMaskedEmail, formatMoney } from "@/format";

export type MessageCode =
  | "CHANNEL_NOT_CONFIGURED"
  | "WHATSAPP_DISCONNECTED"
  | "WHATSAPP_STARTING"
  | "OPTED_OUT"
  | "DAILY_CAP"
  | "INVALID_ADDRESS"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNREACHABLE"
  | "ALREADY_OWNED"
  | "SMTP_AUTH_FAILED"
  | "SMTP_UNREACHABLE"
  | "OWNER_ADDRESS_MISSING"
  | "TEMPLATE_PENDING"
  | "CLOUD_TOKEN_INVALID"
  | "CLOUD_TOKEN_TEMPORARY"
  | "CLOUD_PERMISSION_MISSING"
  | "CLOUD_NO_NUMBER"
  | "CLOUD_APP_SECRET_INVALID"
  | "CLOUD_WEBHOOK_FAILED"
  | "CLOUD_PIN_REQUIRED"
  | "CLOUD_PIN_INVALID"
  | "REPLY_WINDOW_CLOSED";
export type TemplateState = "approved" | "pending" | "rejected" | "error";
export type WhatsAppState = "open" | "connecting" | "close" | "missing" | "error";
export type AutomationCode = "INVALID_TEMPLATE" | "INVALID_KEYWORDS" | "INVALID_DELAY";
export type RecoveryStep = { id: number; afterMinutes: number; channel: "email" | "whatsapp"; text: string };
export type Reply = { id: number; keywords: string[]; text: string };

type Sale = {
  id: string;
  customerId: string;
  email: string;
  phone: string | null;
  name: string;
  product: string;
  bump: string | null;
  amount: number;
};
type Contact = typeof contact.$inferSelect;
type Outcome = { sent: string | null } | { code: MessageCode; retry: boolean } | { postponeTo: Date };
type Smtp = { host: string; port: number; user: string; password: string; from: string };
type Evolution = { url: string; key: string };
type Cloud = { phoneId: string; wabaId: string; token: string };

const MESSAGE_CODES: MessageCode[] = [
  "CHANNEL_NOT_CONFIGURED",
  "WHATSAPP_DISCONNECTED",
  "OPTED_OUT",
  "DAILY_CAP",
  "INVALID_ADDRESS",
  "PROVIDER_REJECTED",
  "PROVIDER_UNREACHABLE",
  "ALREADY_OWNED",
  "SMTP_AUTH_FAILED",
  "SMTP_UNREACHABLE",
  "OWNER_ADDRESS_MISSING",
  "TEMPLATE_PENDING",
  "CLOUD_TOKEN_INVALID",
  "CLOUD_TOKEN_TEMPORARY",
  "CLOUD_PERMISSION_MISSING",
  "CLOUD_NO_NUMBER",
  "CLOUD_APP_SECRET_INVALID",
  "CLOUD_WEBHOOK_FAILED",
  "CLOUD_PIN_REQUIRED",
  "CLOUD_PIN_INVALID",
  "REPLY_WINDOW_CLOSED",
];

// Created in the seller's WhatsApp account on connect; Meta forbids a variable at the start or end of the text.
const TEMPLATE = {
  name: "librefunnel_aviso",
  language: "pt_BR",
  text: "Aviso da sua compra: {{1}}. Responda esta mensagem se precisar de ajuda.",
  example: "o pagamento do Bolo no Pote foi confirmado e o acesso foi enviado para o seu e-mail",
};

const TEMPLATE_STATES: Record<string, TemplateState> = {
  APPROVED: "approved",
  PENDING: "pending",
  IN_APPEAL: "pending",
  REJECTED: "rejected",
  PAUSED: "rejected",
  DISABLED: "rejected",
};

const SMTP_UNREACHABLE = ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ETLS", "ECONNREFUSED", "ENOTFOUND"];
const INSTANCE = "librefunnel";
const WHATSAPP_DAILY_CAP = 300;
const RECOVERY_PER_ADDRESS_DAY = 2;
const REPLIES_PER_HOUR = 5;
// A claimed message still "sending" after this was left behind by a batch that crashed.
const CLAIM_TTL = 15 * 60;
const MAX_ATTEMPTS = 5;
const QUIET_FROM = 21;
const QUIET_UNTIL = 9;
const LOGIN_TTL = 3600;
const ACCESS_TTL = 7 * 86400;
const OPTOUT_TTL = 2 * 365 * 86400;
const REPLY_WINDOW = 86400;
const PHOTO_MAX = 200 * 1024;
const PHOTO_TTL = 7 * 86400;
const PHOTO_ACTIVE = 30 * 86400;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BOT_LIMIT = 64 * 1024;

export const RECOVERY_FIELDS = ["name", "product", "amount", "link", "pix"];
export const REPLY_FIELDS = ["base"];
export const SMTP_PRESETS = [
  {
    id: "gmail",
    name: "Gmail",
    host: "smtp.gmail.com",
    port: 587,
    user: "Seu endereço Gmail completo",
    password: "Senha de app de 16 letras (myaccount.google.com/apppasswords), não a senha normal",
  },
  {
    id: "brevo",
    name: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    user: "Login SMTP mostrado em SMTP e API",
    password: "Chave SMTP (não a chave de API)",
  },
  { id: "mailjet", name: "Mailjet", host: "in-v3.mailjet.com", port: 587, user: "API Key", password: "Secret Key" },
] as const;

const GMAIL = { host: "smtp.gmail.com", port: 587 };
const YAHOO = { host: "smtp.mail.yahoo.com", port: 587 };
const ICLOUD = { host: "smtp.mail.me.com", port: 587 };
const ZOHO = { host: "smtp.zoho.com", port: 587 };

// Mailboxes whose SMTP server follows from the address, so the server field can be left blank.
const SMTP_BY_DOMAIN: Record<string, { host: string; port: number }> = {
  "gmail.com": GMAIL,
  "googlemail.com": GMAIL,
  "yahoo.com": YAHOO,
  "yahoo.com.br": YAHOO,
  "icloud.com": ICLOUD,
  "me.com": ICLOUD,
  "mac.com": ICLOUD,
  "zoho.com": ZOHO,
  "zohomail.com": ZOHO,
};

export function smtpServer(address: string): { host: string; port: number } | undefined {
  return SMTP_BY_DOMAIN[address.split("@")[1] ?? ""];
}

export function messageCode(value: string | null): MessageCode | null {
  return MESSAGE_CODES.find((code) => code === value) ?? null;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

export function validTemplate(text: string, fields: string[]): boolean {
  return [...text.matchAll(/\{(\w*)\}/g)].every((match) => fields.includes(match[1] ?? ""));
}

export function recoverySteps(): Promise<RecoveryStep[]> {
  return db()
    .select({
      id: recoveryStep.id,
      afterMinutes: recoveryStep.afterMinutes,
      channel: recoveryStep.channel,
      text: recoveryStep.text,
    })
    .from(recoveryStep)
    .orderBy(recoveryStep.afterMinutes, recoveryStep.id);
}

export async function saveRecoveryStep(id: number | null, step: Omit<RecoveryStep, "id">): Promise<boolean> {
  const saved =
    id === null
      ? await db().insert(recoveryStep).values(step).returning({ id: recoveryStep.id })
      : await db().update(recoveryStep).set(step).where(eq(recoveryStep.id, id)).returning({ id: recoveryStep.id });

  return saved.length === 1;
}

export async function deleteRecoveryStep(id: number): Promise<boolean> {
  return (
    (await db().delete(recoveryStep).where(eq(recoveryStep.id, id)).returning({ id: recoveryStep.id })).length === 1
  );
}

export function replies(executor: Database = db()): Promise<Reply[]> {
  return executor.select({ id: reply.id, keywords: reply.keywords, text: reply.text }).from(reply).orderBy(reply.id);
}

export async function saveReply(id: number | null, keywords: string[], text: string): Promise<boolean> {
  const saved =
    id === null
      ? await db().insert(reply).values({ keywords, text }).returning({ id: reply.id })
      : await db().update(reply).set({ keywords, text }).where(eq(reply.id, id)).returning({ id: reply.id });

  return saved.length === 1;
}

export async function deleteReply(id: number): Promise<boolean> {
  return (await db().delete(reply).where(eq(reply.id, id)).returning({ id: reply.id })).length === 1;
}

function words(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// WhatsApp may report a Brazilian mobile with or without the ninth digit, so both forms are kept.
function phoneVariants(phone: string): string[] {
  if (/^55\d{2}9\d{8}$/.test(phone)) return [phone, phone.slice(0, 4) + phone.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(phone)) return [phone, `${phone.slice(0, 4)}9${phone.slice(4)}`];
  return [phone];
}

export function optOutLink(address: string): string {
  return `${baseUrl()}/m?unsubscribe=${sign("optout", address, OPTOUT_TTL)}`;
}

// Runs inside the payment transaction, so every read and write goes through tx.
export async function enqueueSale(tx: Database, sale: Sale) {
  const t = new Date();
  const names = await productNames(tx);
  const owner = await settings(tx);
  const title = [sale.product, sale.bump].flatMap((slug) => (slug ? [names.get(slug) ?? slug] : [])).join(" + ");
  const notice = `Nova venda: ${title} (${formatMoney(sale.amount)})\n\n${sale.name} (${sale.email}) pagou o pedido ${sale.id}.\n${baseUrl()}/admin?tab=orders&q=${sale.id}`;

  const drafts: Pick<typeof message.$inferInsert, "channel" | "address" | "kind" | "customerId" | "body">[] = [
    {
      channel: "email",
      address: sale.email,
      kind: "access",
      customerId: sale.customerId,
      body: `Seu acesso ao ${title} está liberado\n\nOi ${formatFirstName(sale.name)}, o pagamento foi confirmado.\n\nEntre na área de membros por este link (vale 7 dias e funciona uma vez): {login_link}\n\nDepois disso, peça um link novo em ${baseUrl()}/m com este e-mail.`,
    },
  ];

  if (sale.phone) {
    drafts.push({
      channel: "whatsapp",
      address: sale.phone,
      kind: "paid",
      customerId: sale.customerId,
      body: `Oi ${formatFirstName(sale.name)}! O pagamento do ${title} foi confirmado. O link de acesso foi enviado para o seu e-mail ${formatMaskedEmail(sale.email)}.`,
    });
  }
  if (owner.ownerEmail) drafts.push({ channel: "email", address: owner.ownerEmail, kind: "owner", body: notice });
  if (owner.ownerWhatsapp)
    drafts.push({ channel: "whatsapp", address: owner.ownerWhatsapp, kind: "owner", body: notice });
  await tx
    .insert(message)
    .values(
      drafts.map((draft): typeof message.$inferInsert => ({
        ...draft,
        orderId: sale.id,
        status: "queued",
        nextAt: t,
        createdAt: t,
      })),
    )
    .onConflictDoNothing();
}

export async function queueRecovery() {
  const steps = await recoverySteps();
  const t = new Date();
  const since = addSeconds(t, -86400).toISOString();

  const recent = (address: AnyPgColumn) =>
    sql<number>`(SELECT COUNT(*) FROM ${message} WHERE ${message.address} = ${address} AND ${message.kind} = 'recovery' AND ${message.status} <> 'skipped' AND ${message.createdAt} > ${since})`.mapWith(
      Number,
    );

  const rows = await db()
    .select({
      id: order.id,
      customerId: order.customerId,
      product: order.product,
      name: order.name,
      phone: order.phone,
      amount: order.amount,
      pixCode: order.pixCode,
      step: order.recoveryStep,
      createdAt: order.createdAt,
      email: customer.email,
      owned: sql<boolean>`EXISTS (SELECT 1 FROM ${order} paid WHERE paid.customer_id = ${order.customerId} AND paid.status = 'paid' AND (paid.product = ${order.product} OR paid.bump = ${order.product}))`,
      emailOut: optedOut(customer.email),
      phoneOut: optedOut(order.phone),
      emailRecent: recent(customer.email),
      phoneRecent: recent(order.phone),
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.status, "pending"), lte(order.recoveryAt, t)))
    .orderBy(asc(order.recoveryAt))
    .limit(200);

  if (rows.length === 0) return;
  const names = await productNames();

  await db().transaction(async (tx) => {
    for (const row of rows) {
      const current = steps[row.step];
      const next = steps[row.step + 1];
      const nextAt = row.owned || !next ? null : addSeconds(row.createdAt, next.afterMinutes * 60);

      const advanced = await tx
        .update(order)
        .set({ recoveryStep: row.step + 1, recoveryAt: nextAt })
        .where(and(eq(order.id, row.id), eq(order.recoveryStep, row.step), eq(order.status, "pending")))
        .returning({ id: order.id });

      if (advanced.length !== 1 || !current) continue;
      const email = current.channel === "email";
      const address = email ? row.email : (row.phone ?? "");

      const code: MessageCode | null = row.owned
        ? "ALREADY_OWNED"
        : !address
          ? "INVALID_ADDRESS"
          : (email ? row.emailOut : row.phoneOut)
            ? "OPTED_OUT"
            : (email ? row.emailRecent : row.phoneRecent) >= RECOVERY_PER_ADDRESS_DAY
              ? "DAILY_CAP"
              : null;

      const body = fill(current.text, {
        name: formatFirstName(row.name),
        product: names.get(row.product) ?? row.product,
        amount: formatMoney(row.amount),
        link: `${baseUrl()}/c/${row.product}?order=${row.id}`,
        pix: row.pixCode,
      });

      const footer = email
        ? `\n\nNão quer mais receber estes e-mails? ${optOutLink(address)}`
        : "\n\nResponda SAIR para não receber mais mensagens.";

      await tx
        .insert(message)
        .values({
          channel: current.channel,
          address,
          kind: "recovery",
          step: row.step,
          orderId: row.id,
          customerId: row.customerId,
          body: body + footer,
          status: code ? "skipped" : "queued",
          error: code,
          nextAt: t,
          createdAt: t,
        })
        .onConflictDoNothing();
    }
  });
}

export async function requeueStuck() {
  await db().update(message).set({ status: "queued" }).where(eq(message.status, "sending"));
}

export async function resendMessage(id: number): Promise<boolean> {
  const changed = await db()
    .update(message)
    .set({ status: "queued", attempts: 0, error: null, nextAt: new Date() })
    .where(
      and(
        eq(message.id, id),
        ne(message.kind, "inbound"),
        inArray(message.status, ["failed", "skipped", "sent", "delivered", "read"]),
      ),
    )
    .returning({ id: message.id });

  return changed.length === 1;
}

// The official API delivers free text only inside the 24 hours after the buyer's last message.
export function replyOpen(cloud: boolean, lastInbound: Date | null): boolean {
  return !cloud || (lastInbound !== null && lastInbound > addSeconds(new Date(), -REPLY_WINDOW));
}

export async function sendManual(address: string, body: string): Promise<MessageCode | null> {
  const [thread, stored] = await Promise.all([
    db()
      .select({
        total: count(),
        lastInbound: sql<Date | null>`max(${message.createdAt}) FILTER (WHERE ${message.kind} = 'inbound')`.mapWith(
          message.createdAt,
        ),
      })
      .from(message)
      .where(and(eq(message.channel, "whatsapp"), eq(message.address, address)))
      .then(one),
    credentials("whatsapp"),
  ]);

  if (thread.total === 0) return "INVALID_ADDRESS";
  if (!replyOpen(cloudOf(stored("whatsapp")) !== undefined, thread.lastInbound)) return "REPLY_WINDOW_CLOSED";
  const t = new Date();
  await db()
    .insert(message)
    .values({ channel: "whatsapp", address, kind: "manual", body, status: "queued", nextAt: t, createdAt: t });
  return null;
}

export async function resendAccess(orderId: string): Promise<boolean> {
  const changed = await db()
    .update(message)
    .set({ status: "queued", attempts: 0, error: null, nextAt: new Date() })
    .where(
      and(
        eq(message.orderId, orderId),
        eq(message.kind, "access"),
        ne(message.status, "sending"),
        sql`EXISTS (SELECT 1 FROM ${order} WHERE ${order.id} = ${orderId} AND ${order.status} = 'paid')`,
      ),
    )
    .returning({ id: message.id });

  return changed.length === 1;
}

async function optOut(executor: Database, address: string) {
  const optedOutAt = new Date();
  const addresses = /^\d+$/.test(address) ? phoneVariants(address) : [address];
  await executor
    .insert(contact)
    .values(addresses.map((variant) => ({ address: variant, optedOutAt })))
    .onConflictDoUpdate({
      target: contact.address,
      set: { optedOutAt: sql`COALESCE(${contact.optedOutAt}, excluded.opted_out_at)` },
    });
}

// An address is opted out once it has a stored opt-out date.
function optedOut(address: AnyPgColumn) {
  return sql<boolean>`EXISTS (SELECT 1 FROM ${contact} WHERE ${contact.address} = ${address} AND ${contact.optedOutAt} IS NOT NULL)`;
}

export async function optOutByLink(token: string): Promise<boolean> {
  const address = verify("optout", token);
  if (!address) return false;
  await optOut(db(), address);
  return true;
}

// Read per batch from the panel's settings, so a saved change applies to the next send.
async function smtpConfig(): Promise<Smtp | undefined> {
  const smtp = (await credentials("smtp"))("smtp");
  const host = smtp("host");
  return host
    ? {
        host,
        port: Number(smtp("port")) || 587,
        user: smtp("user"),
        password: smtp("password"),
        from: smtp("from") || smtp("user"),
      }
    : undefined;
}

// The bundled Evolution from the environment, unless the panel points to another one.
export function evolutionOf(stored: Credentials<"evolution">): Evolution | undefined {
  const panel = stored("url");
  const url = panel || process.env.EVOLUTION_URL || "";
  const key = panel ? stored("key") : (process.env.EVOLUTION_KEY ?? "");
  return url && key ? { url: url.replace(/\/+$/, ""), key } : undefined;
}

async function evolutionConfig(): Promise<Evolution | undefined> {
  return evolutionOf((await credentials("evolution"))("evolution"));
}

export function cloudOf(stored: Credentials<"whatsapp">): Cloud | undefined {
  const phoneId = stored("phoneId");
  const wabaId = stored("wabaId");
  const token = stored("token");
  return phoneId && wabaId && token ? { phoneId, wabaId, token } : undefined;
}

async function cloudConfig(): Promise<Cloud | undefined> {
  return cloudOf((await credentials("whatsapp"))("whatsapp"));
}

function mailer(smtp: Smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

async function smtpAttempt(work: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await work();
  } catch (error) {
    const responseCode =
      error instanceof Error && "responseCode" in error && typeof error.responseCode === "number"
        ? error.responseCode
        : 0;

    const errorCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
    console.warn(`[librefunnel] smtp failed: ${errorCode || "unknown"} ${responseCode || ""}`);
    if (errorCode === "EAUTH" || responseCode === 535) return { code: "SMTP_AUTH_FAILED", retry: false };
    if (SMTP_UNREACHABLE.includes(errorCode)) return { code: "SMTP_UNREACHABLE", retry: true };
    const rejected = responseCode >= 500 || errorCode === "EENVELOPE";
    return { code: rejected ? "PROVIDER_REJECTED" : "PROVIDER_UNREACHABLE", retry: !rejected };
  }
}

function sendEmail(smtp: Smtp | undefined, brand: string, address: string, body: string): Promise<Outcome> {
  if (!smtp) return Promise.resolve({ code: "CHANNEL_NOT_CONFIGURED", retry: false });
  const [subject = "", ...rest] = body.split("\n");
  return smtpAttempt(async () => {
    const info = await mailer(smtp).sendMail({
      from: { name: brand, address: smtp.from },
      to: address,
      subject,
      text: rest.join("\n").trim(),
    });

    return { sent: typeof info.messageId === "string" ? info.messageId : null };
  });
}

async function evolution(
  config: Evolution,
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Json,
  timeout = 15_000,
): Promise<{ status: number; body: JsonObject | undefined }> {
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: { apikey: config.key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  return { status: response.status, body: jsonObject(await response.text()) };
}

async function sendWhatsApp(
  config: Evolution | undefined,
  address: string,
  text: string,
  state: WhatsAppState,
): Promise<Outcome> {
  if (!config) return { code: "CHANNEL_NOT_CONFIGURED", retry: false };
  if (!/^\d{10,15}$/.test(address)) return { code: "INVALID_ADDRESS", retry: false };
  if (state !== "open")
    return { code: state === "error" ? "PROVIDER_UNREACHABLE" : "WHATSAPP_DISCONNECTED", retry: true };
  try {
    const response = await evolution(config, `/message/sendText/${INSTANCE}`, "POST", { number: address, text });
    if (response.status >= 500) {
      console.warn(`[librefunnel] evolution sendText HTTP ${response.status}`);
      return { code: "PROVIDER_UNREACHABLE", retry: true };
    }
    if (response.status >= 300) {
      console.warn(`[librefunnel] evolution sendText HTTP ${response.status}`);
      return { code: "PROVIDER_REJECTED", retry: false };
    }
    const key = response.body?.key;
    return { sent: isObject(key) && typeof key.id === "string" ? key.id : null };
  } catch {
    return { code: "PROVIDER_UNREACHABLE", retry: true };
  }
}

async function graph(
  token: string,
  path: string,
  body?: Json,
): Promise<{ status: number; body: JsonObject | undefined }> {
  const response = await fetch(`${GRAPH}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  return { status: response.status, body: jsonObject(await response.text()) };
}

function graphError(body: JsonObject | undefined): number {
  const error = body?.error;
  return isObject(error) && typeof error.code === "number" ? error.code : 0;
}

// Meta delivers free text only inside the 24 hours after the buyer's last message, so only replies (automatic or
// typed by the seller) go as text; everything else fills the template, whose single parameter cannot hold line breaks.
async function sendCloud(cloud: Cloud, address: string, text: string, reply: boolean): Promise<Outcome> {
  if (!/^\d{10,15}$/.test(address)) return { code: "INVALID_ADDRESS", retry: false };

  const content: JsonObject = reply
    ? { type: "text", text: { body: text } }
    : {
        type: "template",
        template: {
          name: TEMPLATE.name,
          language: { code: TEMPLATE.language },
          components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\s+/g, " ").trim() }] }],
        },
      };

  try {
    const response = await graph(cloud.token, `${cloud.phoneId}/messages`, {
      messaging_product: "whatsapp",
      to: address,
      ...content,
    });

    if (response.status >= 300) console.warn(`[librefunnel] whatsapp cloud send HTTP ${response.status}`);
    const error = graphError(response.body);
    // 130429 and 131056: throughput limits, which pass on their own.
    if (response.status >= 500 || response.status === 429 || error === 130429 || error === 131056)
      return { code: "PROVIDER_UNREACHABLE", retry: true };
    // 132001: the template is not approved yet, which takes Meta minutes after connecting.
    if (error === 132001) return { code: "TEMPLATE_PENDING", retry: true };
    // 133010: the number was never registered for the API; connecting again with the PIN registers it.
    if (error === 133010) return { code: "CLOUD_PIN_REQUIRED", retry: false };
    if (response.status >= 300) return { code: "PROVIDER_REJECTED", retry: false };
    const sent = response.body?.messages;
    const first = Array.isArray(sent) ? sent[0] : undefined;
    return { sent: isObject(first) && typeof first.id === "string" ? first.id : null };
  } catch {
    return { code: "PROVIDER_UNREACHABLE", retry: true };
  }
}

function quietUntil(t: Date): Date | undefined {
  const hour = t.getHours();
  if (hour >= QUIET_UNTIL && hour < QUIET_FROM) return undefined;
  const local = new Date(t);
  if (hour >= QUIET_FROM) local.setDate(local.getDate() + 1);
  local.setHours(QUIET_UNTIL, 0, 0, 0);
  return local;
}

export async function sendMessages() {
  const t = new Date();

  // The demo shows the outbox working, but externalId "demo" marks that nothing was delivered.
  if (demoMode()) {
    await db()
      .update(message)
      .set({ status: "sent", externalId: "demo", sentAt: t, error: null })
      .where(and(eq(message.status, "queued"), lte(message.nextAt, t)));

    return;
  }

  await db()
    .update(message)
    .set({ status: "queued" })
    .where(and(eq(message.status, "sending"), lte(message.nextAt, t)));

  // SKIP LOCKED plus the status check lets two senders run at once without claiming the same message.
  const due = db()
    .select({ id: message.id })
    .from(message)
    .where(and(eq(message.status, "queued"), lte(message.nextAt, t)))
    .orderBy(asc(message.nextAt))
    .limit(50)
    .for("update", { skipLocked: true });

  const claimed = await db()
    .update(message)
    .set({ status: "sending", attempts: sql`${message.attempts} + 1`, nextAt: addSeconds(t, CLAIM_TTL) })
    .where(and(eq(message.status, "queued"), inArray(message.id, due)))
    .returning({
      id: message.id,
      channel: message.channel,
      address: message.address,
      kind: message.kind,
      body: message.body,
      customerId: message.customerId,
      attempts: message.attempts,
    });

  if (claimed.length === 0) return;
  const recoveryAddresses = claimed.filter((row) => row.kind === "recovery").map((row) => row.address);

  const [{ total }, opted] = await Promise.all([
    db()
      .select({ total: count() })
      .from(message)
      .where(
        and(eq(message.channel, "whatsapp"), ne(message.kind, "inbound"), gt(message.sentAt, addSeconds(t, -86400))),
      )
      .then(one),
    recoveryAddresses.length
      ? db()
          .select({ address: contact.address })
          .from(contact)
          .where(and(inArray(contact.address, recoveryAddresses), isNotNull(contact.optedOutAt)))
      : [],
  ]);

  let whatsappSent = total;
  const optedOut = new Set(opted.map((row) => row.address));

  const [smtp, brand, stored] = await Promise.all([
    claimed.some((row) => row.channel === "email") ? smtpConfig() : undefined,
    claimed.some((row) => row.channel === "email") ? settings().then((current) => current.brand) : "",
    claimed.some((row) => row.channel === "whatsapp") ? credentials("whatsapp", "evolution") : undefined,
  ]);

  // The official API, once saved, replaces the QR Code number for every send.
  const cloud = stored && cloudOf(stored("whatsapp"));
  const whatsappTarget = stored && !cloud ? evolutionOf(stored("evolution")) : undefined;
  const state = whatsappTarget ? await whatsappState(whatsappTarget) : "close";
  // Each send to a dead server waits for its timeouts, and the jobs after this one (payment checks) wait with it.
  const down = new Set<string>();

  for (const row of claimed) {
    const whatsapp = row.channel === "whatsapp";
    const bulk = row.kind === "recovery" || row.kind === "reply";
    const quiet = whatsapp && row.kind === "recovery" ? quietUntil(t) : undefined;
    let outcome: Outcome;
    if (row.kind === "recovery" && optedOut.has(row.address)) outcome = { code: "OPTED_OUT", retry: false };
    else if (quiet !== undefined) outcome = { postponeTo: quiet };
    else if (down.has(row.channel)) outcome = { postponeTo: addSeconds(t, 60) };
    else if (whatsapp && bulk && whatsappSent >= WHATSAPP_DAILY_CAP) outcome = { code: "DAILY_CAP", retry: false };
    else {
      const text =
        row.customerId && row.body.includes("{login_link}")
          ? fill(row.body, {
              login_link: await mintLogin(row.customerId, row.kind === "access" ? ACCESS_TTL : LOGIN_TTL),
            })
          : row.body;

      outcome = !whatsapp
        ? await sendEmail(smtp, brand, row.address, text)
        : cloud
          ? await sendCloud(cloud, row.address, text, row.kind === "reply" || row.kind === "manual")
          : await sendWhatsApp(whatsappTarget, row.address, text, state);
      if ("code" in outcome && (outcome.code === "SMTP_UNREACHABLE" || outcome.code === "PROVIDER_UNREACHABLE"))
        down.add(row.channel);
    }
    const settle = db().update(message);
    const byId = eq(message.id, row.id);
    if ("sent" in outcome) {
      if (whatsapp) whatsappSent += 1;
      await settle.set({ status: "sent", externalId: outcome.sent, sentAt: new Date(), error: null }).where(byId);
    } else if ("postponeTo" in outcome) {
      await settle
        .set({ status: "queued", attempts: sql`${message.attempts} - 1`, nextAt: outcome.postponeTo })
        .where(byId);
    } else if (outcome.retry) {
      const status = sql`CASE WHEN ${message.attempts} >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END`;
      await settle.set({ status, error: outcome.code, nextAt: addSeconds(t, 60 * 2 ** row.attempts) }).where(byId);
    } else {
      const failed = outcome.code === "PROVIDER_REJECTED" || outcome.code === "SMTP_AUTH_FAILED";
      await settle.set({ status: failed ? "failed" : "skipped", error: outcome.code }).where(byId);
    }
  }
}

function stateOf(response: { status: number; body: JsonObject | undefined }): WhatsAppState {
  if (response.status === 404) return "missing";
  const instance = response.body?.instance;
  const state = isObject(instance) ? instance.state : undefined;
  return state === "open" || state === "connecting" || state === "close" ? state : "error";
}

export async function whatsappState(config: Evolution | undefined): Promise<WhatsAppState> {
  if (!config) return "missing";
  try {
    // The admin waits on this; the bundled Evolution stays stopped until WhatsApp is connected, and Docker takes
    // 5 seconds to give up resolving a stopped service.
    return stateOf(await evolution(config, `/instance/connectionState/${INSTANCE}`, "GET", undefined, 2000));
  } catch {
    return "error";
  }
}

// undefined when WhatsApp could not be asked, so a stored photo is kept until the next try.
async function fetchPhoto(
  config: Evolution,
  address: string,
): Promise<Pick<Contact, "photo" | "photoType"> | undefined> {
  try {
    const found = await evolution(config, `/chat/fetchProfilePictureUrl/${INSTANCE}`, "POST", { number: address });
    if (found.status >= 300) return undefined;
    const link = found.body?.profilePictureUrl;
    const url = URL.parse(typeof link === "string" ? link : "");
    // Only WhatsApp's own image hosts: the server never follows a link anywhere else.
    if (!url || url.protocol !== "https:" || !url.hostname.endsWith(".whatsapp.net"))
      return { photo: null, photoType: null };
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !PHOTO_TYPES.includes(type) || Number(response.headers.get("content-length")) > PHOTO_MAX)
      return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= PHOTO_MAX ? { photo: bytes.toString("base64"), photoType: type } : undefined;
  } catch {
    return undefined;
  }
}

// Profile photos come only through the QR Code connection: the official API has no endpoint for them.
export async function refreshPhotos() {
  const t = new Date();

  const due = await db()
    .selectDistinct({ address: message.address })
    .from(message)
    .leftJoin(contact, eq(contact.address, message.address))
    .where(
      and(
        eq(message.channel, "whatsapp"),
        gt(message.createdAt, addSeconds(t, -PHOTO_ACTIVE)),
        or(isNull(contact.photoCheckedAt), lte(contact.photoCheckedAt, addSeconds(t, -PHOTO_TTL))),
      ),
    )
    .limit(10);

  if (due.length === 0) return;
  const stored = await credentials("whatsapp", "evolution");
  const config = evolutionOf(stored("evolution"));
  if (demoMode() || cloudOf(stored("whatsapp")) || !config || (await whatsappState(config)) !== "open") return;

  for (const { address } of due) {
    const photo = (await fetchPhoto(config, address)) ?? {};
    await db()
      .insert(contact)
      .values({ address, ...photo, photoCheckedAt: t })
      .onConflictDoUpdate({ target: contact.address, set: { ...photo, photoCheckedAt: t } });
  }
}

export async function contactPhoto(address: string) {
  const [row] = await db()
    .select({ photo: contact.photo, photoType: contact.photoType })
    .from(contact)
    .where(eq(contact.address, address));

  return row?.photo && row.photoType ? { bytes: Buffer.from(row.photo, "base64"), type: row.photoType } : undefined;
}

function bundled(config: Evolution) {
  return config.url === process.env.EVOLUTION_URL?.replace(/\/+$/, "");
}

// The bundled Evolution is off until WhatsApp is first connected, to save its memory: turn it on and wait up to a minute.
async function wakeEvolution(config: Evolution): Promise<boolean> {
  if (await switchWhatsApp(true)) return false;

  for (let tries = 0; tries < 20; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (
      await evolution(config, "/").then(
        () => true,
        () => false,
      )
    )
      return true;
  }

  return false;
}

export async function connectWhatsApp(): Promise<{ code: MessageCode | null; qr?: string; pairingCode?: string }> {
  const config = await evolutionConfig();
  if (!config) return { code: "CHANNEL_NOT_CONFIGURED" };
  const path = `/instance/connectionState/${INSTANCE}`;
  const reached = await evolution(config, path).catch(() => undefined);
  if (!reached && bundled(config) && !(await wakeEvolution(config))) return { code: "WHATSAPP_STARTING" };
  try {
    const state = reached ?? (await evolution(config, path));
    if (state.status === 404) {
      const created = await evolution(config, "/instance/create", "POST", {
        instanceName: INSTANCE,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      });

      if (created.status >= 300) return { code: "PROVIDER_REJECTED" };
    } else if (state.status >= 300) {
      return { code: "PROVIDER_REJECTED" };
    }

    const hook = await evolution(config, `/webhook/set/${INSTANCE}`, "POST", {
      webhook: {
        enabled: true,
        url: `${baseUrl()}/api/webhooks/whatsapp?k=${derive("bot")}`,
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    });

    if (hook.status >= 300) return { code: "PROVIDER_REJECTED" };
    const number = (await settings()).ownerWhatsapp;
    const connect = await evolution(config, `/instance/connect/${INSTANCE}${number ? `?number=${number}` : ""}`);
    if (connect.status >= 300) return { code: "PROVIDER_REJECTED" };
    const qr = connect.body?.base64;
    const pairingCode = connect.body?.pairingCode;
    return {
      code: null,
      qr: typeof qr === "string" && qr.startsWith("data:image/") ? qr : undefined,
      pairingCode: typeof pairingCode === "string" ? pairingCode : undefined,
    };
  } catch {
    return { code: "PROVIDER_UNREACHABLE" };
  }
}

export async function disconnectWhatsApp(): Promise<MessageCode | null> {
  const config = await evolutionConfig();
  if (!config) return "CHANNEL_NOT_CONFIGURED";
  try {
    const response = await evolution(config, `/instance/delete/${INSTANCE}`, "DELETE");
    if (response.status >= 300 && response.status !== 404) return "PROVIDER_REJECTED";
    // Without a number connected the bundled Evolution only takes memory, so it goes off until the next connect.
    if (bundled(config)) await switchWhatsApp(false);
    return null;
  } catch {
    return "PROVIDER_UNREACHABLE";
  }
}

function testText(brand: string): string {
  return `Teste do ${brand}\n\nSe você recebeu esta mensagem, o envio está funcionando.`;
}

// Checks the login with the SMTP server first, then mails the owner, so a failure names the step that broke.
export async function testEmail(): Promise<MessageCode | null> {
  const [smtp, current] = await Promise.all([smtpConfig(), settings()]);
  if (!smtp) return "CHANNEL_NOT_CONFIGURED";

  const login = await smtpAttempt(async () => {
    await mailer(smtp).verify();
    return { sent: null };
  });

  if ("code" in login) return login.code;
  if (!current.ownerEmail) return "OWNER_ADDRESS_MISSING";
  const outcome = await sendEmail(smtp, current.brand, current.ownerEmail, testText(current.brand));
  return "code" in outcome ? outcome.code : null;
}

export async function testWhatsApp(): Promise<MessageCode | null> {
  const config = await evolutionConfig();
  if (!config) return "CHANNEL_NOT_CONFIGURED";
  let state: WhatsAppState;
  try {
    const response = await evolution(config, `/instance/connectionState/${INSTANCE}`);
    if (response.status === 401 || response.status === 403) return "PROVIDER_REJECTED";
    state = stateOf(response);
  } catch {
    return "PROVIDER_UNREACHABLE";
  }
  if (state === "error") return "PROVIDER_UNREACHABLE";
  if (state !== "open") return "WHATSAPP_DISCONNECTED";
  const current = await settings();
  if (!current.ownerWhatsapp) return "OWNER_ADDRESS_MISSING";
  const outcome = await sendWhatsApp(config, current.ownerWhatsapp, testText(current.brand), state);
  return "code" in outcome ? outcome.code : null;
}

// Reads the number first, so a wrong id or token is told apart from a template Meta refuses.
export async function testCloud(): Promise<MessageCode | null> {
  const cloud = await cloudConfig();
  if (!cloud) return "CHANNEL_NOT_CONFIGURED";
  try {
    const response = await graph(cloud.token, `${cloud.phoneId}?fields=display_phone_number`);
    if (response.status >= 500) return "PROVIDER_UNREACHABLE";
    if (response.status >= 300) return "PROVIDER_REJECTED";
  } catch {
    return "PROVIDER_UNREACHABLE";
  }
  const current = await settings();
  if (!current.ownerWhatsapp) return "OWNER_ADDRESS_MISSING";
  const outcome = await sendCloud(cloud, current.ownerWhatsapp, testText(current.brand), false);
  return "code" in outcome ? outcome.code : null;
}

// The seller pastes only the token and the app secret: the WhatsApp account and number come from what the token
// was granted, and the webhook, the template and the number's registration are done here.
export async function connectCloud(link: {
  token: string;
  appSecret: string;
  phoneId: string;
  pin: string;
}): Promise<MessageCode | null> {
  const { token, appSecret } = link;
  if (!baseUrl().startsWith("https://")) return "CLOUD_WEBHOOK_FAILED";
  try {
    const debug = await graph(token, `debug_token?input_token=${encodeURIComponent(token)}`);
    const data = isObject(debug.body?.data) ? debug.body.data : undefined;
    const appId = data?.app_id;
    if (!data || data.is_valid !== true || typeof appId !== "string" || !/^\d+$/.test(appId))
      return "CLOUD_TOKEN_INVALID";
    if (data.expires_at !== 0) return "CLOUD_TOKEN_TEMPORARY";
    const scopes = objects(data.granular_scopes);
    const management = scopes.find((entry) => entry.scope === "whatsapp_business_management")?.target_ids;
    const wabaId = Array.isArray(management) ? management[0] : undefined;
    if (!scopes.some((entry) => entry.scope === "whatsapp_business_messaging")) return "CLOUD_PERMISSION_MISSING";
    if (typeof wabaId !== "string" || !/^\d+$/.test(wabaId)) return "CLOUD_PERMISSION_MISSING";

    const numbers = await phoneNumbers(token, wabaId);
    if (!numbers) return "CLOUD_PERMISSION_MISSING";

    const number = link.phoneId
      ? numbers.find((entry) => entry.id === link.phoneId)
      : (numbers.find((entry) => entry.registered) ?? numbers[0]);

    if (!number) return "CLOUD_NO_NUMBER";

    const appToken = `${appId}|${appSecret}`;
    if ((await graph(appToken, `${appId}?fields=id`)).status >= 300) return "CLOUD_APP_SECRET_INVALID";

    const hook = await graph(appToken, `${appId}/subscriptions`, {
      object: "whatsapp_business_account",
      callback_url: `${baseUrl()}/api/webhooks/whatsapp/cloud`,
      verify_token: derive("cloud"),
      fields: "messages",
    });

    // The app secret was just checked, so a refusal here is Meta failing to call the store back.
    if (hook.status >= 300) return "CLOUD_WEBHOOK_FAILED";
    const subscribed = await graph(token, `${wabaId}/subscribed_apps`, {});
    if (subscribed.status >= 300) return "CLOUD_PERMISSION_MISSING";

    const existing = await graph(token, `${wabaId}/message_templates?name=${TEMPLATE.name}&fields=name`);
    if (!objects(existing.body?.data).some((entry) => entry.name === TEMPLATE.name)) {
      const created = await graph(token, `${wabaId}/message_templates`, {
        name: TEMPLATE.name,
        language: TEMPLATE.language,
        category: "UTILITY",
        components: [{ type: "BODY", text: TEMPLATE.text, example: { body_text: [[TEMPLATE.example]] } }],
      });

      if (created.status >= 300) return "CLOUD_PERMISSION_MISSING";
    }

    // A number added in the Meta panel sends only after registration, which sets or checks its two-step PIN.
    if (!number.registered || link.pin) {
      if (!link.pin) return "CLOUD_PIN_REQUIRED";
      const registered = await graph(token, `${number.id}/register`, { messaging_product: "whatsapp", pin: link.pin });
      if (registered.status >= 300)
        return graphError(registered.body) === 133005 ? "CLOUD_PIN_INVALID" : "PROVIDER_REJECTED";
    }

    await saveCredentials("whatsapp", { phoneId: number.id, wabaId, number: number.label }, { token, appSecret });
    await fillSettings({ support_whatsapp: parsePhone(number.label) });
    return null;
  } catch {
    return "PROVIDER_UNREACHABLE";
  }
}

async function phoneNumbers(
  token: string,
  wabaId: string,
): Promise<{ id: string; label: string; registered: boolean }[] | undefined> {
  const response = await graph(
    token,
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type`,
  );

  if (response.status >= 300) return undefined;

  return objects(response.body?.data).flatMap((entry) =>
    typeof entry.id === "string" && /^\d+$/.test(entry.id)
      ? [
          {
            id: entry.id,
            label: [entry.display_phone_number, entry.verified_name]
              .filter((part) => typeof part === "string" && part)
              .join(" · "),
            registered: entry.platform_type !== "NOT_APPLICABLE",
          },
        ]
      : [],
  );
}

// What the Connections card shows: the template review and the numbers the seller can switch between.
export async function cloudStatus(
  cloud: Cloud,
): Promise<{ template: TemplateState; numbers: { id: string; label: string }[] }> {
  try {
    const [templates, numbers] = await Promise.all([
      graph(cloud.token, `${cloud.wabaId}/message_templates?name=${TEMPLATE.name}&fields=name,status`),
      phoneNumbers(cloud.token, cloud.wabaId),
    ]);

    const template = objects(templates.body?.data).find((entry) => entry.name === TEMPLATE.name);

    return {
      template:
        templates.status >= 300
          ? "error"
          : typeof template?.status === "string"
            ? (TEMPLATE_STATES[template.status] ?? "rejected")
            : "rejected",
      numbers: (numbers ?? []).map(({ id, label }) => ({ id, label })),
    };
  } catch {
    return { template: "error", numbers: [] };
  }
}

function inboundText(incoming: JsonObject): string | undefined {
  const content = incoming.message;
  if (!isObject(content)) return undefined;
  if (typeof content.conversation === "string") return content.conversation;
  const extended = content.extendedTextMessage;
  return isObject(extended) && typeof extended.text === "string" ? extended.text : undefined;
}

async function receiveMessage(incoming: JsonObject) {
  const key = incoming.key;
  if (!isObject(key) || key.fromMe === true) return;

  const jid = [key.remoteJid, key.remoteJidAlt].find(
    (value) => typeof value === "string" && value.endsWith("@s.whatsapp.net"),
  );

  await storeInbound(
    typeof jid === "string" ? (jid.split("@")[0] ?? "") : "",
    inboundText(incoming),
    typeof key.id === "string" ? key.id : null,
    typeof incoming.pushName === "string" ? incoming.pushName : "",
  );
}

async function storeInbound(phone: string, raw: string | undefined, externalId: string | null, profile: string) {
  const text = raw?.slice(0, 4096);
  if (!/^\d{10,15}$/.test(phone) || !text) return;
  const t = new Date();
  const name = parsePrintable(profile.replace(/\s+/g, " "), 80);
  await db().transaction(async (tx) => {
    if (name)
      await tx
        .insert(contact)
        .values({ address: phone, name })
        .onConflictDoUpdate({ target: contact.address, set: { name } });

    const stored = await tx
      .insert(message)
      .values({
        channel: "whatsapp",
        address: phone,
        kind: "inbound",
        body: text,
        status: "received",
        externalId,
        createdAt: t,
      })
      .onConflictDoNothing()
      .returning({ id: message.id });

    if (stored.length === 0) return;
    const said = words(text);
    const stop = said === "sair" || said === "parar";
    if (stop) await optOut(tx, phone);

    const answer = stop
      ? "Pronto: você não vai mais receber mensagens automáticas deste número."
      : (await replies(tx)).find((entry) => entry.keywords.some((keyword) => words(keyword) === said))?.text;

    if (!answer) return;

    // A sender repeating a keyword would otherwise spend the number's daily cap and silence cart recovery.
    const { recent } = await tx
      .select({ recent: count() })
      .from(message)
      .where(and(eq(message.address, phone), eq(message.kind, "reply"), gt(message.createdAt, addSeconds(t, -3600))))
      .then(one);

    if (!stop && recent >= REPLIES_PER_HOUR) return;
    await tx.insert(message).values({
      channel: "whatsapp",
      address: phone,
      kind: "reply",
      body: fill(answer, { base: baseUrl() }),
      status: "queued",
      nextAt: t,
      createdAt: t,
    });
  });
}

async function receiveReceipt(update: JsonObject) {
  const key = update.key;

  const id =
    typeof update.keyId === "string" ? update.keyId : isObject(key) && typeof key.id === "string" ? key.id : undefined;

  const status =
    update.status === "DELIVERY_ACK"
      ? "delivered"
      : update.status === "READ" || update.status === "PLAYED"
        ? "read"
        : undefined;

  if (id && status) await markReceipt(id, status);
}

async function markReceipt(id: string, status: "delivered" | "read" | "failed") {
  await db()
    .update(message)
    .set(status === "failed" ? { status, error: "PROVIDER_REJECTED" } : { status })
    .where(
      and(
        eq(message.externalId, id),
        ne(message.kind, "inbound"),
        status === "read" ? inArray(message.status, ["sent", "delivered"]) : eq(message.status, "sent"),
      ),
    );
}

async function handleInbound(payload: JsonObject) {
  const event = typeof payload.event === "string" ? payload.event.toLowerCase().replace(/_/g, ".") : "";
  const data = payload.data;
  const items = (Array.isArray(data) ? data : [data]).filter(isObject);
  for (const item of items) {
    if (event === "messages.upsert") await receiveMessage(item);
    if (event === "messages.update") await receiveReceipt(item);
  }
}

export async function botWebhook(request: Request): Promise<Response> {
  if (!safeEqual(new URL(request.url).searchParams.get("k") ?? "", derive("bot")))
    return Response.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  const raw = await readBody(request, BOT_LIMIT);
  if (raw === undefined) return Response.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const payload = jsonObject(raw);
  if (!payload) return Response.json({ code: "INVALID_PAYLOAD" }, { status: 400 });
  await handleInbound(payload);
  return Response.json({ ok: true });
}

function objects(value: Json | undefined): JsonObject[] {
  return (Array.isArray(value) ? value : []).filter(isObject);
}

// Meta checks the callback once with the verify token shown in the panel and expects the challenge back.
export function cloudVerify(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge") ?? "";

  return params.get("hub.mode") === "subscribe" &&
    safeEqual(params.get("hub.verify_token") ?? "", derive("cloud")) &&
    /^\d{1,40}$/.test(challenge)
    ? new Response(challenge, { headers: { "Content-Type": "text/plain" } })
    : Response.json({ code: "INVALID_SIGNATURE" }, { status: 403 });
}

export async function cloudWebhook(request: Request): Promise<Response> {
  const raw = await readBody(request, BOT_LIMIT);
  if (raw === undefined) return Response.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const stored = (await credentials("whatsapp"))("whatsapp");
  const appSecret = stored("appSecret");
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!appSecret || !safeEqual(signature, `sha256=${hmacHex(appSecret, raw)}`))
    return Response.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  const payload = jsonObject(raw);
  if (!payload) return Response.json({ code: "INVALID_PAYLOAD" }, { status: 400 });

  const phoneId = stored("phoneId");
  for (const change of objects(payload.entry).flatMap((entry) => objects(entry.changes))) {
    const value = isObject(change.value) ? change.value : {};
    // Every number on the seller's Meta app signs with the same secret; only the connected one is this store's.
    const metadata = isObject(value.metadata) ? value.metadata : {};
    if (metadata.phone_number_id !== phoneId) continue;

    const profiles = new Map(
      objects(value.contacts).flatMap((entry): [string, string][] => {
        const name = isObject(entry.profile) ? entry.profile.name : undefined;
        return typeof entry.wa_id === "string" && typeof name === "string" ? [[entry.wa_id, name]] : [];
      }),
    );

    for (const incoming of objects(value.messages)) {
      const body = isObject(incoming.text) ? incoming.text.body : undefined;
      const from = typeof incoming.from === "string" ? incoming.from : "";
      await storeInbound(
        from,
        typeof body === "string" ? body : undefined,
        typeof incoming.id === "string" ? incoming.id : null,
        profiles.get(from) ?? "",
      );
    }
    for (const update of objects(value.statuses)) {
      const status = update.status;
      if (typeof update.id === "string" && (status === "delivered" || status === "read" || status === "failed"))
        await markReceipt(update.id, status);
    }
  }
  return Response.json({ ok: true });
}
