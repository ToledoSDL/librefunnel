import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { ORDER_STEPS } from "@/funnel";
import type { OrderStep } from "@/funnel";
import { addSeconds, db } from "../db";
import type { Database } from "../db";
import { clientIp, siteOf } from "../guard";
import { conversion, customer, order, payment, product, signal } from "../schema";
import type { Credentials } from "../settings";
import { accounts } from "./accounts";
import type { Sender } from "./accounts";
import { browserIds, fbcFor, latestClicks } from "./visitors";
import type { AdClick } from "./visitors";

export type Platform = (typeof conversion.$inferSelect)["platform"];

export type SignalName = (typeof signal.$inferSelect)["name"];

type ConversionName = (typeof conversion.$inferSelect)["name"];

export type Failure = "REJECTED" | "UNREACHABLE";

const PREFIX = {
  meta: "META",
  tiktok: "TIKTOK",
  analytics: "ANALYTICS",
  googleads: "GOOGLE_ADS",
} as const satisfies Record<Platform, string>;

export type ConversionCode =
  | `${(typeof PREFIX)[Platform]}_${Failure | "NOT_CONFIGURED"}`
  | "INVALID_TIKTOK_PIXEL"
  | "INVALID_MEASUREMENT_ID"
  | "INVALID_GOOGLE_ADS_ACCOUNT"
  | "INVALID_CONVERSION_ACTION"
  | "INVALID_GOOGLE_TAG"
  | "INVALID_VERIFICATION";

// What every platform reads to build an order event: the order, its buyer and the browser that placed it.
export type Sale = {
  orderId: string;
  name: ConversionName;
  at: Date;
  url: string;
  customerId: string;
  visitorId: string | null;
  product: string;
  bump: string | null;
  productAmount: number;
  bumpAmount: number | null;
  amount: number;
  buyer: string;
  email: string;
  phone: string | null;
  ip: string;
  userAgent: string;
  fbp: string | null;
  fbc: string | null;
  ttp: string | null;
  gaClient: string | null;
  gaSession: string | null;
  clicks: Partial<Record<AdClick, string>>;
};

// An event from before an order exists, for platforms that take them.
export type Visit = {
  visitorId: string;
  product: string;
  name: SignalName;
  eventId: string;
  at: Date;
  url: string;
  price: number;
  ip: string;
  userAgent: string;
  fbp: string | null;
  fbc: string | null;
  ttp: string | null;
  clicks: Partial<Record<AdClick, string>>;
};

// One ad platform: how it reads its connection, builds its events and sends a batch of them.
export type Destination<C, K extends Platform> = {
  config: (read: Credentials<K>) => C | undefined;
  maxAge: number;
  batch: number;
  sale: (row: Sale) => object;
  visit?: (row: Visit) => object;
  send: (config: C, events: object[]) => Promise<Failure | null>;
  test: (config: C) => Promise<Failure | null>;
};

type Routed<K> = { skipped: K[]; stale: K[]; batches: Map<Sender, { key: K; event: object }[]> };

type Routing<K> = { key: K; at: Date | undefined; send: { sender: Sender; event: () => object } | undefined };

const MAX_ATTEMPTS = 5;

const PLATFORMS = conversion.platform.enumValues;

// Orders call this inside their transaction, so the step and the order commit together. A platform that is not
// connected when the batch runs marks its row skipped.
export async function orderStep(tx: Database, orderId: string, step: OrderStep) {
  const { name, platforms } = ORDER_STEPS[step];

  await tx
    .insert(conversion)
    .values(platforms.map((platform) => ({ orderId, name, platform, nextAt: new Date() })))
    .onConflictDoNothing();
}

// Stores the visitor's address and browser ids only for platforms connected for this product, so a store without them
// keeps none.
export async function queueSignal(
  name: SignalName,
  visitorId: string,
  slug: string,
  eventId: string,
  request: Request,
) {
  const connected = await accounts([slug]);
  const platforms = PLATFORMS.filter((platform) => connected(platform, slug)?.visit);
  if (platforms.length === 0) return;
  const ids = await browserIds();
  const fbc = platforms.includes("meta") ? (ids.fbc ?? (await fbcFor(visitorId))) : null;
  const t = new Date();

  await db()
    .insert(signal)
    .values(
      platforms.map((platform) => ({
        visitorId,
        product: slug,
        name,
        platform,
        eventId,
        ip: clientIp(request.headers),
        userAgent: (request.headers.get("user-agent") ?? "").slice(0, 500),
        fbp: platform === "meta" ? ids.fbp : null,
        fbc: platform === "meta" ? fbc : null,
        ttp: platform === "tiktok" ? ids.ttp : null,
        nextAt: t,
        createdAt: t,
      })),
    )
    .onConflictDoNothing();
}

