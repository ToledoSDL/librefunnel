import "server-only";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { demoMode, seal, unseal } from "../guard";
import { conversion, productTracking, signal } from "../schema";
import { credentials, settings } from "../settings";
import type { Credentials } from "../settings";
import { analytics } from "./analytics";
import type { Destination, Failure, Platform, Sale, Visit } from "./conversions";
import { googleAds, redirectUri } from "./googleads";
import { meta } from "./meta";
import { tiktok } from "./tiktok";

// One platform's connection, ready to send: the store's, or a product's own where it set one.
export type Sender = {
  maxAge: number;
  batch: number;
  sale: (row: Sale) => object;
  visit?: (row: Visit) => object;
  send: (events: object[]) => Promise<Failure | null>;
  test: () => Promise<Failure | null>;
};

export type Accounts = (platform: Platform, product: string) => Sender | undefined;

// The field that turns a product's own account on for each platform.
const MAIN = {
  meta: "pixelId",
  tiktok: "pixelCode",
  analytics: "measurementId",
  googleads: "actionId",
} as const satisfies Record<Platform, string>;

type Own = { fields: Record<string, string>; secrets: Record<string, string> };

function context(product: string, platform: Platform, name: string) {
  return `product.${product}.${platform}.${name}`;
}

// The product's own value where it has one, the store's otherwise.
function reader<K extends Platform>(store: Credentials<K>, own: Own | undefined, product: string, platform: K) {
  const read: Credentials<K> = (name) => {
    const sealed = own?.secrets[name];
    const value = own?.fields[name] || (sealed ? (unseal(sealed, context(product, platform, name)) ?? "") : "");
    return value || store(name);
  };

  return read;
}

function bind<C, K extends Platform>(destination: Destination<C, K>, read: Credentials<K>): Sender | undefined {
  const config = destination.config(read);
  if (config === undefined) return undefined;

  return {
    ...destination,
    send: (events) => destination.send(config, events),
    test: () => destination.test(config),
  };
}

// Read per batch from the panel's settings, so a saved change applies to the next batch. Products that share the store's
// connection share one sender, so their events go in one batch.
export async function accounts(products: string[]): Promise<Accounts> {
  if (demoMode()) return () => undefined;
  const slugs = [...new Set(products)];

  const [store, rows] = await Promise.all([
    credentials("meta", "tiktok", "analytics", "googleads"),
    slugs.length
      ? db()
          .select({
            product: productTracking.product,
            platform: productTracking.platform,
            fields: productTracking.fields,
            secrets: productTracking.secrets,
          })
          .from(productTracking)
          .where(inArray(productTracking.product, slugs))
      : [],
  ]);

  const own = new Map(rows.map((row) => [`${row.product}:${row.platform}`, row]));
  const senders = new Map<string, Sender | undefined>();

  const build = (platform: Platform, product: string, row: Own | undefined) => {
    if (platform === "meta") return bind(meta, reader(store("meta"), row, product, "meta"));
    if (platform === "tiktok") return bind(tiktok, reader(store("tiktok"), row, product, "tiktok"));
    if (platform === "analytics") return bind(analytics, reader(store("analytics"), row, product, "analytics"));
    return bind(googleAds, reader(store("googleads"), row, product, "googleads"));
  };

  return (platform, product) => {
    const row = own.get(`${product}:${platform}`);
    const key = row ? `${product}:${platform}` : platform;
    if (!senders.has(key)) senders.set(key, build(platform, product, row));
    return senders.get(key);
  };
}

// What the buyer pages load in the browser: only the tags the seller turned on, with the product's own ids where it has
// them, never in the demo.
export async function browserTags(product: string) {
  if (demoMode()) return {};

  const [store, own] = await Promise.all([
    credentials("meta", "tiktok", "analytics", "googleads"),
    product ? productAccounts(product) : undefined,
  ]);

  const pick = (platform: Platform, name: string, fallback: string) => own?.[platform]?.fields[name] || fallback;
  const pixel = store("meta")("pixel") === "1" ? pick("meta", "pixelId", store("meta")("pixelId")) : "";
  const tiktokPixel = store("tiktok")("pixel") === "1" ? pick("tiktok", "pixelCode", store("tiktok")("pixelCode")) : "";
  const measurement = pick("analytics", "measurementId", store("analytics")("measurementId"));
  const google = [store("analytics")("tag") === "1" ? measurement : "", store("googleads")("tagId")].filter(Boolean);

  return {
    meta: pixel || undefined,
    tiktok: tiktokPixel || undefined,
    google: google.length ? google : undefined,
  };
}

