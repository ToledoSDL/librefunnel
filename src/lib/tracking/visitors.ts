import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, newId } from "../db";
import { baseUrl, limited, setCookie } from "../guard";
import { ID, parsePrintable } from "../input";
import { touch } from "../schema";

type ClickKind = (typeof touch.$inferSelect)["clickKind"];

export type AdClick = Exclude<ClickKind, "">;

// gbraid and wbraid replace gclid on iOS app and web traffic that Apple's tracking rules cover.
const CLICK_KINDS: AdClick[] = ["fbclid", "gclid", "ttclid", "gbraid", "wbraid"];

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

  const fields = {
    source: value("utm_source"),
    medium: value("utm_medium"),
    campaign: value("utm_campaign"),
    content: value("utm_content"),
    term: value("utm_term"),
    referrerHost: referrerHost(referrer),
  };

  // A link can carry several click ids (gclid with gbraid, or a Meta and a Google id): each is kept, one row per id.
  const clicks = CLICK_KINDS.flatMap((kind) => (click(kind) ? [{ clickKind: kind, clickId: click(kind) }] : []));

  // Each new mix of UTM values is a new row, so one visitor cycling them would grow the table without end.
  if (
    (clicks.length === 0 && Object.values(fields).every((part) => part === "")) ||
    limited("touch", visitorId, TOUCHES_PER_DAY, 86400)
  )
    return;

  const t = new Date();

  const base = {
    visitorId,
    ...fields,
    landing: /^\/[^\s]{0,199}$/.test(landing) ? landing : "/",
    firstSeenAt: t,
    lastSeenAt: t,
  };

  await db()
    .insert(touch)
    .values(clicks.length ? clicks.map((entry) => ({ ...base, ...entry })) : [base])
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

// The latest click id of each kind per visitor, for a batch of events.
export async function latestClicks(visitorIds: string[]): Promise<Map<string, Partial<Record<AdClick, string>>>> {
  const clicks = new Map<string, Partial<Record<AdClick, string>>>();
  if (visitorIds.length === 0) return clicks;

  const rows = await db()
    .selectDistinctOn([touch.visitorId, touch.clickKind], {
      visitorId: touch.visitorId,
      kind: touch.clickKind,
      clickId: touch.clickId,
    })
    .from(touch)
    .where(and(inArray(touch.visitorId, [...new Set(visitorIds)]), ne(touch.clickKind, "")))
    .orderBy(touch.visitorId, touch.clickKind, desc(touch.lastSeenAt));

  for (const row of rows) {
    if (row.kind === "") continue;
    clicks.set(row.visitorId, { ...clicks.get(row.visitorId), [row.kind]: row.clickId });
  }
  return clicks;
}

function cookieMatch(value: string | undefined, pattern: RegExp): string | null {
  return (value && pattern.exec(value)?.[1]) || null;
}

// The ids the ad platforms' browser tags keep in first-party cookies, so server events join the same browser.
export async function browserIds() {
  const jar = await cookies();
  // Google keeps the session in _ga_<property>; a store has one property, so the first one found is it.
  const session = jar.getAll().find((cookie) => cookie.name.startsWith("_ga_"))?.value;

  return {
    fbp: cookieMatch(jar.get("_fbp")?.value, /^(fb\.\d\.\d{10,16}\.\d{1,30})$/),
    fbc: cookieMatch(jar.get("_fbc")?.value, /^(fb\.\d\.\d{10,16}\.[\x21-\x7e]{1,400})$/),
    ttp: cookieMatch(jar.get("_ttp")?.value, /^([\w.-]{1,100})$/),
    gaClient: cookieMatch(jar.get("_ga")?.value, /^GA\d\.\d\.(\d{1,20}\.\d{1,20})$/),
    gaSession: cookieMatch(session, /^GS1\.\d\.(\d{1,20})\./) ?? cookieMatch(session, /^GS2\.\d\.s(\d{1,20})\$/),
  };
}
