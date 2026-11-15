import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi, setSystemTime } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { saveMeta, testConnection } from "@/lib/actions";
import { removeCredentials, saveCredentials } from "@/lib/catalog";
import { db, one } from "@/lib/db";
import { sources } from "@/lib/dashboard";
import { conversion, customer, event, order, signal, touch } from "@/lib/schema";
import { sendConversions } from "@/lib/tracking";
import { POST as trackRoute } from "@/app/t/route";
import { cookieOptions, cookieStore, fakeServer, form, freshBrowser, redirectFetch } from "./fakes";
import { buy, pay, signInAsAdmin } from "./flows";

let ip = 0;

beforeEach(() => {
  ip += 1;
  freshBrowser(`203.0.113.${ip}`);
  setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
});

function hit(body: object | string) {
  return trackRoute(
    new Request("https://shop.example/t", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "x-forwarded-for": `203.0.113.${ip}` },
    }),
  );
}

function conversionOf(id: string) {
  return db()
    .select({
      status: conversion.status,
      error: conversion.error,
      attempts: conversion.attempts,
      nextAt: conversion.nextAt,
    })
    .from(conversion)
    .where(eq(conversion.orderId, id))
    .then(one);
}

function view(search: string, referrer = "") {
  return hit({ e: "page_view", p: "bolo-no-pote", q: search, r: referrer, l: "/v/bolo-no-pote" });
}