// Everything the Anúncios cards show. Secrets only come out as "is set" flags; refused counts the events each platform
// turned down in the last 7 days, so the seller sees a broken connection without opening anything.
export async function adConnections() {
  const since = new Date(Date.now() - 7 * 86400_000);

  const refusedIn = (table: typeof conversion | typeof signal) =>
    db()
      .select({ platform: table.platform, count: count() })
      .from(table)
      .where(and(eq(table.status, "failed"), gte(table.nextAt, since)))
      .groupBy(table.platform);

  const [stored, store, sales, visits] = await Promise.all([
    credentials("meta", "tiktok", "analytics", "googleads"),
    settings(),
    refusedIn(conversion),
    refusedIn(signal),
  ]);

  const refused = (platform: Platform) =>
    [...sales, ...visits].filter((row) => row.platform === platform).reduce((sum, row) => sum + row.count, 0);

  const metaRead = stored("meta");
  const tiktokRead = stored("tiktok");
  const analyticsRead = stored("analytics");
  const ads = stored("googleads");

  return {
    meta: {
      configured: metaRead("pixelId") !== "" && metaRead("token") !== "",
      pixelId: metaRead("pixelId"),
      testEventCode: metaRead("testEventCode"),
      tokenSet: metaRead("token") !== "",
      pixel: metaRead("pixel") === "1",
      refused: refused("meta"),
    },
    tiktok: {
      configured: tiktokRead("pixelCode") !== "" && tiktokRead("token") !== "",
      pixelCode: tiktokRead("pixelCode"),
      testEventCode: tiktokRead("testEventCode"),
      tokenSet: tiktokRead("token") !== "",
      pixel: tiktokRead("pixel") === "1",
      refused: refused("tiktok"),
    },
    analytics: {
      configured: analyticsRead("measurementId") !== "" && analyticsRead("apiSecret") !== "",
      measurementId: analyticsRead("measurementId"),
      apiSecretSet: analyticsRead("apiSecret") !== "",
      tag: analyticsRead("tag") === "1",
      refused: refused("analytics"),
    },
    googleAds: {
      configured: ads("customerId") !== "" && ads("actionId") !== "" && ads("refreshToken") !== "",
      saved: ads("clientId") !== "" && ads("clientSecret") !== "",
      authorized: ads("refreshToken") !== "",
      clientId: ads("clientId"),
      clientSecretSet: ads("clientSecret") !== "",
      customerId: ads("customerId"),
      loginCustomerId: ads("loginCustomerId"),
      actionId: ads("actionId"),
      tagId: ads("tagId"),
      redirectUri: redirectUri(),
      refused: refused("googleads"),
    },
    verification: { google: store.googleVerification.join("\n"), meta: store.metaVerification ?? "" },
  };
}

// A product's own accounts, secrets only as "is set" flags for the panel.
export async function productAccounts(product: string): Promise<Partial<Record<Platform, Own>>> {
  const rows = await db()
    .select({ platform: productTracking.platform, fields: productTracking.fields, secrets: productTracking.secrets })
    .from(productTracking)
    .where(eq(productTracking.product, product));

  return Object.fromEntries(rows.map((row) => [row.platform, { fields: row.fields, secrets: row.secrets }]));
}

// Each platform's main field turns the product's own account on; clearing it removes the row, secrets included.
// A blank secret keeps the stored one.
export async function saveProductAccount(
  product: string,
  platform: Platform,
  fields: Record<string, string>,
  secrets: Record<string, string>,
) {
  if (!fields[MAIN[platform]]) {
    await db()
      .delete(productTracking)
      .where(and(eq(productTracking.product, product), eq(productTracking.platform, platform)));
    return;
  }

  const sealed = Object.fromEntries(
    Object.entries(secrets).flatMap(([name, value]) =>
      value ? [[name, seal(value, context(product, platform, name))]] : [],
    ),
  );

  await db()
    .insert(productTracking)
    .values({ product, platform, fields, secrets: sealed, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [productTracking.product, productTracking.platform],
      set: {
        fields: sql`excluded.fields`,
        secrets: sql`${productTracking.secrets} || excluded.secrets`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
