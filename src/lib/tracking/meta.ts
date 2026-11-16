import "server-only";
import { isIP } from "node:net";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { addSeconds, db } from "../db";
import { clientIp, demoMode, isObject, jsonObject, now, sha256, siteOf } from "../guard";
import { conversion, customer, order, payment, product, signal } from "../schema";
import { credentials } from "../settings";
import { fbcFor, metaCookie } from "./visitors";

export type ConversionCode = "META_NOT_CONFIGURED" | "META_REJECTED" | "META_UNREACHABLE";

export type ConversionKey = { orderId: string; name: (typeof conversion.$inferSelect)["name"] };

type SignalKey = { visitorId: string; product: string; name: SignalName };

export type SignalName = (typeof signal.$inferSelect)["name"];

type Meta = { pixelId: string; token: string; testEventCode: string };

export const GRAPH = "https://graph.facebook.com/v27.0";

const META_RETRYABLE = [1, 2, 4, 17, 341, 613];

const MAX_EVENT_AGE = 7 * 86400 - 3600;

const MAX_ATTEMPTS = 5;

// Stores the visitor's address only when Meta is connected, so a store without it keeps no IP.
export async function queueSignal(name: SignalName, visitorId: string, slug: string, request: Request) {
  if (demoMode() || !(await metaConfig())) return;
  const jar = await cookies();
  const t = new Date();
  await db()
    .insert(signal)
    .values({
      visitorId,
      product: slug,
      name,
      ip: clientIp(request.headers),
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 500),
      fbp: metaCookie(jar.get("_fbp")?.value, "_fbp"),
      fbc: metaCookie(jar.get("_fbc")?.value, "_fbc") ?? (await fbcFor(visitorId)),
      nextAt: t,
      createdAt: t,
    })
    .onConflictDoNothing();
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

function signalKeyed(keys: SignalKey[]) {
  return sql`(${signal.visitorId}, ${signal.product}, ${signal.name}) IN (${sql.join(
    keys.map((key) => sql`(${key.visitorId}, ${key.product}, ${key.name})`),
    sql`, `,
  )})`;
}

// What a sent batch writes back to its queue, the same for order steps and signals.
function outcome(code: ConversionCode | null, t: Date, attempts: typeof conversion.attempts | typeof signal.attempts) {
  if (code === null) return { status: "sent" as const, error: null, sentAt: new Date(), nextAt: t };
  if (code === "META_REJECTED") return { status: "failed" as const, error: code, nextAt: t };
  return {
    status: sql`CASE WHEN ${attempts} >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END`,
    error: code,
    nextAt: sql`${t.toISOString()}::timestamptz + interval '1 minute' * (1 << ${attempts})`,
  };
}

async function deliver<K>(
  config: Meta,
  pending: { key: K; event: object }[],
  settle: (keys: K[], code: ConversionCode | null) => Promise<unknown>,
) {
  if (pending.length === 0) return;

  const code = await meta(
    config,
    pending.map((entry) => entry.event),
  );

  if (code !== "META_REJECTED" || pending.length === 1) {
    await settle(
      pending.map((entry) => entry.key),
      code,
    );
    return;
  }
  // Meta rejects the whole batch for one malformed event: sent alone, each event gets its own answer.
  for (const entry of pending) await settle([entry.key], await meta(config, [entry.event]));
}

// The one sender for every ad platform event, run by the background loop.
export async function sendConversions() {
  const t = new Date();
  const config = demoMode() ? undefined : await metaConfig();
  if (!config) {
    const skipped = { status: "skipped" as const, error: "META_NOT_CONFIGURED" };
    await db()
      .update(conversion)
      .set(skipped)
      .where(and(eq(conversion.status, "queued"), lte(conversion.nextAt, t)));
    await db()
      .update(signal)
      .set(skipped)
      .where(and(eq(signal.status, "queued"), lte(signal.nextAt, t)));
    return;
  }
  await sendOrderSteps(config, t);
  await sendSignals(config, t);
}