function conversionKeyed(platform: Platform, keys: { orderId: string; name: ConversionName }[]) {
  return and(
    eq(conversion.platform, platform),
    sql`(${conversion.orderId}, ${conversion.name}) IN (${sql.join(
      keys.map((key) => sql`(${key.orderId}, ${key.name})`),
      sql`, `,
    )})`,
  );
}

function signalKeyed(platform: Platform, keys: { visitorId: string; product: string; name: SignalName }[]) {
  return and(
    eq(signal.platform, platform),
    sql`(${signal.visitorId}, ${signal.product}, ${signal.name}) IN (${sql.join(
      keys.map((key) => sql`(${key.visitorId}, ${key.product}, ${key.name})`),
      sql`, `,
    )})`,
  );
}

// What a sent batch writes back to its queue, the same for order steps and signals.
function outcome(
  platform: Platform,
  failure: Failure | null,
  t: Date,
  attempts: typeof conversion.attempts | typeof signal.attempts,
) {
  if (failure === null) return { status: "sent" as const, error: null, sentAt: new Date(), nextAt: t };
  const error = `${PREFIX[platform]}_${failure}`;
  if (failure === "REJECTED") return { status: "failed" as const, error, nextAt: t };
  return {
    status: sql`CASE WHEN ${attempts} >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END`,
    error,
    nextAt: sql`${t.toISOString()}::timestamptz + interval '1 minute' * (1 << ${attempts})`,
  };
}

// Splits claimed events by the connection that sends them. Each product may have its own account, so one claim can
// become several batches; an event with no connection is skipped and one past the platform's age limit fails.
function route<R, K>(rows: R[], t: Date, of: (row: R) => Routing<K>): Routed<K> {
  const routed: Routed<K> = { skipped: [], stale: [], batches: new Map() };
  for (const row of rows) {
    const { key, at, send } = of(row);
    if (!at) routed.stale.push(key);
    else if (!send) routed.skipped.push(key);
    else if (at < addSeconds(t, -send.sender.maxAge)) routed.stale.push(key);
    else routed.batches.set(send.sender, [...(routed.batches.get(send.sender) ?? []), { key, event: send.event() }]);
  }
  return routed;
}

async function settle<K>(
  platform: Platform,
  routed: Routed<K>,
  t: Date,
  attempts: typeof conversion.attempts | typeof signal.attempts,
  update: (
    keys: K[],
    set: ReturnType<typeof outcome> | { status: "skipped" | "failed"; error: string },
  ) => Promise<unknown>,
) {
  if (routed.skipped.length)
    await update(routed.skipped, { status: "skipped", error: `${PREFIX[platform]}_NOT_CONFIGURED` });
  if (routed.stale.length) await update(routed.stale, { status: "failed", error: `${PREFIX[platform]}_REJECTED` });

  for (const [sender, pending] of routed.batches) {
    for (let start = 0; start < pending.length; start += sender.batch) {
      const batch = pending.slice(start, start + sender.batch);
      const failure = await sender.send(batch.map((entry) => entry.event));

      if (failure !== "REJECTED" || batch.length === 1) {
        await update(
          batch.map((entry) => entry.key),
          outcome(platform, failure, t, attempts),
        );
        continue;
      }
      // A platform rejects the whole batch for one malformed event: sent alone, each event gets its own answer.
      for (const entry of batch)
        await update([entry.key], outcome(platform, await sender.send([entry.event]), t, attempts));
    }
  }
}

// The one sender for every ad platform event, run by the background loop.
export async function sendConversions() {
  const t = new Date();
  for (const platform of PLATFORMS) {
    await sendSales(platform, t);
    await sendVisits(platform, t);
  }
}

