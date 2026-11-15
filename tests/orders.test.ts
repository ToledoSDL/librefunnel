import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi, setSystemTime } from "bun:test";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createOrder, releaseOrder, rotateWebhookSecret, saveWooviCrypto } from "@/lib/actions";
import { credentials, removeCredentials, saveCredentials } from "@/lib/catalog";
import { db, one } from "@/lib/db";
import {
  attachCharges,
  brCode,
  checkCharges,
  convertToCrypto,
  expireOrders,
  getPixOrder,
  refreshWebhookKeys,
} from "@/lib/orders";
import { conversion, customer, message, order, payment, product } from "@/lib/schema";
import { POST as paymentWebhook } from "@/app/api/webhooks/payment/route";
import { fakeServer, form, freshBrowser, redirectFetch, WEBHOOK_SECRET } from "./fakes";
import { buy, pay, signInAsAdmin, webhook } from "./flows";
import { parsePixKey } from "@/lib/input";

// Published on AbacatePay's webhook security page.
const ABACATEPAY_PUBLIC_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

async function stored(id: string) {
  return one(
    await db()
      .select({
        status: order.status,
        amount: order.amount,
        bump: order.bump,
        productAmount: order.productAmount,
        txid: order.txid,
        pixCode: order.pixCode,
        psp: order.psp,
        pspCheckAt: order.pspCheckAt,
      })
      .from(order)
      .where(eq(order.id, id)),
  );
}

function payments(id: string) {
  return db().$count(payment, eq(payment.orderId, id));
}

function accessMessages(id: string) {
  return db().$count(message, and(eq(message.orderId, id), eq(message.kind, "access")));
}

function purchases(id: string) {
  return db().$count(conversion, and(eq(conversion.orderId, id), eq(conversion.name, "Purchase")));
}

beforeEach(() => freshBrowser(`203.0.113.${Math.floor(Math.random() * 250)}`));

