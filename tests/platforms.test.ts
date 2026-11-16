import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi, setSystemTime } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  connectGoogle,
  saveAnalytics,
  saveGoogleAds,
  saveMeta,
  saveProductAds,
  saveTikTok,
  saveVerification,
} from "@/lib/actions/ads";
import { testConnection } from "@/lib/actions/connections";
import { db } from "@/lib/db";
import { refundOrder } from "@/lib/orders/payments";
import { conversion, productTracking, signal } from "@/lib/schema";
import { credentials, removeCredentials, saveCredentials, settings } from "@/lib/settings";
import { adConnections, browserTags } from "@/lib/tracking/accounts";
import { sendConversions } from "@/lib/tracking/conversions";
import { latestClicks } from "@/lib/tracking/visitors";
import { GET as googleCallback } from "@/app/api/google/callback/route";
import { POST as trackRoute } from "@/app/t/route";
import { cookieStore, fakeServer, form, freshBrowser, redirectFetch, redirected } from "./fakes";
import { buy, pay, signInAsAdmin, webhook } from "./flows";

const HOSTS =
  /^https:\/\/(graph\.facebook\.com|business-api\.tiktok\.com|www\.google-analytics\.com|oauth2\.googleapis\.com|datamanager\.googleapis\.com)/;

const TIKTOK = "/open_api/v1.3/event/track/";
const INGEST = "/v1/events:ingest";

let ip = 0;
let server: Awaited<ReturnType<typeof fakeServer>>;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function view(search: string, eventId?: string) {
  return trackRoute(
    new Request("https://shop.example/t", {
      method: "POST",
      body: JSON.stringify({ e: "page_view", p: "bolo-no-pote", q: search, r: "", l: "/v/bolo-no-pote", i: eventId }),
      headers: { "x-forwarded-for": `203.0.113.${ip}` },
    }),
  );
}

function sent(path: string) {
  return server.to("POST", path).map((request) => JSON.parse(request.body));
}

function statusOf(order: string, platform: "meta" | "tiktok" | "analytics" | "googleads", name = "Purchase") {
  return db()
    .select({ status: conversion.status, error: conversion.error })
    .from(conversion)
    .where(
      and(
        eq(conversion.orderId, order),
        eq(conversion.platform, platform),
        eq(conversion.name, name === "Refund" ? "Refund" : "Purchase"),
      ),
    )
    .then((rows) => rows[0]);
}

async function connectGoogleAds() {
  await saveCredentials(
    "googleads",
    {
      clientId: "1234567890-abcdef.apps.googleusercontent.com",
      customerId: "1234567890",
      loginCustomerId: "",
      actionId: "555",
    },
    { clientSecret: "client-secret", refreshToken: "refresh-1" },
  );
}