async function sendSales(platform: Platform, t: Date) {
  const queued = and(eq(conversion.platform, platform), eq(conversion.status, "queued"), lte(conversion.nextAt, t));

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
      ttp: order.ttp,
      gaClient: order.gaClient,
      gaSession: order.gaSession,
      email: customer.email,
      domain: product.domain,
      // A sale happened when the money arrived and a refund when it left; other steps when the order was placed.
      at: sql<Date>`COALESCE((SELECT CASE ${conversion.name} WHEN 'Purchase' THEN MIN(${payment.createdAt}) FILTER (WHERE ${payment.amount} > 0) WHEN 'Refund' THEN MAX(${payment.createdAt}) FILTER (WHERE ${payment.amount} < 0) END FROM ${payment} WHERE ${payment.orderId} = ${order.id}), ${order.createdAt})`.mapWith(
        order.createdAt,
      ),
    })
    .from(conversion)
    .innerJoin(order, eq(order.id, conversion.orderId))
    .innerJoin(customer, eq(customer.id, order.customerId))
    .innerJoin(product, eq(product.slug, order.product))
    .where(conversionKeyed(platform, claimed));

  const [connected, clicks] = await Promise.all([
    accounts(rows.map((row) => row.product)),
    latestClicks(rows.flatMap((row) => (row.visitorId ? [row.visitorId] : []))),
  ]);

  const routed = route(rows, t, (row) => {
    const sender = connected(platform, row.product);

    return {
      key: { orderId: row.orderId, name: row.name },
      at: row.at,
      send: sender && {
        sender,
        event: () =>
          sender.sale({
            ...row,
            url: `${siteOf(row)}/c/${row.product}`,
            clicks: (row.visitorId && clicks.get(row.visitorId)) || {},
          }),
      },
    };
  });

  await settle(platform, routed, t, conversion.attempts, (keys, set) =>
    db().update(conversion).set(set).where(conversionKeyed(platform, keys)),
  );
}

async function sendVisits(platform: Platform, t: Date) {
  const queued = and(eq(signal.platform, platform), eq(signal.status, "queued"), lte(signal.nextAt, t));

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
      eventId: signal.eventId,
      ip: signal.ip,
      userAgent: signal.userAgent,
      fbp: signal.fbp,
      fbc: signal.fbc,
      ttp: signal.ttp,
      createdAt: signal.createdAt,
    });

  if (claimed.length === 0) return;
  const slugs = [...new Set(claimed.map((row) => row.product))];

  const [offers, connected, clicks] = await Promise.all([
    db()
      .select({
        slug: product.slug,
        price: product.priceCents,
        vsl: sql<boolean>`${product.vslVideo} IS NOT NULL`,
        domain: product.domain,
      })
      .from(product)
      .where(inArray(product.slug, slugs)),
    accounts(slugs),
    latestClicks(claimed.map((row) => row.visitorId)),
  ]);

  const bySlug = new Map(offers.map((offer) => [offer.slug, offer]));

  const routed = route(claimed, t, (row) => {
    const offer = bySlug.get(row.product);
    const sender = connected(platform, row.product);
    const visit = sender?.visit;

    return {
      key: { visitorId: row.visitorId, product: row.product, name: row.name },
      // A product deleted since the visit has no page left to report.
      at: offer ? row.createdAt : undefined,
      send: sender &&
        visit &&
        offer && {
          sender,
          event: () =>
            visit({
              ...row,
              // Rows queued before the browser sent an id keep the id the server always gave them.
              eventId: row.eventId ?? `${row.visitorId}:${row.product}:${row.name}`,
              at: row.createdAt,
              url: `${siteOf(offer)}/${row.name === "ViewContent" && offer.vsl ? "v" : "c"}/${row.product}`,
              price: offer.price,
              clicks: clicks.get(row.visitorId) ?? {},
            }),
        },
    };
  });

  await settle(platform, routed, t, signal.attempts, (keys, set) =>
    db().update(signal).set(set).where(signalKeyed(platform, keys)),
  );
}

export async function testConversions<P extends Platform>(
  platform: P,
): Promise<`${(typeof PREFIX)[P]}_${Failure | "NOT_CONFIGURED"}` | null> {
  const sender = (await accounts([]))(platform, "");
  if (!sender) return `${PREFIX[platform]}_NOT_CONFIGURED`;
  const failure = await sender.test();
  return failure && `${PREFIX[platform]}_${failure}`;
}