describe("BR Code", () => {
  test("matches the BCB manual example", () => {
    const code = brCode(
      { key: "123e4567-e12b-12d1-a456-426655440000", name: "Fulano de Tal", city: "BRASILIA" },
      null,
      "***",
    );

    expect(code).toBe(
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D",
    );
  });

  test("order code carries amount, ascii name and the order id as txid", async () => {
    const id = await buy();
    const pix = await getPixOrder(id, "bolo-no-pote");
    expect(pix?.pixCode).toContain("540597.00");
    expect(pix?.pixCode).toContain(`0520${id}`);
    expect(pix?.txid).toBe(id);
    expect(pix?.maskedEmail).toBe("a***@example.com");
    expect(await getPixOrder(id, "planilha-preco")).toBeUndefined();
    expect(await getPixOrder("../etc", "bolo-no-pote")).toBeUndefined();
  });

  test("keys are normalized to the DICT formats", () => {
    expect(parsePixKey("+55 (48) 99999-0000")).toBe("+5548999990000");
    expect(parsePixKey("123.456.789-09")).toBe("12345678909");
    expect(parsePixKey("48999990000")).toBeUndefined();
    expect(parsePixKey("Shop@Example.com")).toBe("shop@example.com");
    expect(parsePixKey("123E4567-E12B-12D1-A456-426655440000")).toBe("123e4567-e12b-12d1-a456-426655440000");
    expect(parsePixKey("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
  });
});

describe("createOrder", () => {
  test("prices come from the catalog, never from the form", async () => {
    const id = await buy({ price: "1", amount: "1", bump_price: "1", bump: "1" });
    expect(await stored(id)).toMatchObject({ productAmount: 9700, bump: "planilha-preco", amount: 9700 + 1990 });
  });

  test("identical resubmit reuses the order, a changed bump cancels the old one", async () => {
    const first = await buy({ email: "repeat@example.com" });
    expect(await buy({ email: "repeat@example.com" })).toBe(first);
    const second = await buy({ email: "repeat@example.com", bump: "1" });
    expect(second).not.toBe(first);
    expect((await stored(first)).status).toBe("canceled");
    expect((await stored(second)).status).toBe("pending");
  });

  test("concurrent checkouts by one buyer leave one pending order", async () => {
    await Promise.all(Array.from({ length: 5 }, () => buy({ email: "double-click@example.com" })));

    const buyer = one(
      await db().select({ id: customer.id }).from(customer).where(eq(customer.email, "double-click@example.com")),
    );

    expect(await db().$count(order, and(eq(order.customerId, buyer.id), eq(order.status, "pending")))).toBe(1);
  });

  test("checkout closes when the offer ends", async () => {
    const setOfferEnd = (at: Date | null) =>
      db().update(product).set({ offerEndsAt: at }).where(eq(product.slug, "bolo-no-pote"));

    await setOfferEnd(new Date("2026-11-30T23:59:00-03:00"));
    setSystemTime(new Date("2026-12-01T00:00:00-03:00"));

    const result = await createOrder(
      { code: null },
      form({ slug: "bolo-no-pote", name: "Ana Souza", email: "closed@example.com" }),
    );

    setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    await setOfferEnd(null);
    expect(result.code).toBe("OFFER_ENDED");
  });

  test("rejects multiple recipients, bad phones and links in the name", async () => {
    for (const email of [
      "a@x.com,b@y.com",
      "a@x.com b@y.com",
      "a@x.com;b@y.com",
      "<a@x.com>",
      "no-at-sign",
      "a@x.com\r\nBcc: c@z.com",
    ]) {
      expect((await createOrder({ code: null }, form({ slug: "bolo-no-pote", name: "Ana", email }))).code).toBe(
        "INVALID_EMAIL",
      );
    }
    expect(
      (await createOrder({ code: null }, form({ slug: "bolo-no-pote", name: "Ana", email: "a@x.com", phone: "123" })))
        .code,
    ).toBe("INVALID_PHONE");
    expect(
      (
        await createOrder(
          { code: null },
          form({ slug: "bolo-no-pote", name: "https://scam.example/pix Silva", email: "a@x.com" }),
        )
      ).code,
    ).toBe("INVALID_NAME");
    expect(
      (await createOrder({ code: null }, form({ slug: "missing-product", name: "Ana", email: "a@x.com" }))).code,
    ).toBe("PRODUCT_NOT_FOUND");
  });

  test("many orders from one IP are throttled", async () => {
    freshBrowser("192.0.2.99");
    for (let index = 0; index < 20; index += 1) await buy({ email: `batch${index}@example.com` });

    const result = await createOrder(
      { code: null },
      form({ slug: "bolo-no-pote", name: "Ana Souza", email: "batch99@example.com" }),
    );

    expect(result.code).toBe("RATE_LIMITED");
  });
});

describe("payment webhook", () => {
  test("is a 404 until a secret is generated, and a new secret replaces the old one at once", async () => {
    await removeCredentials("webhook");

    const response = await paymentWebhook(
      new Request("https://shop.example/api/webhooks/payment", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(404);
    await signInAsAdmin();
    const rotated = await rotateWebhookSecret();
    expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
    const id = await buy({ email: "rotated@example.com" });
    expect((await pay(id)).status).toBe(401);
    const body = JSON.stringify({ order: id, status: "paid", amount: 9700, id: "rotated-1" });
    expect(
      (
        await webhook(
          body,
          createHmac("sha256", rotated.secret ?? "")
            .update(body)
            .digest("hex"),
        )
      ).status,
    ).toBe(200);
    await saveCredentials("webhook", {}, { secret: WEBHOOK_SECRET });
  });

  test("rejects forged, non-ascii and malformed requests", async () => {
    const id = await buy({ email: "forged@example.com" });
    expect((await webhook({ order: id, status: "paid", amount: 9700, id: "x" }, "00")).status).toBe(401);
    expect((await webhook("[1, 2]", "ç")).status).toBe(401);
    expect((await webhook("[1, 2]")).status).toBe(400);
    expect((await webhook({ order: id, status: "paid", amount: 97.5, id: "x" })).status).toBe(400);
    expect((await stored(id)).status).toBe("pending");
  });

  test("three replays release once: one payment, one access e-mail, one Purchase", async () => {
    const id = await buy({ email: "replay@example.com" });
    const bodies = [];
    for (let index = 0; index < 3; index += 1) bodies.push(await (await pay(id)).json());
    expect(bodies).toEqual([{ ok: true }, { code: "DUPLICATE_PAYMENT" }, { code: "DUPLICATE_PAYMENT" }]);
    expect(await payments(id)).toBe(1);
    expect(await accessMessages(id)).toBe(1);
    expect(await purchases(id)).toBe(1);
  });

  test("concurrent webhooks and an owner release produce one release", async () => {
    const id = await buy({ email: "race@example.com" });
    await signInAsAdmin();

    await Promise.all([
      pay(id, 9700, "a"),
      pay(id, 9700, "b"),
      releaseOrder({ code: null }, form({ orderId: id, amount: "97,00" })),
      pay(id, 9700, "a"),
    ]);

    expect((await stored(id)).status).toBe("paid");
    expect(await accessMessages(id)).toBe(1);
    expect(await purchases(id)).toBe(1);
  });

  test("underpayment keeps the order pending until the rest arrives", async () => {
    const id = await buy({ email: "short@example.com" });
    expect(await (await pay(id, 100, "short-1")).json()).toEqual({ code: "UNDERPAID" });
    expect((await stored(id)).status).toBe("pending");
    expect(await accessMessages(id)).toBe(0);
    expect(await (await pay(id, 9600, "short-2")).json()).toEqual({ ok: true });
    expect((await stored(id)).status).toBe("paid");
  });

  test("an external id cannot be reused on another order", async () => {
    const first = await buy({ email: "one@example.com" });
    const second = await buy({ email: "two@example.com" });
    await pay(first, 9700, "same-id");
    expect(await (await pay(second, 9700, "same-id")).json()).toEqual({ code: "DUPLICATE_PAYMENT" });
    expect((await stored(second)).status).toBe("pending");
  });

  test("orders expire, and a late payment of an expired or canceled order still releases", async () => {
    const id = await buy({ email: "late@example.com" });
    setSystemTime(new Date("2026-11-17T13:00:00-03:00"));
    await expireOrders();
    expect((await stored(id)).status).toBe("expired");
    expect((await getPixOrder(id, "bolo-no-pote"))?.status).toBe("expired");
    await pay(id);
    setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    expect((await stored(id)).status).toBe("paid");
  });

  test("refund webhook revokes and a payment after refund does not restore", async () => {
    const id = await buy({ email: "chargeback@example.com" });
    await pay(id);
    expect(await (await webhook({ order: id, status: "refunded", amount: 9700, id: "chargeback-1" })).json()).toEqual({
      ok: true,
    });
    expect((await stored(id)).status).toBe("refunded");
    await pay(id, 9700, "again");
    expect((await stored(id)).status).toBe("refunded");
  });

  test("a refund that arrives before its payment keeps the order closed", async () => {
    const id = await buy({ email: "early-refund@example.com" });
    const refund = { order: id, status: "refunded", amount: 9700, id: "early-refund" };
    expect(await (await webhook(refund)).json()).toEqual({ ok: true });
    expect(await (await pay(id, 9700, "early-payment")).json()).toEqual({ code: "UNDERPAID" });
    expect((await stored(id)).status).toBe("pending");
    expect(await accessMessages(id)).toBe(0);
    expect(await purchases(id)).toBe(0);
  });

  test("owner release requires a positive amount and an open order", async () => {
    const id = await buy({ email: "manual@example.com" });
    await signInAsAdmin();
    expect((await releaseOrder({ code: null }, form({ orderId: id, amount: "0" }))).code).toBe("INVALID_AMOUNT");
    expect((await releaseOrder({ code: null }, form({ orderId: id, amount: "abc" }))).code).toBe("INVALID_AMOUNT");
    expect(await releaseOrder({ code: null }, form({ orderId: id, amount: "1.234,50" }))).toEqual({
      code: null,
      ok: true,
    });
    expect((await releaseOrder({ code: null }, form({ orderId: id, amount: "97,00" }))).code).toBe(
      "INVALID_TRANSITION",
    );
    freshBrowser();
    expect((await releaseOrder({ code: null }, form({ orderId: id, amount: "97,00" }))).code).toBe("NOT_SIGNED_IN");
  });
});

describe("Pix providers", () => {
  let server: Awaited<ReturnType<typeof fakeServer>>;
  const woovi = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forger = generateKeyPairSync("rsa", { modulusLength: 2048 });

  beforeEach(async () => {
    // Orders left open by other tests would compete for the same fake charge ids in attachCharges.
    await db()
      .update(order)
      .set({ status: "canceled" })
      .where(and(eq(order.status, "pending"), isNull(order.psp)));
    server = await fakeServer({});
    redirectFetch(
      /^https:\/\/(api\.(mercadopago|woovi|abacatepay)\.com|depix\.eulen\.app|checkout\.noxpay\.io)/,
      server.url,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const kind of ["mercadopago", "woovi", "abacatepay", "depix", "noxpay"] as const)
      await removeCredentials(kind);
    await saveCredentials("pix", { provider: "static" });
    await server.close();
  });

  async function use(
    psp: "mercadopago" | "woovi" | "abacatepay" | "depix" | "noxpay",
    apiKey: string,
    webhookSecret: string,
    fields: { clientId?: string; currency?: string } = {},
  ) {
    await saveCredentials(psp, fields, { apiKey, webhookSecret });
    await saveCredentials("pix", { provider: psp });
  }

  async function due(id: string) {
    await db()
      .update(order)
      .set({ pspCheckAt: new Date(Date.now() - 1000) })
      .where(eq(order.id, id));
  }

  function mpNotice(dataId: string, secret = "mp-secret") {
    const ts = "1731600000";

    const v1 = createHmac("sha256", secret)
      .update(`id:${dataId.toLowerCase()};request-id:req-1;ts:${ts};`)
      .digest("hex");

    return paymentWebhook(
      new Request(`https://shop.example/api/webhooks/payment?psp=mercadopago&data.id=${dataId}&type=order`, {
        method: "POST",
        body: JSON.stringify({ action: "order.processed", type: "order", data: { id: dataId } }),
        headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" },
      }),
    );
  }

  function wooviNotice(body: object, signer = woovi.privateKey, authorization = "woovi-hook-auth") {
    const raw = JSON.stringify(body);
    const signature = createSign("sha256").update(raw).sign(signer, "base64");
    return paymentWebhook(
      new Request("https://shop.example/api/webhooks/payment?psp=woovi", {
        method: "POST",
        body: raw,
        headers: { "x-webhook-signature": signature, authorization },
      }),
    );
  }

  function abacateNotice(chargeId: string, secret = "abacate-webhook-secret-with-32-chars!", signature?: string) {
    const raw = JSON.stringify({
      id: "log_1",
      event: "transparent.completed",
      apiVersion: 2,
      devMode: false,
      data: { transparent: { id: chargeId, status: "PAID" } },
    });

    const signed = signature ?? createHmac("sha256", ABACATEPAY_PUBLIC_KEY).update(raw).digest("base64");
    return paymentWebhook(
      new Request("https://shop.example/api/webhooks/payment?psp=abacatepay", {
        method: "POST",
        body: raw,
        headers: { "x-webhook-secret": secret, "x-webhook-signature": signed },
      }),
    );
  }

  function wooviPaid(id: string, value: number, endToEndId: string, refunds: object[] = []) {
    server.routes[`GET /api/v1/charge/${id}`] = {
      status: 200,
      body: { charge: { correlationID: id, status: "COMPLETED", value: 9700 } },
    };
    server.routes["GET /api/v1/transaction"] = {
      status: 200,
      body: { transactions: [{ value, endToEndId, type: "PAYMENT", charge: { correlationID: id } }] },
    };
    server.routes[`GET /api/v1/charge/${id}/refund`] = { status: 200, body: { refunds } };
  }

  async function asWoovi(id: string) {
    await db().update(order).set({ psp: "woovi", txid: id }).where(eq(order.id, id));
  }

  async function net(id: string) {
    return one(
      await db()
        .select({ net: sql<number>`COALESCE(SUM(${payment.amount}), 0)`.mapWith(Number) })
        .from(payment)
        .where(eq(payment.orderId, id)),
    ).net;
  }

  test("Mercado Pago: the charge replaces the static code, and only a re-fetched paid order releases", async () => {
    await use("mercadopago", "APP_USR-test", "mp-secret");
    const id = await buy({ email: "mp@example.com" });
    server.routes["POST /v1/orders"] = {
      status: 201,
      body: {
        id: "ORD01MP",
        status: "action_required",
        transactions: {
          payments: [
            {
              id: "PAY01",
              status: "action_required",
              payment_method: { id: "pix", qr_code: "00020126MPCODE", qr_code_base64: "x", ticket_url: "x" },
            },
          ],
        },
      },
    };
    await attachCharges();
    const created = server.to("POST", "/v1/orders")[0];
    expect(created?.headers["authorization"]).toBe("Bearer APP_USR-test");
    expect(created?.headers["x-idempotency-key"]).toBe(id);
    expect(JSON.parse(created?.body ?? "{}")).toMatchObject({ total_amount: "97.00", external_reference: id });
    expect(await stored(id)).toMatchObject({ psp: "mercadopago", txid: "ORD01MP", pixCode: "00020126MPCODE" });

    expect((await mpNotice("ORD01MP", "wrong")).status).toBe(401);
    expect(await (await mpNotice("ORD01MP")).json()).toEqual({ ok: true });
    expect((await stored(id)).status).toBe("pending");

    server.routes["GET /v1/orders/ORD01MP"] = {
      status: 200,
      body: {
        id: "ORD01MP",
        status: "action_required",
        external_reference: id,
        total_amount: "97.00",
        transactions: { payments: [{ id: "PAY01" }] },
      },
    };
    await checkCharges();
    // Still open: the next reconciliation is 5 minutes after the order was created.
    expect(await stored(id)).toMatchObject({ status: "pending", pspCheckAt: new Date(Date.now() + 300_000) });

    await mpNotice("ORD01MP");
    server.routes["GET /v1/orders/ORD01MP"] = {
      status: 200,
      body: {
        id: "ORD01MP",
        status: "processed",
        external_reference: id,
        total_amount: "97.00",
        total_paid_amount: "50.00",
        transactions: { payments: [{ id: "PAY01" }] },
      },
    };
    await checkCharges();
    expect((await stored(id)).status).toBe("pending");

    await mpNotice("ORD01MP");
    server.routes["GET /v1/orders/ORD01MP"] = {
      status: 200,
      body: {
        id: "ORD01MP",
        status: "refunded",
        external_reference: id,
        total_amount: "97.00",
        transactions: { payments: [{ id: "PAY01" }] },
      },
    };
    await checkCharges();
    expect((await stored(id)).status).toBe("pending");
  });

  test("Mercado Pago: a paid charge releases once, the reference must match and a payment-level chargeback revokes", async () => {
    await use("mercadopago", "APP_USR-test", "mp-secret");
    const id = await buy({ email: "mp2@example.com" });
    const other = await buy({ email: "mp3@example.com" });
    await db().update(order).set({ psp: "mercadopago", txid: "ORD02" }).where(eq(order.id, id));
    await db().update(order).set({ psp: "mercadopago", txid: "ORD03" }).where(eq(order.id, other));

    const paid = {
      id: "ORD02",
      status: "processed",
      external_reference: id,
      total_amount: "97.00",
      total_paid_amount: "97.00",
      transactions: { payments: [{ id: "PAY02", status: "processed" }] },
    };

    server.routes["GET /v1/orders/ORD02"] = { status: 200, body: paid };
    server.routes["GET /v1/orders/ORD03"] = { status: 200, body: { ...paid, id: "ORD03" } };
    await mpNotice("ORD02");
    await mpNotice("ORD03");
    await mpNotice("ORD02");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect((await stored(other)).status).toBe("pending");
    expect(await payments(id)).toBe(1);
    expect(await (await mpNotice("MISSING")).json()).toEqual({ code: "ORDER_NOT_FOUND" });

    server.routes["GET /v1/orders/ORD02"] = {
      status: 200,
      body: { ...paid, transactions: { payments: [{ id: "PAY02", status: "charged_back" }] } },
    };
    await mpNotice("ORD02");
    await checkCharges();
    expect((await stored(id)).status).toBe("refunded");
    expect(await net(id)).toBe(0);
  });

  test("Mercado Pago: a 429 pauses every due order of that provider for the Retry-After seconds", async () => {
    await use("mercadopago", "APP_USR-test", "mp-secret");
    const id = await buy({ email: "mp429@example.com" });
    const other = await buy({ email: "mp429-other@example.com" });
    await db().update(order).set({ psp: "mercadopago", txid: "ORD429" }).where(eq(order.id, id));
    await db().update(order).set({ psp: "mercadopago", txid: "ORD429B" }).where(eq(order.id, other));
    const slowDown = { status: 429, body: {}, headers: { "Retry-After": "120" } };
    server.routes["GET /v1/orders/ORD429"] = slowDown;
    server.routes["GET /v1/orders/ORD429B"] = slowDown;
    await mpNotice("ORD429");
    await mpNotice("ORD429B");
    await checkCharges();
    expect(server.to("GET", "/v1/orders/ORD429").length + server.to("GET", "/v1/orders/ORD429B").length).toBe(1);
    expect((await stored(id)).pspCheckAt).toEqual(new Date(Date.now() + 120_000));
    expect((await stored(other)).pspCheckAt).toEqual(new Date(Date.now() + 120_000));
    await checkCharges();
    expect(server.to("GET", "/v1/orders/ORD429").length + server.to("GET", "/v1/orders/ORD429B").length).toBe(1);
  });

  test("switching provider keeps checking old orders with the provider that issued them", async () => {
    await use("mercadopago", "APP_USR-old", "mp-secret");
    const id = await buy({ email: "switch@example.com" });
    await db().update(order).set({ psp: "mercadopago", txid: "ORDSW" }).where(eq(order.id, id));
    await use("woovi", "woovi-app-id", "");
    server.routes["GET /v1/orders/ORDSW"] = {
      status: 200,
      body: {
        id: "ORDSW",
        status: "processed",
        external_reference: id,
        total_amount: "97.00",
        total_paid_amount: "97.00",
        transactions: { payments: [{ id: "PAYSW" }] },
      },
    };
    expect(await (await mpNotice("ORDSW")).json()).toEqual({ ok: true });
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect(server.to("GET", "/v1/orders/ORDSW")[0]?.headers["authorization"]).toBe("Bearer APP_USR-old");
  });

  test("Woovi: signed notice, re-fetch of the paid transaction, forged and replayed notices", async () => {
    server.routes["GET /api/v1/webhook/public-keys"] = {
      status: 200,
      body: {
        public_keys: [
          { key_identifier: "k1", key: woovi.publicKey.export({ type: "spki", format: "pem" }), is_current: true },
        ],
      },
    };
    await use("woovi", "woovi-app-id", "woovi-hook-auth");
    await refreshWebhookKeys();
    const id = await buy({ email: "woovi@example.com" });
    server.routes["POST /api/v1/charge"] = {
      status: 200,
      body: {
        charge: { correlationID: id, brCode: "00020126WOOVI", status: "ACTIVE", value: 9700 },
        correlationID: id,
        brCode: "00020126WOOVI",
      },
    };
    await attachCharges();
    const created = server.to("POST", "/api/v1/charge")[0];
    expect(created?.headers["authorization"]).toBe("woovi-app-id");
    expect(JSON.parse(created?.body ?? "{}")).toMatchObject({ correlationID: id, value: 9700, expiresIn: 259_200 });
    expect(await stored(id)).toMatchObject({ psp: "woovi", txid: id, pixCode: "00020126WOOVI" });

    const event = {
      event: "OPENPIX:CHARGE_COMPLETED",
      charge: { correlationID: id, status: "COMPLETED" },
      pix: { value: 9700, endToEndId: "E2EW1" },
    };

    expect((await wooviNotice(event, forger.privateKey)).status).toBe(401);
    expect((await wooviNotice(event, woovi.privateKey, "wrong")).status).toBe(401);
    expect(
      (await wooviNotice({ data_criacao: "2026-11-14", event: "teste_webhook" }, forger.privateKey, "")).status,
    ).toBe(200);
    expect(await (await wooviNotice(event)).json()).toEqual({ ok: true });
    expect((await stored(id)).status).toBe("pending");

    wooviPaid(id, 9700, "E2EW1");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    await wooviNotice(event);
    await checkCharges();
    expect(await payments(id)).toBe(1);
    expect(await accessMessages(id)).toBe(1);
  });

  test("Woovi: underpayment stays pending; a refund, then a MED, revoke once by endToEndId", async () => {
    server.routes["GET /api/v1/webhook/public-keys"] = {
      status: 200,
      body: {
        public_keys: [
          { key_identifier: "k1", key: woovi.publicKey.export({ type: "spki", format: "pem" }), is_current: true },
        ],
      },
    };
    await use("woovi", "woovi-app-id", "");
    await refreshWebhookKeys();
    const short = await buy({ email: "woovi-short@example.com" });
    await asWoovi(short);
    wooviPaid(short, 5000, "E2ESHORT");
    await wooviNotice({ charge: { correlationID: short } }, woovi.privateKey, "");
    await checkCharges();
    expect((await stored(short)).status).toBe("pending");

    const id = await buy({ email: "woovi-refund@example.com" });
    await asWoovi(id);
    wooviPaid(id, 9700, "E2EPAID");
    await wooviNotice({ charge: { correlationID: id } }, woovi.privateKey, "");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");

    wooviPaid(id, 9700, "E2EPAID", [{ value: 9700, status: "CONFIRMED", correlationID: "r1", endToEndId: "D-REFUND" }]);

    const refund = {
      event: "PIX_TRANSACTION_REFUND_SENT_CONFIRMED",
      refundTransaction: { value: 9700, endToEndId: "D-REFUND" },
      originalTransaction: { endToEndId: "E2EPAID" },
    };

    expect(await (await wooviNotice(refund, woovi.privateKey, "")).json()).toEqual({ ok: true });
    await checkCharges();
    expect((await stored(id)).status).toBe("refunded");

    server.routes["GET /api/v1/dispute/E2EPAID"] = {
      status: 200,
      body: { dispute: { status: "ACCEPTED", type: "MED", endToEndId: "E2EPAID", value: "97.00" } },
    };
    await wooviNotice(
      { event: "OPENPIX:DISPUTE_ACCEPTED", dispute: { status: "ACCEPTED", endToEndId: "E2EPAID", value: 9700 } },
      woovi.privateKey,
      "",
    );
    await checkCharges();
    expect((await stored(id)).status).toBe("refunded");
    expect(await net(id)).toBe(0);
  });

  test("Woovi: a charge already refunded on its first check is never released", async () => {
    server.routes["GET /api/v1/webhook/public-keys"] = {
      status: 200,
      body: {
        public_keys: [
          { key_identifier: "k1", key: woovi.publicKey.export({ type: "spki", format: "pem" }), is_current: true },
        ],
      },
    };
    await use("woovi", "woovi-app-id", "");
    await refreshWebhookKeys();
    const id = await buy({ email: "woovi-late@example.com" });
    await asWoovi(id);
    wooviPaid(id, 9700, "E2ELATE", [{ value: 9700, status: "CONFIRMED", correlationID: "r2", endToEndId: "D-LATE" }]);
    await wooviNotice({ charge: { correlationID: id } }, woovi.privateKey, "");
    await checkCharges();
    expect((await stored(id)).status).toBe("pending");
    expect(await accessMessages(id)).toBe(0);
  });

  test("AbacatePay: secret and signature both required, re-fetch releases once, refund revokes", async () => {
    await use("abacatepay", "abc_prod_key", "abacate-webhook-secret-with-32-chars!");
    const id = await buy({ email: "abacate@example.com" });
    server.routes["POST /v2/transparents/create"] = {
      status: 200,
      body: {
        data: { id: "pix_char_1", brCode: "00020126ABACATE", amount: 9700, status: "PENDING", devMode: false },
        success: true,
        error: null,
      },
    };
    await attachCharges();
    const created = server.to("POST", "/v2/transparents/create")[0];
    expect(created?.headers["authorization"]).toBe("Bearer abc_prod_key");
    expect(JSON.parse(created?.body ?? "{}")).toMatchObject({ method: "PIX", data: { amount: 9700, externalId: id } });
    expect(await stored(id)).toMatchObject({ psp: "abacatepay", txid: "pix_char_1", pixCode: "00020126ABACATE" });

    expect((await abacateNotice("pix_char_1", "wrong-secret-wrong-secret-wrong-secret")).status).toBe(401);
    expect((await abacateNotice("pix_char_1", undefined, "Zm9yZ2Vk")).status).toBe(401);
    expect(await (await abacateNotice("pix_char_1")).json()).toEqual({ ok: true });
    expect((await stored(id)).status).toBe("pending");

    const charge = { id: "pix_char_1", amount: 9700, status: "PAID", devMode: false, brCode: "x" };
    server.routes["GET /v2/transparents/list"] = { status: 200, body: { data: [charge], success: true, error: null } };
    await checkCharges();
    await abacateNotice("pix_char_1");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect(await payments(id)).toBe(1);

    server.routes["GET /v2/transparents/list"] = {
      status: 200,
      body: { data: [{ ...charge, status: "REFUNDED" }], success: true, error: null },
    };
    await abacateNotice("pix_char_1");
    await checkCharges();
    expect((await stored(id)).status).toBe("refunded");
  });

  test("AbacatePay: a test-mode charge or a smaller amount never releases a production order", async () => {
    await use("abacatepay", "abc_prod_key", "abacate-webhook-secret-with-32-chars!");
    const dev = await buy({ email: "abacate-dev@example.com" });
    const short = await buy({ email: "abacate-short@example.com" });
    await db().update(order).set({ psp: "abacatepay", txid: "pix_char_dev" }).where(eq(order.id, dev));
    await db().update(order).set({ psp: "abacatepay", txid: "pix_char_short" }).where(eq(order.id, short));
    server.routes["GET /v2/transparents/list"] = {
      status: 200,
      body: {
        data: [
          { id: "pix_char_dev", amount: 9700, status: "PAID", devMode: true },
          { id: "pix_char_short", amount: 5000, status: "PAID", devMode: false },
        ],
      },
    };
    await abacateNotice("pix_char_dev");
    await abacateNotice("pix_char_short");
    await checkCharges();
    expect((await stored(dev)).status).toBe("pending");
    expect((await stored(short)).status).toBe("pending");
  });

  const DEPIX_SECRET = "depix-webhook-secret-with-32-chars!!";

  function depixNotice(qrId: string, secret = DEPIX_SECRET) {
    return paymentWebhook(
      new Request("https://shop.example/api/webhooks/payment?psp=depix", {
        method: "POST",
        body: JSON.stringify({ webhookType: "deposit", qrId, status: "approved", valueInCents: 9700 }),
        headers: { authorization: `Basic ${secret}` },
      }),
    );
  }

  function depixStatus(qrId: string, status: string) {
    server.routes["GET /api/deposit-status"] = {
      status: 200,
      body: {
        response: { qrId, status, valueInCents: 9700, expiration: new Date(Date.now() + 3_600_000).toISOString() },
        async: false,
      },
    };
  }

  test("DePix: login, deposit, polling while open, forged notices, release once, refund revokes", async () => {
    await use("depix", "depix-client-secret", DEPIX_SECRET, { clientId: "depix-client" });
    const id = await buy({ email: "depix@example.com" });
    server.routes["POST /api/v2/auth/login"] = { status: 200, body: { access_token: "depix-token", expires_in: 900 } };
    server.routes["POST /api/deposit"] = {
      status: 200,
      body: { response: { id: "dep_1", qrCopyPaste: "00020126DEPIX", qrImageUrl: "" }, async: false },
    };
    await attachCharges();
    const login = JSON.parse(server.to("POST", "/api/v2/auth/login")[0]?.body ?? "{}");
    expect(login).toEqual({ client_id: "depix-client", client_secret: "depix-client-secret" });
    const created = server.to("POST", "/api/deposit")[0];
    expect(created?.headers["authorization"]).toBe("Bearer depix-token");
    expect(JSON.parse(created?.body ?? "{}")).toMatchObject({ amountInCents: 9700 });
    const attached = await stored(id);
    expect(attached).toMatchObject({ psp: "depix", txid: "dep_1", pixCode: "00020126DEPIX" });
    expect(attached.pspCheckAt).not.toBeNull();

    expect((await depixNotice("dep_1", "wrong-secret-wrong-secret-wrong-secret")).status).toBe(401);
    expect(await (await depixNotice("dep_1")).json()).toEqual({ ok: true });

    depixStatus("dep_1", "pending");
    await due(id);
    await checkCharges();
    const open = await stored(id);
    expect(open.status).toBe("pending");
    expect(open.pspCheckAt?.getTime()).toBeGreaterThan(Date.now());

    depixStatus("dep_other", "approved");
    await due(id);
    await checkCharges();
    expect((await stored(id)).status).toBe("pending");

    depixStatus("dep_1", "approved");
    await due(id);
    await checkCharges();
    await due(id);
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect(server.to("POST", "/api/v2/auth/login")).toHaveLength(1);

    depixStatus("dep_1", "refunded");
    await depixNotice("dep_1");
    await due(id);
    await checkCharges();
    expect((await stored(id)).status).toBe("refunded");
  });

  function noxNotice(end2end: string, secret = "nox-webhook-secret") {
    const raw = JSON.stringify({ webhook_version: "v2", end2end, status: { en: "Success" } });
    return paymentWebhook(
      new Request("https://shop.example/api/webhooks/payment?psp=noxpay", {
        method: "POST",
        body: raw,
        headers: { "x-signature": createHmac("sha256", secret).update(raw).digest("base64") },
      }),
    );
  }

  function noxCheckout(end2end: string, status: string, amount: number | string = 97) {
    server.routes["GET /v2/crossramp_checkout/NOXabc123"] = {
      status: 200,
      body: { end2end, status: { en: status }, attributes: { amount_payment: amount } },
    };
  }

  test("NoxPay: hosted link, signed notice, only a re-fetched paid checkout releases", async () => {
    await use("noxpay", "nox-api-key", "nox-webhook-secret", { currency: "TRX_USDT_S2UZ" });
    const id = await buy({ email: "nox@example.com" });
    server.routes["POST /v2/crossramp_checkout"] = {
      status: 200,
      body: { link: "https://checkout.noxpay.io/e2e/NOXabc123" },
    };
    await attachCharges();
    const created = server.to("POST", "/v2/crossramp_checkout")[0];
    expect(created?.headers["api-key"]).toBe("nox-api-key");
    const body = JSON.parse(created?.body ?? "{}");
    expect(body).toMatchObject({ currency_code: "TRX_USDT_S2UZ", amount_fiat: 97 });
    expect(body.webhook).toMatch(/\/api\/webhooks\/payment\?psp=noxpay$/);
    expect(await stored(id)).toMatchObject({ psp: "noxpay", txid: "NOXabc123" });
    const slug = one(await db().select({ product: order.product }).from(order).where(eq(order.id, id))).product;
    expect((await getPixOrder(id, slug))?.payUrl).toBe("https://checkout.noxpay.io/e2e/NOXabc123");

    expect((await noxNotice("NOXabc123", "forged")).status).toBe(401);
    noxCheckout("NOXabc123", "Pending");
    expect(await (await noxNotice("NOXabc123")).json()).toEqual({ ok: true });
    await checkCharges();
    expect((await stored(id)).status).toBe("pending");

    noxCheckout("NOXother", "Success");
    await noxNotice("NOXabc123");
    await checkCharges();
    expect((await stored(id)).status).toBe("pending");

    noxCheckout("NOXabc123", "Success", "97.00");
    await noxNotice("NOXabc123");
    await checkCharges();
    await noxNotice("NOXabc123");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect(await payments(id)).toBe(1);
  });

  test("NoxPay: a link outside NoxPay's checkout keeps the static Pix", async () => {
    await use("noxpay", "nox-api-key", "nox-webhook-secret", { currency: "BTC" });
    const id = await buy({ email: "nox-link@example.com" });
    server.routes["POST /v2/crossramp_checkout"] = { status: 200, body: { link: "https://evil.example/e2e/NOXabc" } };
    await attachCharges();
    expect((await stored(id)).psp).toBeNull();
  });

  const WALLET = "0x52908400098527886E0F7030069857D2E4169EE7";

  function stablecoinRoutes(status = 200) {
    server.routes["POST /api/v1/stablecoin/deposit"] = { status, body: { status: "PENDING", depositId: "d1" } };
    server.routes["POST /api/v1/stablecoin/deposit/approve"] = { status: 200, body: { status: "PROCESSING" } };
  }

  async function wooviFields() {
    return (await credentials("woovi"))("woovi");
  }

  test("Woovi to crypto: the balance is swept above R$ 50 at most once an hour", async () => {
    await use("woovi", "woovi-app-id", "");
    await saveCredentials("woovi", { convertMode: "balance", convertAsset: "USDT:POLYGON", convertWallet: WALLET });
    server.routes["GET /api/v1/account/"] = {
      status: 200,
      body: {
        accounts: [
          { isDefault: false, balance: { available: 99_999 } },
          { isDefault: true, balance: { available: 4000 } },
        ],
      },
    };
    stablecoinRoutes();
    await convertToCrypto();
    expect(server.to("POST", "/api/v1/stablecoin/deposit")).toHaveLength(0);

    await saveCredentials("woovi", { convertNextAt: "" });
    server.routes["GET /api/v1/account/"] = {
      status: 200,
      body: { accounts: [{ isDefault: true, balance: { available: 12_000 } }] },
    };
    await convertToCrypto();
    const deposit = JSON.parse(server.to("POST", "/api/v1/stablecoin/deposit")[0]?.body ?? "{}");
    expect(deposit).toMatchObject({
      value: 12_000,
      currency: "USDT",
      network: "POLYGON",
      destinationWalletAddress: WALLET,
    });
    const approve = JSON.parse(server.to("POST", "/api/v1/stablecoin/deposit/approve")[0]?.body ?? "{}");
    expect(approve).toEqual({ correlationId: deposit.correlationId });
    expect(Number((await wooviFields())("convertNextAt"))).toBeGreaterThan(Date.now() + 3_000_000);

    await convertToCrypto();
    expect(server.to("POST", "/api/v1/stablecoin/deposit")).toHaveLength(1);
  });

  test("Woovi to crypto: each paid sale after it was turned on converts once, net of the Pix fee", async () => {
    await use("woovi", "woovi-app-id", "");
    const before = await buy({ email: "crypto-before@example.com" });
    await db()
      .update(order)
      .set({ status: "paid", psp: "woovi", createdAt: new Date(Date.now() - 60_000) })
      .where(eq(order.id, before));
    await saveCredentials("woovi", {
      convertMode: "sale",
      convertAsset: "USDC:BASE",
      convertWallet: WALLET,
      convertSince: String(Date.now()),
    });
    const sale = await buy({ email: "crypto-sale@example.com" });
    const open = await buy({ email: "crypto-open@example.com" });
    await db().update(order).set({ status: "paid", psp: "woovi" }).where(eq(order.id, sale));
    await db().update(order).set({ psp: "woovi" }).where(eq(order.id, open));
    server.routes[`GET /api/v1/charge/${sale}`] = {
      status: 200,
      body: { charge: { correlationID: sale, paymentMethods: { pix: { fee: 78 } } } },
    };

    stablecoinRoutes(400);
    server.routes["POST /api/v1/stablecoin/deposit/approve"] = { status: 400, body: { error: "deposit not found" } };
    await convertToCrypto();
    expect((await wooviFields())("convertError")).toBe("CRYPTO_REFUSED");
    expect(one(await db().select({ at: order.cryptoAt }).from(order).where(eq(order.id, sale))).at).toBeNull();

    await saveCredentials("woovi", { convertNextAt: "" });
    stablecoinRoutes();
    await convertToCrypto();
    expect((await wooviFields())("convertError")).toBe("");
    const deposits = server.to("POST", "/api/v1/stablecoin/deposit").map((entry) => JSON.parse(entry.body));
    expect(deposits.at(-1)).toMatchObject({
      value: 9622,
      currency: "USDC",
      network: "BASE",
      correlationId: `librefunnel-${sale}`,
    });
    expect(deposits.every((entry) => entry.correlationId === `librefunnel-${sale}`)).toBe(true);

    const count = deposits.length;
    await convertToCrypto();
    expect(server.to("POST", "/api/v1/stablecoin/deposit")).toHaveLength(count);
  });

  test("Woovi to crypto: turning it on checks the wallet and the AppID permission", async () => {
    await signInAsAdmin();
    await use("woovi", "woovi-app-id", "");
    const save = (fields: Record<string, string>) => saveWooviCrypto({ code: null }, form(fields));
    expect(await save({ mode: "sale", asset: "USDT:TRON", wallet: WALLET })).toEqual({ code: "INVALID_WALLET" });
    server.routes["GET /api/v1/stablecoin/quote"] = { status: 401, body: { error: "missing scope" } };
    expect(await save({ mode: "sale", asset: "USDT:POLYGON", wallet: WALLET })).toEqual({ code: "PSP_REJECTED" });
    expect((await wooviFields())("convertMode")).toBe("");
    server.routes["GET /api/v1/stablecoin/quote"] = { status: 200, body: { status: "ok" } };
    expect(await save({ mode: "sale", asset: "USDT:POLYGON", wallet: WALLET })).toMatchObject({ code: null });
    expect((await wooviFields())("convertSince")).not.toBe("");
    expect(await save({ mode: "off" })).toMatchObject({ code: null });
    expect((await wooviFields())("convertMode")).toBe("off");
  });

  async function asAbacate(email: string, txid: string) {
    await use("abacatepay", "abc_prod_key", "abacate-webhook-secret-with-32-chars!");
    const id = await buy({ email });
    await db().update(order).set({ psp: "abacatepay", txid }).where(eq(order.id, id));
    return id;
  }

  function abacateState(id: string, status: "PENDING" | "PAID" | "REFUNDED", headers?: Record<string, string>) {
    server.routes["GET /v2/transparents/list"] = {
      status: 200,
      headers,
      body: { data: [{ id, amount: 9700, status, devMode: false }] },
    };
  }

  test("provider: duplicated and concurrent notices release once", async () => {
    const id = await asAbacate("dup-notice@example.com", "pix_dup");
    abacateState("pix_dup", "PAID");
    await Promise.all([abacateNotice("pix_dup"), abacateNotice("pix_dup"), abacateNotice("pix_dup")]);
    await Promise.all([checkCharges(), checkCharges()]);
    await abacateNotice("pix_dup");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect(await payments(id)).toBe(1);
    expect(await accessMessages(id)).toBe(1);
    expect(await purchases(id)).toBe(1);
  });

  test("provider: out-of-order notices follow the provider's current state, not the notice", async () => {
    const late = await asAbacate("late-notice@example.com", "pix_late");
    abacateState("pix_late", "REFUNDED");
    await abacateNotice("pix_late");
    await checkCharges();
    expect((await stored(late)).status).toBe("pending");
    expect(await accessMessages(late)).toBe(0);

    const stale = await asAbacate("stale-notice@example.com", "pix_stale");
    abacateState("pix_stale", "PAID");
    await abacateNotice("pix_stale");
    await checkCharges();
    abacateState("pix_stale", "REFUNDED");
    await abacateNotice("pix_stale");
    await checkCharges();
    await abacateNotice("pix_stale");
    await checkCharges();
    expect((await stored(stale)).status).toBe("refunded");
    expect(await accessMessages(stale)).toBe(1);
  });

  test("provider: a notice is not lost when the re-fetch fails or is rate limited", async () => {
    const id = await asAbacate("busy-notice@example.com", "pix_busy");
    server.routes["GET /v2/transparents/list"] = { status: 503, body: { error: "unavailable" } };
    await abacateNotice("pix_busy");
    await checkCharges();
    expect((await stored(id)).pspCheckAt?.getTime()).toBeGreaterThan(Date.now());

    server.routes["GET /v2/transparents/list"] = { status: 429, headers: { "retry-after": "120" }, body: {} };
    await due(id);
    await checkCharges();
    expect((await stored(id)).pspCheckAt?.getTime()).toBe(Date.now() + 120_000);
    await abacateNotice("pix_busy");
    expect((await stored(id)).pspCheckAt?.getTime()).toBe(Date.now());

    abacateState("pix_busy", "PAID");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");
    expect(await accessMessages(id)).toBe(1);
  });

  test("Mercado Pago: each partial refund is debited by its own amount and revokes", async () => {
    await use("mercadopago", "APP_USR-test", "mp-secret");
    const id = await buy({ email: "mp-partial@example.com" });
    await db().update(order).set({ psp: "mercadopago", txid: "ORDPR" }).where(eq(order.id, id));

    const paid = {
      id: "ORDPR",
      status: "processed",
      status_detail: "accredited",
      external_reference: id,
      total_amount: "97.00",
      total_paid_amount: "97.00",
      transactions: { payments: [{ id: "PAYPR", status: "processed" }] },
    };

    server.routes["GET /v1/orders/ORDPR"] = { status: 200, body: paid };
    await mpNotice("ORDPR");
    await checkCharges();
    expect((await stored(id)).status).toBe("paid");

    const refund = (refunds: object[]) => ({
      ...paid,
      status_detail: "partially_refunded",
      transactions: { ...paid.transactions, refunds },
    });

    server.routes["GET /v1/orders/ORDPR"] = {
      status: 200,
      body: refund([
        { id: "R1", amount: "20.00", status: "processed" },
        { id: "R0", amount: "50.00", status: "rejected" },
      ]),
    };
    await mpNotice("ORDPR");
    await checkCharges();
    expect((await stored(id)).status).toBe("refunded");
    expect(await net(id)).toBe(7700);

    server.routes["GET /v1/orders/ORDPR"] = {
      status: 200,
      body: {
        ...refund([
          { id: "R1", amount: "20.00", status: "processed" },
          { id: "R2", amount: "77.00", status: "processed" },
        ]),
        status: "refunded",
      },
    };
    await mpNotice("ORDPR");
    await checkCharges();
    expect(await net(id)).toBe(0);
  });

  test("DePix: a token revoked before it expires is replaced by one new login", async () => {
    await use("depix", "depix-client-secret", DEPIX_SECRET, { clientId: "depix-client" });
    const id = await buy({ email: "depix-401@example.com" });
    await db().update(order).set({ psp: "depix", txid: "dep_401" }).where(eq(order.id, id));
    server.routes["POST /api/v2/auth/login"] = { status: 200, body: { access_token: "fresh-token", expires_in: 900 } };
    server.routes["GET /api/deposit-status"] = { status: 401, body: {} };
    await depixNotice("dep_401");
    await checkCharges();
    expect(server.to("POST", "/api/v2/auth/login")).toHaveLength(1);
    expect(server.to("GET", "/api/deposit-status")).toHaveLength(2);
    expect((await stored(id)).pspCheckAt?.getTime()).toBeGreaterThan(Date.now());
  });

  test("Woovi to crypto: a conversion approved on an earlier run is not retried forever", async () => {
    await use("woovi", "woovi-app-id", "");
    await saveCredentials("woovi", {
      convertMode: "sale",
      convertAsset: "USDT:POLYGON",
      convertWallet: WALLET,
      convertSince: String(Date.now()),
    });
    const sale = await buy({ email: "crypto-again@example.com" });
    await db().update(order).set({ status: "paid", psp: "woovi" }).where(eq(order.id, sale));
    server.routes[`GET /api/v1/charge/${sale}`] = { status: 200, body: { charge: { correlationID: sale } } };
    stablecoinRoutes();
    server.routes["POST /api/v1/stablecoin/deposit/approve"] = {
      status: 400,
      body: { error: "Stablecoin cashout already completed", correlationId: `librefunnel-${sale}` },
    };
    await convertToCrypto();
    expect((await wooviFields())("convertError")).toBe("");
    expect(one(await db().select({ at: order.cryptoAt }).from(order).where(eq(order.id, sale))).at).not.toBeNull();
  });

  test("provider: with every webhook lost, reconciliation still releases, then catches a MED during its window", async () => {
    const start = new Date();
    const id = await asAbacate("lost-notice@example.com", "pix_lost");
    await db()
      .update(order)
      .set({ pspCheckAt: new Date(start.getTime() + 300_000) })
      .where(eq(order.id, id));
    abacateState("pix_lost", "PAID");
    try {
      setSystemTime(new Date(start.getTime() + 301_000));
      await checkCharges();
      const paid = await stored(id);
      expect(paid.status).toBe("paid");
      expect(paid.pspCheckAt).toEqual(new Date(start.getTime() + 86_400_000));

      abacateState("pix_lost", "REFUNDED");
      setSystemTime(new Date(start.getTime() + 86_401_000));
      await checkCharges();
      const revoked = await stored(id);
      expect(revoked.status).toBe("refunded");
      expect(revoked.pspCheckAt).toBeNull();
      expect(await accessMessages(id)).toBe(1);
    } finally {
      setSystemTime(start);
    }
  });

  test("a provider webhook is a 404 until its keys are saved", async () => {
    expect((await abacateNotice("pix_char_1")).status).toBe(404);
    expect((await mpNotice("ORD01")).status).toBe(404);
  });
});
