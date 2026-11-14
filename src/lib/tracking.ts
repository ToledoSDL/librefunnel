import "server-only";
import { isIP } from "node:net";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { credentials, productNames } from "./catalog";
import { addSeconds, db, newId } from "./db";
import { baseUrl, clientIp, isObject, jsonObject, limited, now, printable, readBody, setCookie, sha256 } from "./guard";
import type { JsonObject } from "./guard";
import { conversion, customer, event, order, payment, product, retention, touch } from "./schema";

export type TrackCode = "INVALID_EVENT" | "RATE_LIMITED";
export type ConversionCode = "META_NOT_CONFIGURED" | "META_REJECTED" | "META_UNREACHABLE";
type TrackEvent = (typeof event.$inferSelect)["name"];
type ClickKind = (typeof touch.$inferSelect)["clickKind"];
type ConversionKey = { orderId: string; name: (typeof conversion.$inferSelect)["name"] };
type Meta = { pixelId: string; token: string; testEventCode: string };

const EVENTS: TrackEvent[] = [
  "page_view",
  "video_play",
  "video_25",
  "video_50",
  "video_75",
  "video_100",
  "cta_view",
  "cta_click",
];

const CLICK_KINDS: Exclude<ClickKind, "">[] = ["fbclid", "gclid", "ttclid"];
const VISITOR = /^[a-z0-9]{20}$/;
const VISITOR_COOKIE = "lf_vid";
const VISITOR_TTL = 400 * 86400;
export const GRAPH = "https://graph.facebook.com/v27.0";
const META_RETRYABLE = [1, 2, 4, 17, 341, 613];
const MAX_EVENT_AGE = 7 * 86400 - 3600;
const MAX_ATTEMPTS = 5;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const RETENTION_BATCH = 120;

export async function visitor(): Promise<string> {
  const current = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (current && VISITOR.test(current)) return current;
  const id = newId();
  await setCookie(VISITOR_COOKIE, id, VISITOR_TTL, "lax");
  return id;
}

function referrerHost(referrer: string): string {
  const url = URL.parse(referrer);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return "";
  const host = url.hostname.toLowerCase().slice(0, 200);
  return host === URL.parse(baseUrl())?.hostname ? "" : host;
}

export async function recordTouch(visitorId: string, search: string, referrer: string, landing: string) {
  const params = new URLSearchParams(search.slice(0, 2000));
  const value = (name: string) => printable(params.get(name) ?? "", 200);
  const clickKind: ClickKind = CLICK_KINDS.find((kind) => value(kind) !== "") ?? "";

  const fields = {
    source: value("utm_source"),
    medium: value("utm_medium"),
    campaign: value("utm_campaign"),
    content: value("utm_content"),
    term: value("utm_term"),
    clickKind,
    clickId: clickKind ? value(clickKind) : "",
    referrerHost: referrerHost(referrer),
  };

  if (Object.values(fields).every((part) => part === "")) return;
  const t = new Date();
  await db()
    .insert(touch)
    .values({
      visitorId,
      ...fields,
      landing: /^\/[^\s]{0,199}$/.test(landing) ? landing : "/",
      firstSeenAt: t,
      lastSeenAt: t,
    })
    .onConflictDoUpdate({
      target: [
        touch.visitorId,
        touch.source,
        touch.medium,
        touch.campaign,
        touch.content,
        touch.term,
        touch.clickId,
        touch.referrerHost,
      ],
      set: { lastSeenAt: sql`excluded.last_seen_at` },
    });
}

// Meta's documented fallback when the _fbc cookie is missing: fb.<subdomainIndex>.<first seen ms>.<fbclid>.
export async function fbcFor(visitorId: string): Promise<string | null> {
  const [click] = await db()
    .select({ clickId: touch.clickId, firstSeenAt: touch.firstSeenAt })
    .from(touch)
    .where(and(eq(touch.visitorId, visitorId), eq(touch.clickKind, "fbclid")))
    .orderBy(desc(touch.lastSeenAt))
    .limit(1);

  return click ? `fb.1.${click.firstSeenAt.getTime()}.${click.clickId}` : null;
}

export function metaCookie(value: string | undefined, name: "_fbp" | "_fbc"): string | null {
  const pattern = name === "_fbp" ? /^fb\.\d\.\d{10,16}\.\d{1,30}$/ : /^fb\.\d\.\d{10,16}\.[\x21-\x7e]{1,400}$/;
  return value && pattern.test(value) ? value : null;
}

async function track(body: JsonObject, visitorId: string): Promise<TrackCode | null> {
  const name = EVENTS.find((candidate) => candidate === body.e);
  const product = body.p;
  if (!name || typeof product !== "string" || (product !== "" && !(await productNames()).has(product)))
    return "INVALID_EVENT";
  if (name === "page_view") {
    await recordTouch(
      visitorId,
      typeof body.q === "string" ? body.q : "",
      typeof body.r === "string" ? body.r : "",
      typeof body.l === "string" ? body.l : "/",
    );
  }
  await db().insert(event).values({ visitorId, product, name, createdAt: new Date() }).onConflictDoNothing();
  return null;
}