async function sendOrderSteps(config: Meta, t: Date) {
  const queued = and(eq(conversion.status, "queued"), lte(conversion.nextAt, t));

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
      visitorId: order.visitorId,
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
      domain: product.domain,
      paidAt:
        sql<Date | null>`(SELECT MIN(${payment.createdAt}) FROM ${payment} WHERE ${payment.orderId} = ${order.id} AND ${payment.amount} > 0)`.mapWith(
          payment.createdAt,
        ),
    })
    .from(conversion)
    .innerJoin(order, eq(order.id, conversion.orderId))
    .innerJoin(customer, eq(customer.id, order.customerId))
    .innerJoin(product, eq(product.slug, order.product))
    .where(keyed(claimed));

  const pending: { key: ConversionKey; event: object }[] = [];
  const stale: ConversionKey[] = [];
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
    pending.push({
      key,
      event: {
        event_name: row.name,
        event_time: Math.floor(eventTime.getTime() / 1000),
        event_id: `${row.orderId}:${row.name}`,
        action_source: "website",
        event_source_url: `${siteOf(row)}/c/${row.product}`,
        user_data: {
          em: [sha256(row.email)],
          ...(row.phone ? { ph: [sha256(row.phone)] } : {}),
          ...(parts[0] ? { fn: [sha256(parts[0])] } : {}),
          ...(parts.length > 1 ? { ln: [sha256(parts[parts.length - 1] ?? "")] } : {}),
          country: [sha256("br")],
          // The visitor id ties this buyer to the ViewContent and InitiateCheckout they sent before buying.
          external_id: [sha256(row.customerId), ...(row.visitorId ? [sha256(row.visitorId)] : [])],
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
      },
    });
  }

  if (stale.length)
    await db().update(conversion).set({ status: "failed", error: "META_REJECTED", nextAt: t }).where(keyed(stale));
  await deliver(config, pending, (keys, code) =>
    db()
      .update(conversion)
      .set(outcome(code, t, conversion.attempts))
      .where(keyed(keys)),
  );
}

async function sendSignals(config: Meta, t: Date) {
  const queued = and(eq(signal.status, "queued"), lte(signal.nextAt, t));

  const due = db()
    .select({ visitorId: signal.visitorId, product: signal.product, name: signal.name })
    .from(signal)
    .where(queued)
    .orderBy(asc(signal.nextAt))
    .limit(100)
    .for("update", { skipLocked: true });

  const claimed = await db()
    .update(signal)
    .set({ attempts: sql`${signal.attempts} + 1`, nextAt: addSeconds(t, 600) })
    .where(and(queued, sql`(${signal.visitorId}, ${signal.product}, ${signal.name}) IN ${due}`))
    .returning({
      visitorId: signal.visitorId,
      product: signal.product,
      name: signal.name,
      ip: signal.ip,
      userAgent: signal.userAgent,
      fbp: signal.fbp,
      fbc: signal.fbc,
      createdAt: signal.createdAt,
    });

  if (claimed.length === 0) return;

  const offers = await db()
    .select({
      slug: product.slug,
      price: product.priceCents,
      vsl: sql<boolean>`${product.vslVideo} IS NOT NULL`,
      domain: product.domain,
    })
    .from(product)
    .where(inArray(product.slug, [...new Set(claimed.map((row) => row.product))]));

  const bySlug = new Map(offers.map((offer) => [offer.slug, offer]));
  const pending: { key: SignalKey; event: object }[] = [];
  const stale: SignalKey[] = [];
  const oldest = addSeconds(t, -MAX_EVENT_AGE);
  for (const row of claimed) {
    const key = { visitorId: row.visitorId, product: row.product, name: row.name };
    const offer = bySlug.get(row.product);
    if (!offer || row.createdAt < oldest) {
      stale.push(key);
      continue;
    }
    pending.push({
      key,
      event: {
        event_name: row.name,
        event_time: Math.floor(row.createdAt.getTime() / 1000),
        event_id: `${row.visitorId}:${row.product}:${row.name}`,
        action_source: "website",
        event_source_url: `${siteOf(offer)}/${row.name === "ViewContent" && offer.vsl ? "v" : "c"}/${row.product}`,
        user_data: {
          external_id: [sha256(row.visitorId)],
          ...(isIP(row.ip) ? { client_ip_address: row.ip } : {}),
          client_user_agent: row.userAgent,
          ...(row.fbp ? { fbp: row.fbp } : {}),
          ...(row.fbc ? { fbc: row.fbc } : {}),
        },
        custom_data: {
          currency: "BRL",
          value: offer.price / 100,
          content_ids: [row.product],
          content_type: "product",
        },
      },
    });
  }

  if (stale.length)
    await db().update(signal).set({ status: "failed", error: "META_REJECTED", nextAt: t }).where(signalKeyed(stale));
  await deliver(config, pending, (keys, code) =>
    db()
      .update(signal)
      .set(outcome(code, t, signal.attempts))
      .where(signalKeyed(keys)),
  );
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
