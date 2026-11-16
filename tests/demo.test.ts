import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, setSystemTime } from "bun:test";
import { count, eq, sql } from "drizzle-orm";
import { drizzle as pglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { GET as demoFile } from "@/app/demo/[file]/route";
import { restartStore } from "@/lib/actions/store";
import { saveMeta } from "@/lib/actions/ads";
import { savePix, saveSmtp, testConnection } from "@/lib/actions/connections";
import { simulatePayment } from "@/lib/actions/checkout";
import { credentials, saveCredentials } from "@/lib/settings";
import { db, nightlyDemoReset, one, resetDemo } from "@/lib/db";
import { sendMessages } from "@/lib/messages";
import { brCode } from "@/lib/orders/pix";
import { conversion, event, lesson, message, order, payment, product, progress, setting, touch } from "@/lib/schema";
import { sendConversions } from "@/lib/tracking/conversions";
import { fakeServer, form, freshBrowser, sentMail, WEBHOOK_SECRET } from "./fakes";
import { buy, pay, signInAsAdmin } from "./flows";

let evolution: Awaited<ReturnType<typeof fakeServer>>;
let ip = 0;

beforeAll(async () => {
  evolution = await fakeServer({
    "GET *": { status: 200, body: { instance: { state: "open" } } },
    "POST *": { status: 201, body: { key: { id: "WAMSG1" } } },
  });
  process.env.EVOLUTION_URL = evolution.url;
  process.env.EVOLUTION_KEY = "evolution-key";
});

afterAll(() => evolution.close());

beforeEach(() => {
  ip += 1;
  freshBrowser(`192.0.2.${ip}`);
  setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
  process.env.DEMO_MODE = "1";
});

afterEach(() => {
  delete process.env.DEMO_MODE;
});

function statusOf(id: string) {
  return db()
    .select({ status: order.status })
    .from(order)
    .where(eq(order.id, id))
    .then((rows) => one(rows).status);
}

describe("connections in demo mode", () => {
  test("saving, testing and the updater are refused without storing or calling anything", async () => {
    await signInAsAdmin();

    const smtp = form({ host: "smtp.example.com", port: "587", user: "shop@example.com", password: "secret-pass" });

    expect(await saveSmtp({ code: null }, smtp)).toEqual({ code: "DEMO_BLOCKED" });
    expect(await saveMeta({ code: null }, form({ pixelId: "123456", token: "meta-token" }))).toEqual({
      code: "DEMO_BLOCKED",
    });
    expect(await savePix({ code: null }, form({ provider: "woovi", apiKey: "woovi-key" }))).toEqual({
      code: "DEMO_BLOCKED",
    });
    expect(await testConnection({ code: null }, form({ kind: "evolution" }))).toEqual({ code: "DEMO_BLOCKED" });
    expect(await restartStore()).toEqual({ code: "DEMO_BLOCKED" });

    const stored = await credentials("smtp", "meta", "woovi");

    expect([stored("smtp")("host"), stored("meta")("pixelId"), stored("woovi")("apiKey")]).toEqual(["", "", ""]);
    expect(evolution.requests).toHaveLength(0);
  });
});

describe("outbox in demo mode", () => {
  test("queued e-mail and WhatsApp are marked as sent with the demo marker and never delivered", async () => {
    await saveCredentials(
      "smtp",
      { host: "smtp.test", port: "587", user: "shop@example.com", from: "" },
      { password: "smtp-password" },
    );

    const id = await buy({ email: "outbox@example.com" });

    expect((await pay(id)).status).toBe(200);
    sentMail.length = 0;
    evolution.requests.length = 0;
    await sendMessages();

    const rows = await db()
      .select({ channel: message.channel, status: message.status, externalId: message.externalId })
      .from(message)
      .where(eq(message.orderId, id));

    expect(rows.map((row) => row.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(rows.every((row) => row.status === "sent" && row.externalId === "demo")).toBe(true);
    expect(sentMail).toHaveLength(0);
    expect(evolution.requests).toHaveLength(0);
  });

  test("Meta events are skipped instead of sent", async () => {
    await saveCredentials("meta", { pixelId: "123456", testEventCode: "" }, { token: "meta-token" });
    const id = await buy({ email: "meta@example.com" });
    await sendConversions();

    const [row] = await db().select({ status: conversion.status }).from(conversion).where(eq(conversion.orderId, id));

    expect(row?.status).toBe("skipped");
  });
});

describe("simulated payment", () => {
  test("is refused outside demo mode and leaves the order pending", async () => {
    delete process.env.DEMO_MODE;
    const id = await buy({ email: "real@example.com" });

    expect(await simulatePayment({ code: null }, form({ orderId: id }))).toEqual({ code: "DEMO_ONLY" });
    expect(await statusOf(id)).toBe("pending");
  });

  test("pays the full amount once through the confirmed-payment path", async () => {
    const id = await buy({ email: "demo-buyer@example.com" });

    const [first, second] = await Promise.all([
      simulatePayment({ code: null }, form({ orderId: id })),
      simulatePayment({ code: null }, form({ orderId: id })),
    ]);

    expect([first.code, second.code].filter((code) => code === null)).toHaveLength(1);
    expect(await statusOf(id)).toBe("paid");

    const payments = await db()
      .select({ amount: payment.amount, externalId: payment.externalId })
      .from(payment)
      .where(eq(payment.orderId, id));

    expect(payments).toEqual([{ amount: 9700, externalId: `demo:${id}` }]);

    const access = await db().select({ total: count() }).from(message).where(eq(message.orderId, id)).then(one);

    expect(access.total).toBeGreaterThan(0);
  });
});

describe("nightly reset", () => {
  afterAll(() => saveCredentials("webhook", {}, { secret: WEBHOOK_SECRET }));

  async function brand() {
    const [row] = await db().select({ value: setting.value }).from(setting).where(eq(setting.key, "brand"));
    return row?.value;
  }

  async function slugs() {
    const rows = await db().select({ slug: product.slug }).from(product);
    return rows.map((row) => row.slug).sort();
  }

  test("a fresh install has no products: the demo store lives outside the migrations", async () => {
    const fresh = pglite(new PGlite());
    await migrate(fresh, { migrationsFolder: join(process.cwd(), "src", "lib", "migrations") });

    const [products, settings] = await Promise.all([
      fresh.select({ total: count() }).from(product).then(one),
      fresh.select({ total: count() }).from(setting).then(one),
    ]);

    expect([products.total, settings.total]).toEqual([0, 0]);
  });

  test("outside demo mode the store is left alone; demo mode loads the full store once, then resets only at 04:00 in Sao Paulo", async () => {
    delete process.env.DEMO_MODE;
    await nightlyDemoReset();
    expect(await slugs()).toEqual(["bolo-no-pote", "planilha-preco"]);

    process.env.DEMO_MODE = "1";
    await nightlyDemoReset();
    expect(await slugs()).toEqual(["bolo-no-pote", "mentoria-cardapio", "planilha-preco"]);
    expect(await brand()).toBe("Confeitaria da Lia");

    await db().update(setting).set({ value: "Loja Mexida" }).where(eq(setting.key, "brand"));
    await nightlyDemoReset();
    expect(await brand()).toBe("Loja Mexida");

    setSystemTime(new Date("2026-11-15T04:10:00-03:00"));
    delete process.env.DEMO_MODE;
    await nightlyDemoReset();
    expect(await brand()).toBe("Loja Mexida");

    process.env.DEMO_MODE = "1";
    await nightlyDemoReset();
    expect(await brand()).toBe("Confeitaria da Lia");

    await db().update(setting).set({ value: "Loja Mexida" }).where(eq(setting.key, "brand"));
    await nightlyDemoReset();
    expect(await brand()).toBe("Loja Mexida");
  });

  test("restores the full demo store with consistent money and empties connections", async () => {
    await buy({ email: "before-reset@example.com" });
    await db().update(product).set({ name: "Produto editado" }).where(eq(product.slug, "bolo-no-pote"));
    await resetDemo();

    const products = await db()
      .select({
        slug: product.slug,
        name: product.name,
        pix: { key: product.pixKey, name: product.pixName, city: product.pixCity },
        offerOpen: sql<boolean>`${product.offerEndsAt} > now()`,
        testimonials: product.testimonials,
      })
      .from(product);

    const orders = await db()
      .select({
        id: order.id,
        product: order.product,
        status: order.status,
        amount: order.amount,
        pixCode: order.pixCode,
        received: sql<number>`COALESCE(SUM(${payment.amount}), 0)`.mapWith(Number),
      })
      .from(order)
      .leftJoin(payment, eq(payment.orderId, order.id))
      .groupBy(order.id);

    const [messages, touches, events, progresses, lessons, settings, failed] = await Promise.all([
      db().select({ total: count() }).from(message).then(one),
      db().select({ total: count() }).from(touch).then(one),
      db().select({ total: count() }).from(event).then(one),
      db().select({ total: count() }).from(progress).then(one),
      db().select({ total: count() }).from(lesson).then(one),
      db().select({ total: count() }).from(setting).then(one),
      db().select({ total: count() }).from(message).where(eq(message.status, "failed")).then(one),
    ]);

    const course = products.find((row) => row.slug === "bolo-no-pote");
    const webhook = (await credentials("webhook"))("webhook")("secret");

    expect(products.map((row) => row.slug).sort()).toEqual(["bolo-no-pote", "mentoria-cardapio", "planilha-preco"]);
    expect(course?.name).toBe("Bolo no Pote: da receita à primeira venda");
    expect(course?.offerOpen).toBe(true);
    expect(products.flatMap((row) => row.testimonials).every((entry) => entry.name === "Depoimento de exemplo")).toBe(
      true,
    );
    expect(orders).toHaveLength(48);
    expect(orders.every((row) => row.id.startsWith("demo"))).toBe(true);

    expect(new Set(orders.map((row) => row.status))).toEqual(new Set(["paid", "pending", "expired", "refunded"]));
    expect(orders.filter((row) => row.status === "paid").every((row) => row.received === row.amount)).toBe(true);
    expect(orders.filter((row) => row.status !== "paid").every((row) => row.received === 0)).toBe(true);

    for (const row of orders.filter((entry) => entry.status === "pending")) {
      const pix = products.find((entry) => entry.slug === row.product)?.pix;
      expect(pix && brCode(pix, row.amount, row.id)).toBe(row.pixCode);
    }

    expect(settings.total).toBe(setting.key.enumValues.length);
    expect(
      [messages.total, touches.total, events.total, progresses.total, failed.total].every((total) => total > 0),
    ).toBe(true);
    expect(lessons.total).toBe(14);
    expect(webhook).toBe("");
    expect(await brand()).toBe("Confeitaria da Lia");
  });

  test("a pending demo order pays through the simulated Pix", async () => {
    const [pending] = await db().select({ id: order.id }).from(order).where(eq(order.status, "pending"));

    expect((await simulatePayment({ code: null }, form({ orderId: pending?.id ?? "" }))).code).toBeNull();
    expect(await statusOf(pending?.id ?? "")).toBe("paid");
  });
});

describe("demo media", () => {
  function fetchDemo(file: string, range?: string) {
    const headers: Record<string, string> = range ? { range } : {};
    return demoFile(new Request(`https://shop.example/demo/${file}`, { headers }), {
      params: Promise.resolve({ file }),
    });
  }

  test("is served only in demo mode, only for the known files, with byte ranges", async () => {
    delete process.env.DEMO_MODE;
    expect((await fetchDemo("vsl-demo.mp4")).status).toBe(404);

    process.env.DEMO_MODE = "1";
    const video = await fetchDemo("vsl-demo.mp4");

    expect(video.status).toBe(200);
    expect(video.headers.get("content-type")).toBe("video/mp4");
    await video.body?.cancel();

    const head = await fetchDemo("vsl-demo.mp4", "bytes=0-1");

    expect([head.status, head.headers.get("content-length")]).toEqual([206, "2"]);
    await head.body?.cancel();
    expect((await fetchDemo("CREDITS.md")).status).toBe(404);
    expect((await fetchDemo("..%2F..%2Fpackage.json")).status).toBe(404);
  });
});