export async function trackRequest(request: Request): Promise<Response> {
  if (limited("track", clientIp(request.headers), 240, 60))
    return Response.json({ code: "RATE_LIMITED" }, { status: 429 });
  const raw = await readBody(request, 2048);
  if (raw === undefined) return Response.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const body = jsonObject(raw);
  let code: TrackCode | null = "INVALID_EVENT";
  if (body)
    code = body.e === "retention" ? await recordRetention(body, await visitor()) : await track(body, await visitor());
  return code ? Response.json({ code }, { status: 400 }) : new Response(null, { status: 204 });
}

// One statement checks the product is live and counts every second, so concurrent page loads add up without a read.
// The same seconds add to this visitor's watch time, shown next to their conversation in the inbox.
async function recordRetention(body: JsonObject, visitorId: string): Promise<TrackCode | null> {
  const slug = body.p;
  const seconds = body.s;
  if (
    typeof slug !== "string" ||
    !SLUG.test(slug) ||
    !Array.isArray(seconds) ||
    seconds.length === 0 ||
    seconds.length > RETENTION_BATCH ||
    !seconds.every(
      (second): second is number =>
        typeof second === "number" && Number.isInteger(second) && second >= 0 && second <= 7200,
    )
  )
    return "INVALID_EVENT";

  const rows = sql.join(
    [...new Set(seconds)].map((second) => sql`(${second}::integer)`),
    sql`, `,
  );

  const counted = await db()
    .insert(retention)
    .select(
      sql`SELECT ${product.slug}, watched.second, 1 FROM ${product} CROSS JOIN (VALUES ${rows}) AS watched(second) WHERE ${product.slug} = ${slug} AND ${product.archivedAt} IS NULL`,
    )
    .onConflictDoUpdate({
      target: [retention.product, retention.second],
      set: { views: sql`${retention.views} + excluded.views` },
    })
    .returning({ second: retention.second });

  if (counted.length === 0) return "INVALID_EVENT";
  await db()
    .insert(event)
    .values({ visitorId, product: slug, name: "video_watch", value: counted.length, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [event.visitorId, event.product, event.name],
      set: { value: sql`${event.value} + excluded.value` },
    });
  return null;
}

export async function retentionCurve(slug: string) {
  const stats = db()
    .$with("stats")
    .as(
      db()
        .select({
          size: sql<number>`GREATEST(1, CEIL((MAX(${retention.second}) + 1) / 60.0))::integer`.as("size"),
          plays: sql<number>`COALESCE(MAX(${retention.views}) FILTER (WHERE ${retention.second} = 0), 0)`.as("plays"),
        })
        .from(retention)
        .where(eq(retention.product, slug)),
    );

  const start = sql<number>`${retention.second} / ${stats.size} * ${stats.size}`;

  // Plays resumed mid-video never reach second 0, so a bucket can outnumber the plays: the share caps at 100%.
  const rows = await db()
    .with(stats)
    .select({
      second: start.mapWith(Number),
      plays: stats.plays,
      share: sql<number>`COALESCE(LEAST(1, MAX(${retention.views})::float8 / NULLIF(${stats.plays}, 0)), 0)`.mapWith(
        Number,
      ),
    })
    .from(retention)
    .innerJoin(stats, sql`true`)
    .where(eq(retention.product, slug))
    .groupBy(start, stats.plays)
    .orderBy(start);

  return { plays: rows[0]?.plays ?? 0, points: rows.map((row) => ({ second: row.second, share: row.share })) };
}

// Read per batch from the panel's settings, so a saved change applies to the next batch.
async function metaConfig(): Promise<Meta | undefined> {
  const meta = (await credentials("meta"))("meta");
  const pixelId = meta("pixelId");
  const token = meta("token");
  return pixelId && token ? { pixelId, token, testEventCode: meta("testEventCode") } : undefined;
}

