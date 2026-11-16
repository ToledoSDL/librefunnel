import "server-only";
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { productNames } from "../catalog/products";
import { db } from "../db";
import { clientIp, hostOf, jsonObject, limited, readBody } from "../guard";
import type { Json, JsonObject } from "../guard";
import { ID } from "../input";
import { event } from "../schema";
import { STEPS } from "@/funnel";
import type { ClientEvent } from "@/funnel";
import { queueSignal } from "./conversions";
import { recordRetention } from "./retention";
import { VISITOR_COOKIE, recordTouch, visitor } from "./visitors";

export type TrackCode = "INVALID_EVENT" | "RATE_LIMITED";

type EventName = (typeof event.$inferSelect)["name"];

// The id the browser tags sent the same event with; one the browser made up of anything else is ignored.
const EVENT_ID = /^[\w-]{8,64}$/;

function isClientEvent(value: Json | undefined): value is ClientEvent {
  return typeof value === "string" && Object.hasOwn(STEPS, value);
}

// The last time, so a period counts everyone who reached the step in it, returning visitors included.
async function recordEvent(visitorId: string, products: string[], name: EventName) {
  if (products.length === 0) return;
  const t = new Date();
  await db()
    .insert(event)
    .values(products.map((slug) => ({ visitorId, product: slug, name, createdAt: t })))
    .onConflictDoUpdate({
      target: [event.visitorId, event.product, event.name],
      set: { createdAt: sql`excluded.created_at` },
    });
}

// The members area reads the cookie the proxy set and never sets one: server components cannot.
export async function recordAccess(products: string[]) {
  const id = (await cookies()).get(VISITOR_COOKIE)?.value ?? "";
  if (ID.test(id)) await recordEvent(id, products, "member_access");
}

// High because mobile carriers put many buyers behind one address.
const NEW_VISITORS_PER_HOUR = 600;

async function track(body: JsonObject, visitorId: string, request: Request): Promise<TrackCode | null> {
  const name = body.e;
  const slug = body.p;
  if (!isClientEvent(name) || typeof slug !== "string" || (slug !== "" && !(await productNames()).has(slug)))
    return "INVALID_EVENT";
  if (name === "page_view") {
    // Moving between the pages of a product's own domain is not a visit from another site.
    const referrer =
      typeof body.r === "string" && URL.parse(body.r)?.hostname !== hostOf(request.headers) ? body.r : "";

    await recordTouch(
      visitorId,
      typeof body.q === "string" ? body.q : "",
      referrer,
      typeof body.l === "string" ? body.l : "/",
    );
  }
  await recordEvent(visitorId, [slug], name);
  const step: { ads?: "ViewContent" | "InitiateCheckout" } = STEPS[name];
  if (!slug || !step.ads) return null;
  const eventId = typeof body.i === "string" && EVENT_ID.test(body.i) ? body.i : `${visitorId}:${slug}:${step.ads}`;
  await queueSignal(step.ads, visitorId, slug, eventId, request);
  return null;
}

export async function trackRequest(request: Request): Promise<Response> {
  const ip = clientIp(request.headers);
  const cookie = (await cookies()).get(VISITOR_COOKIE)?.value ?? "";
  const known = ID.test(cookie);
  // Per visitor, because one mobile carrier address carries many buyers each sending a retention beacon every 10 s.
  if (limited("track", known ? cookie : ip, 120, 60) || limited("track-ip", ip, 3000, 60))
    return Response.json({ code: "RATE_LIMITED" }, { status: 429 });
  const raw = await readBody(request, 2048);
  if (raw === undefined) return Response.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  // Every request without the cookie is a new visitor and new rows: a script dropping it must not fill the disk.
  if (!known && limited("visitor", ip, NEW_VISITORS_PER_HOUR, 3600)) return new Response(null, { status: 204 });
  const body = jsonObject(raw);
  let code: TrackCode | null = "INVALID_EVENT";
  if (body)
    code =
      body.e === "retention"
        ? await recordRetention(body, await visitor())
        : await track(body, await visitor(), request);
  return code ? Response.json({ code }, { status: 400 }) : new Response(null, { status: 204 });
}
