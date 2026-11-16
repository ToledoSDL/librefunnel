import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import type { JsonObject } from "../guard";
import { SLUG } from "../input";
import { event, product, retention } from "../schema";
import type { TrackCode } from "./funnel";

const RETENTION_BATCH = 120;

// One statement checks the product is live and counts every second, so concurrent page loads add up without a read.
// The same seconds add to this visitor's watch time, shown next to their conversation in the inbox.
export async function recordRetention(body: JsonObject, visitorId: string): Promise<TrackCode | null> {
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