describe("/t", () => {
  test("sets a server visitor cookie and records milestones once", async () => {
    expect((await view("")).status).toBe(204);
    const visitor = cookieStore.get("lf_vid") ?? "";
    expect(visitor).toMatch(/^[a-z0-9]{20}$/);
    expect(cookieOptions.get("lf_vid")).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 400 * 86400 });
    await hit({ e: "cta_click", p: "bolo-no-pote" });
    await hit({ e: "cta_click", p: "bolo-no-pote" });
    expect(await db().$count(event, eq(event.visitorId, visitor))).toBe(2);
  });

  test("adds each visitor's watched seconds, replays included, and the page cannot set them directly", async () => {
    await view("");
    const visitor = cookieStore.get("lf_vid") ?? "";
    await hit({ e: "retention", p: "bolo-no-pote", s: [0, 1, 2, 2, 3] });
    await hit({ e: "retention", p: "bolo-no-pote", s: [0, 1] });
    expect((await hit({ e: "video_watch", p: "bolo-no-pote" })).status).toBe(400);

    const [watched] = await db()
      .select({ value: event.value })
      .from(event)
      .where(and(eq(event.visitorId, visitor), eq(event.name, "video_watch")));

    expect(watched?.value).toBe(6);
  });

  test("rejects unknown events, sale events, unknown products and oversized bodies", async () => {
    for (const e of ["checkout", "purchase", "sale", "lead"]) expect((await hit({ e, p: "" })).status).toBe(400);
    expect((await hit({ e: "page_view", p: "made-up" })).status).toBe(400);
    expect((await hit("[]")).status).toBe(400);
    expect((await hit({ e: "page_view", p: "", q: "x".repeat(3000) })).status).toBe(413);
  });

  test("replaces a malformed visitor cookie instead of trusting it", async () => {
    cookieStore.set("lf_vid", "x' or 1=1 --");
    await view("");
    expect(cookieStore.get("lf_vid")).toMatch(/^[a-z0-9]{20}$/);
  });

  test("requests that keep dropping the cookie stop creating visitors", async () => {
    for (let index = 0; index < 600; index += 1) {
      freshBrowser(`203.0.113.${ip}`);
      setSystemTime(new Date(Date.UTC(2026, 10, 14, 15, 0, index)));
      await view("");
    }
    const before = await db().$count(event);
    freshBrowser(`203.0.113.${ip}`);
    expect((await view("")).status).toBe(204);
    expect(await db().$count(event)).toBe(before);
  });

  test("is rate limited per visitor", async () => {
    await view("");
    const statuses = [];
    for (let index = 0; index < 121; index += 1) statuses.push((await hit({ e: "page_view", p: "" })).status);
    expect(statuses.at(-2)).toBe(204);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("attribution", () => {
  test("first and last touch, repeated ad clicks only move last_seen, touches after the order are ignored", async () => {
    setSystemTime(new Date("2026-11-14T10:00:00-03:00"));
    await view("?utm_source=facebook&utm_campaign=a&fbclid=ClickA");
    setSystemTime(new Date("2026-11-14T10:30:00-03:00"));
    await view("?utm_source=facebook&utm_campaign=a&fbclid=ClickA");
    setSystemTime(new Date("2026-11-14T11:00:00-03:00"));
    await view("?utm_source=google&utm_campaign=b", "https://www.google.com/search?q=x");
    await view("", "https://shop.example/v/bolo-no-pote");
    const visitor = cookieStore.get("lf_vid") ?? "";

    const touches = await db()
      .select({ source: touch.source, firstSeenAt: touch.firstSeenAt, lastSeenAt: touch.lastSeenAt })
      .from(touch)
      .where(eq(touch.visitorId, visitor))
      .orderBy(asc(touch.firstSeenAt));

    expect(touches).toEqual([
      {
        source: "facebook",
        firstSeenAt: new Date("2026-11-14T10:00:00-03:00"),
        lastSeenAt: new Date("2026-11-14T10:30:00-03:00"),
      },
      {
        source: "google",
        firstSeenAt: new Date("2026-11-14T11:00:00-03:00"),
        lastSeenAt: new Date("2026-11-14T11:00:00-03:00"),
      },
    ]);
    setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    const order = await buy({ email: "attribution@example.com" });
    await pay(order);
    setSystemTime(new Date("2026-11-14T13:00:00-03:00"));
    await view("?utm_source=tiktok&utm_campaign=c");
    const last = await sources(7, "last");
    expect(last).toContainEqual({ source: "google", campaign: "b", orders: 1, revenue: 9700 });
    expect(await sources(7, "first")).toContainEqual({ source: "facebook", campaign: "a", orders: 1, revenue: 9700 });
    expect(last.some((row) => row.source === "tiktok")).toBe(false);
  });

  test("UTMs on a direct checkout link reach the order even without the tracker", async () => {
    await buy({ email: "direct@example.com", touch: "?utm_source=instagram&utm_campaign=bio" });

    const direct = one(
      await db()
        .select({ id: order.id })
        .from(order)
        .innerJoin(customer, eq(customer.id, order.customerId))
        .where(eq(customer.email, "direct@example.com")),
    );

    await pay(direct.id);
    expect(await sources(7, "last")).toContainEqual({ source: "instagram", campaign: "bio", orders: 1, revenue: 9700 });
  });
});

describe("Meta Conversions API", () => {
  let server: Awaited<ReturnType<typeof fakeServer>>;

  beforeEach(async () => {
    server = await fakeServer({
      "POST /v27.0/123/events": { status: 200, body: { events_received: 2, messages: [], fbtrace_id: "t" } },
    });
    await saveCredentials("meta", { pixelId: "123", testEventCode: "" }, { token: "token-meta" });
    redirectFetch("https://graph.facebook.com", server.url);
    await db().update(conversion).set({ status: "skipped" }).where(eq(conversion.status, "queued"));
    await db().update(signal).set({ status: "skipped" }).where(eq(signal.status, "queued"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeCredentials("meta");
    await server.close();
  });

  test("sends hashed identity, order IP/UA and fbc from the last fbclid click, deduplicated by event id", async () => {
    setSystemTime(new Date("2026-11-14T11:00:00-03:00"));
    await view("?utm_source=facebook&fbclid=AbC123");
    setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    cookieStore.set("_fbp", "fb.1.1731600000000.123456789");
    const order = await buy({ email: "capi@example.com", name: "Maria José da Silva", bump: "1" });
    await pay(order, 9700 + 1990);
    await Promise.all([sendConversions(), sendConversions()]);
    // One batch for the order steps, one for the sales page view.
    expect(server.to("POST", "/v27.0/123/events").length).toBe(2);
    const request = server.to("POST", "/v27.0/123/events").find((sent) => sent.body.includes("Purchase"));
    const body = JSON.parse(request?.body ?? "{}");
    expect(body.data.map((sent: { event_name: string }) => sent.event_name)).toEqual(["AddPaymentInfo", "Purchase"]);
    expect(request?.body).not.toContain("capi@example.com");
    expect(body.access_token).toBe("token-meta");
    const purchase = body.data.find((event: { event_name: string }) => event.event_name === "Purchase");
    expect(purchase.event_id).toBe(`${order}:Purchase`);
    expect(purchase.user_data.em).toEqual([createHash("sha256").update("capi@example.com").digest("hex")]);
    expect(purchase.user_data.fn).toEqual([createHash("sha256").update("maria").digest("hex")]);
    expect(purchase.user_data.client_ip_address).toBe(`203.0.113.${ip}`);
    expect(purchase.user_data.fbp).toBe("fb.1.1731600000000.123456789");
    expect(purchase.user_data.fbc).toBe(`fb.1.${Date.parse("2026-11-14T11:00:00-03:00")}.AbC123`);
    expect(purchase.custom_data).toMatchObject({
      currency: "BRL",
      value: 116.9,
      content_ids: ["bolo-no-pote", "planilha-preco"],
      num_items: 2,
      order_id: order,
    });
    expect(
      one(
        await db()
          .select({ status: conversion.status })
          .from(conversion)
          .where(and(eq(conversion.orderId, order), eq(conversion.name, "Purchase"))),
      ).status,
    ).toBe("sent");
    await sendConversions();
    expect(server.to("POST", "/v27.0/123/events").length).toBe(2);
  });

  test("the sales page and the checkout send ViewContent and InitiateCheckout once per visitor", async () => {
    setSystemTime(new Date("2026-11-14T11:00:00-03:00"));
    await view("?fbclid=SignalClick");
    const visitor = cookieStore.get("lf_vid") ?? "";
    setSystemTime(new Date("2026-11-14T11:05:00-03:00"));
    await view("");
    await hit({ e: "checkout_view", p: "bolo-no-pote" });
    await hit({ e: "checkout_view", p: "bolo-no-pote" });
    await sendConversions();
    const sent = JSON.parse(server.to("POST", "/v27.0/123/events").at(-1)?.body ?? "{}").data;
    expect(sent.map((item: { event_name: string }) => item.event_name).sort()).toEqual([
      "InitiateCheckout",
      "ViewContent",
    ]);
    const viewed = sent.find((item: { event_name: string }) => item.event_name === "ViewContent");
    expect(viewed).toMatchObject({
      event_id: `${visitor}:bolo-no-pote:ViewContent`,
      event_time: Date.parse("2026-11-14T11:00:00-03:00") / 1000,
      event_source_url: "https://shop.example/v/bolo-no-pote",
      user_data: {
        external_id: [createHash("sha256").update(visitor).digest("hex")],
        client_ip_address: `203.0.113.${ip}`,
        fbc: `fb.1.${Date.parse("2026-11-14T11:00:00-03:00")}.SignalClick`,
      },
      custom_data: { currency: "BRL", value: 97, content_ids: ["bolo-no-pote"] },
    });
  });

  test("without Meta connected, a page view stores no visitor address", async () => {
    await removeCredentials("meta");
    await view("");
    expect(await db().$count(signal, eq(signal.visitorId, cookieStore.get("lf_vid") ?? ""))).toBe(0);
  });

  test("a buyer correcting their details does not send AddPaymentInfo twice", async () => {
    await buy({ email: "fixing@example.com", name: "Ana Souza" });
    await buy({ email: "fixing@example.com", name: "Ana Souza Lima" });

    const steps = await db()
      .select({ name: conversion.name })
      .from(conversion)
      .innerJoin(order, eq(order.id, conversion.orderId))
      .innerJoin(customer, eq(customer.id, order.customerId))
      .where(eq(customer.email, "fixing@example.com"));

    expect(steps).toEqual([{ name: "AddPaymentInfo" }]);
  });

  test("a rejected batch fails without retry and an unconfigured pixel is skipped", async () => {
    server.routes["POST /v27.0/123/events"] = {
      status: 400,
      body: { error: { message: "Invalid parameter", type: "OAuthException", code: 100, fbtrace_id: "abc" } },
    };
    const order = await buy({ email: "rejected@example.com" });
    await sendConversions();
    expect(await conversionOf(order)).toMatchObject({ status: "failed", error: "META_REJECTED" });
    await removeCredentials("meta");
    const other = await buy({ email: "nometa@example.com" });
    await sendConversions();
    expect(await conversionOf(other)).toMatchObject({ status: "skipped", error: "META_NOT_CONFIGURED" });
  });

  test("a rejected batch is sent again one event at a time, so one bad event fails alone", async () => {
    server.routes["POST /v27.0/123/events"] = { status: 400, body: { error: { code: 100, fbtrace_id: "abc" } } };
    const first = await buy({ email: "batch1@example.com" });
    const second = await buy({ email: "batch2@example.com" });
    const before = server.to("POST", "/v27.0/123/events").length;
    await sendConversions();
    const requests = server.to("POST", "/v27.0/123/events").slice(before);
    const batch = JSON.parse(requests[0]?.body ?? "{}").data.length;
    expect(batch).toBeGreaterThan(1);
    expect(requests.slice(1).map((request) => JSON.parse(request.body).data.length)).toEqual(Array(batch).fill(1));
    expect(await conversionOf(first)).toMatchObject({ status: "failed", error: "META_REJECTED" });
    expect(await conversionOf(second)).toMatchObject({ status: "failed", error: "META_REJECTED" });
  });

  test("a rate-limited batch is retried with backoff", async () => {
    server.routes["POST /v27.0/123/events"] = { status: 400, body: { error: { code: 613, fbtrace_id: "abc" } } };
    const order = await buy({ email: "ratelimited@example.com" });
    await sendConversions();
    expect(await conversionOf(order)).toEqual({
      status: "queued",
      error: "META_UNREACHABLE",
      attempts: 1,
      nextAt: new Date("2026-11-14T12:02:00-03:00"),
    });
  });

  test("a pixel saved in the panel applies to the next batch, without a restart", async () => {
    server.routes["POST /v27.0/45678/events"] = {
      status: 200,
      body: { events_received: 1, messages: [], fbtrace_id: "t" },
    };
    await signInAsAdmin();
    expect((await saveMeta({ code: null }, form({ pixelId: "12ab", token: "" }))).code).toBe("INVALID_PIXEL_ID");
    expect(await saveMeta({ code: null }, form({ pixelId: "45678", token: "", testEventCode: "TEST123" }))).toEqual({
      code: null,
      ok: true,
    });
    await buy({ email: "newpixel@example.com" });
    await sendConversions();
    const sent = JSON.parse(server.to("POST", "/v27.0/45678/events")[0]?.body ?? "{}");
    expect(sent).toMatchObject({ access_token: "token-meta", test_event_code: "TEST123" });
    expect(await testConnection({ code: null }, form({ kind: "meta" }))).toEqual({ code: null, ok: true });
  });
});