async function meta(config: Meta, data: object[]): Promise<ConversionCode | null> {
  try {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(config.pixelId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data,
        access_token: config.token,
        ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = jsonObject(await response.text());
    if (response.ok && body?.events_received === data.length) return null;
    const error = body?.error;
    const code = isObject(error) ? error.code : undefined;
    const trace = isObject(error) ? error.fbtrace_id : undefined;
    console.warn(`[librefunnel] meta capi HTTP ${response.status} code ${String(code)} trace ${String(trace)}`);
    return response.status >= 500 || (typeof code === "number" && META_RETRYABLE.includes(code))
      ? "META_UNREACHABLE"
      : "META_REJECTED";
  } catch {
    return "META_UNREACHABLE";
  }
}

function nameParts(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

function keyed(keys: ConversionKey[]) {
  return sql`(${conversion.orderId}, ${conversion.name}) IN (${sql.join(
    keys.map((key) => sql`(${key.orderId}, ${key.name})`),
    sql`, `,
  )})`;
}

export async function sendConversions() {
  const t = new Date();
  const queued = and(eq(conversion.status, "queued"), lte(conversion.nextAt, t));
  const config = await metaConfig();
  if (!config) {
    await db().update(conversion).set({ status: "skipped", error: "META_NOT_CONFIGURED" }).where(queued);
    return;
  }

  // SKIP LOCKED plus the queued check in the update lets two senders run at once without claiming the same event.
  const due = db()
    .select({ orderId: conversion.orderId, name: conversion.name })
    .from(conversion)
    .where(queued)
    .orderBy(asc(conversion.nextAt))
    .limit(100)
    .for("update", { skipLocked: true });

  const claimed = await db()
    .update(conversion)
    .set({ attempts: sql`${conversion.attempts} + 1`, nextAt: addSeconds(t, 600) })
    .where(and(queued, sql`(${conversion.orderId}, ${conversion.name}) IN ${due}`))
    .returning({ orderId: conversion.orderId, name: conversion.name });

  if (claimed.length === 0) return;

  const rows = await db()
    .select({
      orderId: conversion.orderId,
      name: conversion.name,
      customerId: order.customerId,
      product: order.product,
      bump: order.bump,
      productAmount: order.productAmount,
      bumpAmount: order.bumpAmount,
      amount: order.amount,
      buyer: order.name,
      phone: order.phone,
      ip: order.ip,
      userAgent: order.userAgent,
      fbp: order.fbp,
      fbc: order.fbc,
      createdAt: order.createdAt,
      email: customer.email,
      paidAt:
        sql<Date | null>`(SELECT MIN(${payment.createdAt}) FROM ${payment} WHERE ${payment.orderId} = ${order.id} AND ${payment.amount} > 0)`.mapWith(
          payment.createdAt,
        ),
    })
    .from(conversion)
    .innerJoin(order, eq(order.id, conversion.orderId))
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(keyed(claimed));

  const events: object[] = [];
  const stale: ConversionKey[] = [];
  const batch: ConversionKey[] = [];
  const oldest = addSeconds(t, -MAX_EVENT_AGE);
  for (const row of rows) {
    const key = { orderId: row.orderId, name: row.name };
    const eventTime = row.name === "Purchase" ? (row.paidAt ?? row.createdAt) : row.createdAt;
    if (eventTime < oldest) {
      stale.push(key);
      continue;
    }
    const parts = nameParts(row.buyer);
    const contents = [{ id: row.product, quantity: 1, item_price: row.productAmount / 100 }];
    if (row.bump && row.bumpAmount) contents.push({ id: row.bump, quantity: 1, item_price: row.bumpAmount / 100 });
    batch.push(key);
    events.push({
      event_name: row.name,
      event_time: Math.floor(eventTime.getTime() / 1000),
      event_id: `${row.orderId}:${row.name}`,
      action_source: "website",
      event_source_url: `${baseUrl()}/c/${row.product}`,
      user_data: {
        em: [sha256(row.email)],
        ...(row.phone ? { ph: [sha256(row.phone)] } : {}),
        ...(parts[0] ? { fn: [sha256(parts[0])] } : {}),
        ...(parts.length > 1 ? { ln: [sha256(parts[parts.length - 1] ?? "")] } : {}),
        country: [sha256("br")],
        external_id: [sha256(row.customerId)],
        ...(isIP(row.ip) ? { client_ip_address: row.ip } : {}),
        client_user_agent: row.userAgent,
        ...(row.fbp ? { fbp: row.fbp } : {}),
        ...(row.fbc ? { fbc: row.fbc } : {}),
      },
      custom_data: {
        currency: "BRL",
        value: row.amount / 100,
        content_ids: contents.map((item) => item.id),
        contents,
        content_type: "product",
        num_items: contents.length,
        order_id: row.orderId,
      },
    });
  }

  if (stale.length)
    await db().update(conversion).set({ status: "failed", error: "META_REJECTED", nextAt: t }).where(keyed(stale));
  if (events.length === 0) return;
  const code = await meta(config, events);
  if (code === null) {
    await db()
      .update(conversion)
      .set({ status: "sent", error: null, sentAt: new Date(), nextAt: t })
      .where(keyed(batch));
    return;
  }
  if (code === "META_REJECTED") {
    await db().update(conversion).set({ status: "failed", error: code, nextAt: t }).where(keyed(batch));
    return;
  }
  await db()
    .update(conversion)
    .set({
      status: sql`CASE WHEN ${conversion.attempts} >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END`,
      error: code,
      nextAt: sql`${t.toISOString()}::timestamptz + interval '1 minute' * (1 << ${conversion.attempts})`,
    })
    .where(keyed(batch));
}

export async function sendMetaTest(): Promise<ConversionCode | null> {
  const config = await metaConfig();
  if (!config) return "META_NOT_CONFIGURED";
  return meta(config, [
    {
      event_name: "LibreFunnelTest",
      event_time: now(),
      action_source: "system_generated",
      user_data: { external_id: [sha256("librefunnel-test")] },
    },
  ]);
}
