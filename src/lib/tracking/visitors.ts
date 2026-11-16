import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, newId } from "../db";
import { baseUrl, limited, setCookie } from "../guard";
import { ID, parsePrintable } from "../input";
import { touch } from "../schema";

type ClickKind = (typeof touch.$inferSelect)["clickKind"];

const CLICK_KINDS: Exclude<ClickKind, "">[] = ["fbclid", "gclid", "ttclid"];

export const VISITOR_COOKIE = "lf_vid";

const VISITOR_TTL = 400 * 86400;

const TOUCHES_PER_DAY = 20;

export async function visitor(): Promise<string> {
  const current = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (current && ID.test(current)) return current;
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
  const value = (name: string) => parsePrintable(params.get(name) ?? "", 200);
  // Click ids run longer than UTM values; one over the limit would lose the click and its fbc.
  const click = (kind: string) => parsePrintable(params.get(kind) ?? "", 500);
  const clickKind: ClickKind = CLICK_KINDS.find((kind) => click(kind) !== "") ?? "";

  const fields = {
    source: value("utm_source"),
    medium: value("utm_medium"),
    campaign: value("utm_campaign"),
    content: value("utm_content"),
    term: value("utm_term"),
    clickKind,
    clickId: clickKind ? click(clickKind) : "",
    referrerHost: referrerHost(referrer),
  };

  // Each new mix of UTM values is a new row, so one visitor cycling them would grow the table without end.
  if (Object.values(fields).every((part) => part === "") || limited("touch", visitorId, TOUCHES_PER_DAY, 86400)) return;
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
  // The latest click, stamped with when it was first seen: later visits store the same click id again.
  const [click] = await db()
    .select({ clickId: touch.clickId, firstSeenAt: sql<Date>`MIN(${touch.firstSeenAt})`.mapWith(touch.firstSeenAt) })
    .from(touch)
    .where(and(eq(touch.visitorId, visitorId), eq(touch.clickKind, "fbclid")))
    .groupBy(touch.clickId)
    .orderBy(desc(sql`MAX(${touch.lastSeenAt})`))
    .limit(1);

  return click ? `fb.1.${click.firstSeenAt.getTime()}.${click.clickId}` : null;
}

export function metaCookie(value: string | undefined, name: "_fbp" | "_fbc"): string | null {
  const pattern = name === "_fbp" ? /^fb\.\d\.\d{10,16}\.\d{1,30}$/ : /^fb\.\d\.\d{10,16}\.[\x21-\x7e]{1,400}$/;
  return value && pattern.test(value) ? value : null;
}