beforeEach(async () => {
  ip += 1;
  freshBrowser(`203.0.113.${ip}`);
  setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
  server = await fakeServer({
    "POST /v27.0/123/events": { status: 200, body: { events_received: 1 } },
    [`POST ${TIKTOK}`]: { status: 200, body: { code: 0, message: "OK" } },
    "POST /mp/collect": { status: 204, body: "" },
    "POST /debug/mp/collect": { status: 200, body: { validationMessages: [] } },
    "POST /token": { status: 200, body: { access_token: "access-1", expires_in: 3599 } },
    [`POST ${INGEST}`]: { status: 200, body: { requestId: "r1" } },
  });
  redirectFetch(HOSTS, server.url);
  // Rows other suites left queued would otherwise go out in these batches.
  await db().update(conversion).set({ status: "skipped" }).where(eq(conversion.status, "queued"));
  await db().update(signal).set({ status: "skipped" }).where(eq(signal.status, "queued"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const kind of ["meta", "tiktok", "analytics", "googleads"] as const) await removeCredentials(kind);
  await db().delete(productTracking);
  await server.close();
});

describe("TikTok Events API", () => {
  test("sends the sale with hashed contact, the ad click and the order id as event id", async () => {
    await saveCredentials("tiktok", { pixelCode: "C4TESTPIXEL0001", testEventCode: "" }, { token: "tt-token" });
    await view("?utm_source=tiktok&ttclid=TT.click-1");
    cookieStore.set("_ttp", "ttp-browser-1");
    const order = await buy({ email: "tiktok@example.com", phone: "(48) 99999-0000" });
    await pay(order);
    await sendConversions();

    const purchase = sent(TIKTOK)
      .flatMap((body) => body.data)
      .find((event) => event.event === "Purchase");

    expect(server.to("POST", TIKTOK)[0]?.headers["access-token"]).toBe("tt-token");
    expect(purchase).toMatchObject({
      event_id: `${order}:Purchase`,
      user: {
        email: hash("tiktok@example.com"),
        phone: hash("+5548999990000"),
        ttclid: "TT.click-1",
        ttp: "ttp-browser-1",
        ip: `203.0.113.${ip}`,
      },
      properties: { currency: "BRL", value: 97, order_id: order },
    });
    expect(JSON.stringify(sent(TIKTOK))).not.toContain("tiktok@example.com");
    expect(await statusOf(order, "tiktok")).toEqual({ status: "sent", error: null });
  });

  test("a page view goes out with the id the browser pixel used, so TikTok counts it once", async () => {
    await saveCredentials("tiktok", { pixelCode: "C4TESTPIXEL0001", testEventCode: "" }, { token: "tt-token" });
    await view("", "3f1c2a4e-1b2c-4d5e-8f90-123456789abc");
    await sendConversions();
    const viewed = sent(TIKTOK)[0]?.data[0];
    expect(viewed).toMatchObject({ event: "ViewContent", event_id: "3f1c2a4e-1b2c-4d5e-8f90-123456789abc" });
  });

  test("a rate limit is retried and a refused token fails", async () => {
    await saveCredentials("tiktok", { pixelCode: "C4TESTPIXEL0001", testEventCode: "" }, { token: "tt-token" });
    server.routes[`POST ${TIKTOK}`] = { status: 200, body: { code: 40100, message: "Too many requests" } };
    const first = await buy({ email: "tt-busy@example.com" });
    await pay(first);
    await sendConversions();
    expect(await statusOf(first, "tiktok")).toEqual({ status: "queued", error: "TIKTOK_UNREACHABLE" });
    server.routes[`POST ${TIKTOK}`] = { status: 200, body: { code: 40001, message: "Invalid access token" } };
    setSystemTime(new Date("2026-11-14T12:10:00-03:00"));
    await sendConversions();
    expect(await statusOf(first, "tiktok")).toEqual({ status: "failed", error: "TIKTOK_REJECTED" });
  });
});

describe("Google Analytics", () => {
  test("the sale joins the Google tag's visit, and a refund is reported once", async () => {
    await saveCredentials("analytics", { measurementId: "G-TEST1234", tag: "1" }, { apiSecret: "ga-secret" });
    cookieStore.set("_ga", "GA1.1.1111111111.1731600000");
    cookieStore.set("_ga_TEST1234", "GS2.1.s1731590000$o3$g1$t1731590100$j0$l0$h0");
    const order = await buy({ email: "Maria.Silva@Gmail.com" });
    await pay(order);
    await sendConversions();

    const [purchase] = sent("/mp/collect");
    expect(server.to("POST", "/mp/collect")[0]?.path).toContain("api_secret=ga-secret");
    expect(purchase).toMatchObject({
      client_id: "1111111111.1731600000",
      user_data: { sha256_email_address: [hash("mariasilva@gmail.com")] },
      events: [{ name: "purchase", params: { transaction_id: order, value: 97, session_id: "1731590000" } }],
    });

    expect(await refundOrder(order)).toBeNull();
    // The MED for the same Pix after the refund debits nothing new and reports nothing new.
    await webhook({ order, status: "refunded", amount: 9700, id: `med-${order}` });
    await sendConversions();
    const refunds = sent("/mp/collect").filter((body) => body.events[0].name === "refund");
    expect(refunds.length).toBe(1);
    expect(refunds[0].events[0].params).toMatchObject({ transaction_id: order, value: 97 });
  });

  test("without the Google tag, the sale still goes out under the store's own visitor id", async () => {
    await saveCredentials("analytics", { measurementId: "G-TEST1234", tag: "" }, { apiSecret: "ga-secret" });
    await view("");
    const visitor = cookieStore.get("lf_vid");
    const order = await buy({ email: "notag@example.com" });
    await pay(order);
    await sendConversions();
    expect(sent("/mp/collect")[0]?.client_id).toBe(visitor);
  });

  test("a sale older than 72 hours is not backdated past Google's limit", async () => {
    const order = await buy({ email: "late@example.com" });
    await pay(order);
    setSystemTime(new Date("2026-11-18T12:00:00-03:00"));
    await saveCredentials("analytics", { measurementId: "G-TEST1234", tag: "" }, { apiSecret: "ga-secret" });
    await sendConversions();
    expect(server.to("POST", "/mp/collect").length).toBe(0);
    expect(await statusOf(order, "analytics")).toEqual({ status: "failed", error: "ANALYTICS_REJECTED" });
  });
});

describe("Google Ads", () => {
  test("saving the OAuth client opens Google's login, and only the state it issued finishes it, once", async () => {
    await signInAsAdmin();

    const to = await redirected(
      saveGoogleAds(
        { code: null },
        form({
          clientId: "1234567890-abcdef.apps.googleusercontent.com",
          clientSecret: "client-secret",
          customerId: "123-456-7890",
          actionId: "555",
        }),
      ),
    );

    const login = new URL(to);
    expect(login.origin).toBe("https://accounts.google.com");
    expect(login.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/datamanager");
    expect(login.searchParams.get("redirect_uri")).toBe("https://shop.example/api/google/callback");
    const state = login.searchParams.get("state") ?? "";
    server.routes["POST /token"] = { status: 200, body: { access_token: "a", refresh_token: "refresh-new" } };

    const callback = (query: string) =>
      googleCallback(new Request(`https://shop.example/api/google/callback?${query}`));

    expect((await callback(`code=c1&state=forged`)).status).toBe(400);
    expect((await callback(`code=c1&state=${state}`)).status).toBe(200);
    expect((await callback(`code=c2&state=${state}`)).status).toBe(400);
    const exchanges = server.to("POST", "/token").filter((sent) => sent.body.includes("grant_type=authorization_code"));
    expect(exchanges.length).toBe(1);
    expect((await credentials("googleads"))("googleads")("refreshToken")).toBe("refresh-new");
    // Coming back from Google tests the connection at once, without recording a conversion.
    expect(sent(INGEST).map((body) => body.validateOnly)).toEqual([true]);
  });

  test("an expired login state is refused", async () => {
    await signInAsAdmin();
    await connectGoogleAds();
    const login = new URL(await redirected(connectGoogle()));
    setSystemTime(new Date("2026-11-14T12:11:00-03:00"));

    const response = await googleCallback(
      new Request(`https://shop.example/api/google/callback?code=c&state=${login.searchParams.get("state")}`),
    );

    expect(response.status).toBe(400);
    expect(server.to("POST", "/token").length).toBe(0);
  });

  test("sends the sale with the gclid and hashed e-mail to the conversion action, through the Data Manager API", async () => {
    await connectGoogleAds();
    await view("?gclid=Cj0Click");
    const order = await buy({ email: "ads@example.com" });
    await pay(order);
    await sendConversions();

    const request = server.to("POST", INGEST)[0];
    const body = JSON.parse(request?.body ?? "{}");
    expect(request?.headers.authorization).toBe("Bearer access-1");
    expect(server.to("POST", "/token")[0]?.body).toContain("refresh_token=refresh-1");
    expect(body).toMatchObject({
      destinations: [
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
          loginAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
          productDestinationId: "555",
        },
      ],
      encoding: "HEX",
      validateOnly: false,
      events: [
        {
          adIdentifiers: { gclid: "Cj0Click" },
          transactionId: order,
          conversionValue: 97,
          currency: "BRL",
          userData: {
            userIdentifiers: [{ emailAddress: hash("ads@example.com") }, { phoneNumber: hash("+5548999990000") }],
          },
        },
      ],
    });
    expect(await statusOf(order, "googleads")).toEqual({ status: "sent", error: null });
  });

  test("an iOS click (gbraid) stands in for the missing gclid", async () => {
    await connectGoogleAds();
    await view("?gbraid=0AAAABraid");
    const order = await buy({ email: "ios@example.com" });
    await pay(order);
    await sendConversions();
    expect(sent(INGEST)[0]?.events[0].adIdentifiers).toEqual({ gbraid: "0AAAABraid" });
  });

  test("a revoked login fails the sale with a reason, and the test checks without recording", async () => {
    await connectGoogleAds();
    server.routes["POST /token"] = { status: 400, body: { error: "invalid_grant" } };
    const order = await buy({ email: "revoked@example.com" });
    await pay(order);
    await sendConversions();
    expect(server.to("POST", INGEST).length).toBe(0);
    expect(await statusOf(order, "googleads")).toEqual({ status: "failed", error: "GOOGLE_ADS_REJECTED" });
    server.routes["POST /token"] = { status: 200, body: { access_token: "access-2" } };
    await signInAsAdmin();
    await connectGoogleAds();
    expect(await testConnection({ code: null }, form({ kind: "googleads" }))).toEqual({ code: null, ok: true });
    expect(sent(INGEST).at(-1)?.validateOnly).toBe(true);
  });
});

describe("platforms not connected", () => {
  test("each step is skipped with its platform's reason, and no visitor address is kept", async () => {
    await view("");
    expect(await db().$count(signal, eq(signal.visitorId, cookieStore.get("lf_vid") ?? ""))).toBe(0);
    const order = await buy({ email: "nothing@example.com" });
    await pay(order);
    await sendConversions();
    expect(await statusOf(order, "tiktok")).toEqual({ status: "skipped", error: "TIKTOK_NOT_CONFIGURED" });
    expect(await statusOf(order, "googleads")).toEqual({ status: "skipped", error: "GOOGLE_ADS_NOT_CONFIGURED" });
    expect(server.requests.length).toBe(0);
  });
});

describe("domain verification", () => {
  test("takes the codes alone or inside the pasted meta tags", async () => {
    await signInAsAdmin();

    const saved = await saveVerification(
      { code: null },
      form({
        google:
          '<meta name="google-site-verification" content="abcDEF123_-xyz0001" />\n<meta name="google-site-verification" content="second-code-12345" />',
        meta: "a1b2c3d4e5f6g7h8i9j0k1",
      }),
    );

    expect(saved).toEqual({ code: null, ok: true });
    expect(await settings()).toMatchObject({
      googleVerification: ["abcDEF123_-xyz0001", "second-code-12345"],
      metaVerification: "a1b2c3d4e5f6g7h8i9j0k1",
    });
    expect((await saveVerification({ code: null }, form({ google: "<script>", meta: "" }))).code).toBe(
      "INVALID_VERIFICATION",
    );
    expect(
      (await saveVerification({ code: null }, form({ google: "", meta: "one-code-123456 two-code-123456" }))).code,
    ).toBe("INVALID_VERIFICATION");
  });
});

describe("one-click setup", () => {
  test("each field takes whatever the seller copied, and saving tests at once", async () => {
    server.routes["POST /v27.0/1234567890/events"] = { status: 200, body: { events_received: 1 } };
    await signInAsAdmin();

    const snippet =
      "<script>!function(f,b,e,v,n,t,s){}(window);fbq('init', '1234567890');fbq('track', 'PageView');</script>";

    expect(await saveMeta({ code: null }, form({ pixelId: snippet, token: "meta-token", pixel: "1" }))).toEqual({
      code: null,
      ok: true,
    });
    expect(server.to("POST", "/v27.0/1234567890/events").length).toBe(1);

    const tiktokSnippet = "ttq.load('c4testpixel0002'); ttq.page();";
    expect(await saveTikTok({ code: null }, form({ pixelCode: tiktokSnippet, token: "tt-token" }))).toEqual({
      code: null,
      ok: true,
    });

    const gtag =
      "<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-PASTE123\"></script><script>gtag('config', 'G-PASTE123'); gtag('config', 'AW-987654321');</script>";

    expect(
      await saveAnalytics({ code: null }, form({ measurementId: gtag, apiSecret: "ga-secret", tag: "1" })),
    ).toEqual({
      code: null,
      ok: true,
    });

    const stored = await credentials("meta", "tiktok", "analytics", "googleads");
    expect([stored("meta")("pixelId"), stored("tiktok")("pixelCode"), stored("analytics")("measurementId")]).toEqual([
      "1234567890",
      "C4TESTPIXEL0002",
      "G-PASTE123",
    ]);
    // The Google tag pasted for Analytics carried the Google Ads id too.
    expect(stored("googleads")("tagId")).toBe("AW-987654321");
    expect((await browserTags("")).google).toEqual(["G-PASTE123", "AW-987654321"]);

    const page = "https://ads.google.com/aw/conversions/detail?ocid=1&ctId=777888999&__u=2";
    await redirected(
      saveGoogleAds(
        { code: null },
        form({
          clientId: "1234567890-abcdef.apps.googleusercontent.com",
          clientSecret: "client-secret",
          customerId: "123-456-7890",
          actionId: page,
        }),
      ),
    );
    expect((await credentials("googleads"))("googleads")("actionId")).toBe("777888999");
  });

  test("a refused token is saved anyway, says why, and the card counts the refusals", async () => {
    server.routes["POST /v27.0/1234567890/events"] = { status: 400, body: { error: { code: 190, fbtrace_id: "t" } } };
    await signInAsAdmin();
    expect((await saveMeta({ code: null }, form({ pixelId: "1234567890", token: "expired" }))).code).toBe(
      "META_REJECTED",
    );
    expect((await credentials("meta"))("meta")("pixelId")).toBe("1234567890");
    const order = await buy({ email: "refused@example.com" });
    await pay(order);
    await sendConversions();
    expect((await adConnections()).meta.refused).toBe(2);
  });
});

describe("a product with its own ad accounts", () => {
  test("its events go to its own pixel and action; the other products keep the store's", async () => {
    await saveCredentials("meta", { pixelId: "123", testEventCode: "", pixel: "1" }, { token: "store-token" });
    await connectGoogleAds();
    server.routes["POST /v27.0/999999/events"] = { status: 200, body: { events_received: 2 } };
    await signInAsAdmin();

    const saved = await saveProductAds(
      { code: null },
      form({ slug: "bolo-no-pote", metaPixel: "999999", metaToken: "product-token", actionId: "424242" }),
    );

    expect(saved).toEqual({ code: null, ok: true });
    expect((await browserTags("bolo-no-pote")).meta).toBe("999999");
    expect((await browserTags("planilha-preco")).meta).toBe("123");
    await pay(await buy({ email: "own-account@example.com" }));
    await pay(await buy({ email: "store-account@example.com", slug: "planilha-preco" }), 4700);
    await sendConversions();

    const own = sent("/v27.0/999999/events");
    expect(
      own
        .flatMap((body) =>
          body.data.map((event: { custom_data: { content_ids: string[] } }) => event.custom_data.content_ids[0]),
        )
        .every((id: string) => id === "bolo-no-pote"),
    ).toBe(true);
    expect(own[0]?.access_token).toBe("product-token");
    expect(
      sent("/v27.0/123/events")
        .flatMap((body) => body.data)
        .some(
          (event: { custom_data: { content_ids: string[] } }) => event.custom_data.content_ids[0] === "bolo-no-pote",
        ),
    ).toBe(false);
    expect(
      sent(INGEST)
        .map((body) => body.destinations[0].productDestinationId)
        .sort(),
    ).toEqual(["424242", "555"]);
  });

  test("clearing the product's pixel goes back to the store's, and a product alone can connect a platform", async () => {
    await signInAsAdmin();
    await saveProductAds(
      { code: null },
      form({ slug: "bolo-no-pote", tiktokPixel: "C4PRODUCTONLY01", tiktokToken: "tt-own" }),
    );
    await view("");
    await sendConversions();
    expect(sent(TIKTOK)[0]).toMatchObject({ event_source_id: "C4PRODUCTONLY01" });
    await saveProductAds({ code: null }, form({ slug: "bolo-no-pote", tiktokPixel: "" }));
    expect(await db().$count(productTracking)).toBe(0);
  });
});

describe("attribution and verification", () => {
  test("a link with several click ids keeps each of them", async () => {
    await view("?utm_source=google&gclid=G-click&gbraid=G-braid&fbclid=F-click&ttclid=T-click");
    const visitor = cookieStore.get("lf_vid") ?? "";
    expect((await latestClicks([visitor])).get(visitor)).toEqual({
      fbclid: "F-click",
      gclid: "G-click",
      ttclid: "T-click",
      gbraid: "G-braid",
    });
  });

  test("tags and bare codes mix in one field", async () => {
    await signInAsAdmin();
    await saveVerification(
      { code: null },
      form({
        google: '<meta name="google-site-verification" content="first-code-12345" />\nsecond-code-12345',
        meta: "",
      }),
    );
    expect((await settings()).googleVerification).toEqual(["first-code-12345", "second-code-12345"]);
  });
});
