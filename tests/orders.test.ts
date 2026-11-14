import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createOrder, releaseOrder, rotateWebhookSecret } from "@/lib/actions";
import { pixKey, removeCredentials, saveCredentials } from "@/lib/catalog";
import { db, one } from "@/lib/db";
import { attachCharges, brCode, checkCharges, expireOrders, getPixOrder, refreshWebhookKeys } from "@/lib/orders";
import { conversion, customer, message, order, payment, product } from "@/lib/schema";
import { POST as paymentWebhook } from "@/app/api/webhooks/payment/route";
import { fakeServer, form, freshBrowser, WEBHOOK_SECRET } from "./fakes";
import { buy, pay, signInAsAdmin, webhook } from "./flows";

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
    const pix = await getPixOrder(id, "metodo-demo");
    expect(pix?.pixCode).toContain("540597.00");
    expect(pix?.pixCode).toContain(`0520${id}`);
    expect(pix?.txid).toBe(id);
    expect(pix?.maskedEmail).toBe("a***@example.com");
    expect(await getPixOrder(id, "planilha-metas")).toBeUndefined();
    expect(await getPixOrder("../etc", "metodo-demo")).toBeUndefined();
  });

  test("keys are normalized to the DICT formats", () => {
    expect(pixKey("+55 (48) 99999-0000")).toBe("+5548999990000");
    expect(pixKey("123.456.789-09")).toBe("12345678909");
    expect(pixKey("48999990000")).toBeUndefined();
    expect(pixKey("Shop@Example.com")).toBe("shop@example.com");
    expect(pixKey("123E4567-E12B-12D1-A456-426655440000")).toBe("123e4567-e12b-12d1-a456-426655440000");
    expect(pixKey("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
  });
});

describe("createOrder", () => {
  test("prices come from the catalog, never from the form", async () => {
    const id = await buy({ price: "1", amount: "1", bump_price: "1", bump: "1" });
    expect(await stored(id)).toMatchObject({ productAmount: 9700, bump: "planilha-metas", amount: 9700 + 1990 });
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
      db().update(product).set({ offerEndsAt: at }).where(eq(product.slug, "metodo-demo"));

    await setOfferEnd(new Date("2026-11-30T23:59:00-03:00"));
    vi.setSystemTime(new Date("2026-12-01T00:00:00-03:00"));

    const result = await createOrder(
      { code: null },
      form({ slug: "metodo-demo", name: "Ana Souza", email: "closed@example.com" }),
    );

    vi.setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
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
      expect((await createOrder({ code: null }, form({ slug: "metodo-demo", name: "Ana", email }))).code).toBe(
        "INVALID_EMAIL",
      );
    }
    expect(
      (await createOrder({ code: null }, form({ slug: "metodo-demo", name: "Ana", email: "a@x.com", phone: "123" })))
        .code,
    ).toBe("INVALID_PHONE");
    expect(
      (
        await createOrder(
          { code: null },
          form({ slug: "metodo-demo", name: "https://scam.example/pix Silva", email: "a@x.com" }),
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
      form({ slug: "metodo-demo", name: "Ana Souza", email: "batch99@example.com" }),
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
    vi.setSystemTime(new Date("2026-11-17T13:00:00-03:00"));
    await expireOrders();
    expect((await stored(id)).status).toBe("expired");
    expect((await getPixOrder(id, "metodo-demo"))?.status).toBe("expired");
    await pay(id);
    vi.setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
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
  const realFetch = globalThis.fetch;
  const woovi = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forger = generateKeyPairSync("rsa", { modulusLength: 2048 });

  beforeEach(async () => {
    server = await fakeServer({});
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
      realFetch(input.replace(/^https:\/\/api\.(mercadopago|woovi|abacatepay)\.com/, server.url), init),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const kind of ["mercadopago", "woovi", "abacatepay"] as const) await removeCredentials(kind);
    await saveCredentials("pix", { provider: "static" });
    await server.close();
  });

  async function use(psp: "mercadopago" | "woovi" | "abacatepay", apiKey: string, webhookSecret: string) {
    await saveCredentials(psp, {}, { apiKey, webhookSecret });
    await saveCredentials("pix", { provider: psp });
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
    expect(await stored(id)).toMatchObject({ status: "pending", pspCheckAt: null });

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

  test("Mercado Pago: a 429 waits the Retry-After seconds before checking again", async () => {
    await use("mercadopago", "APP_USR-test", "mp-secret");
    const id = await buy({ email: "mp429@example.com" });
    await db().update(order).set({ psp: "mercadopago", txid: "ORD429" }).where(eq(order.id, id));
    server.routes["GET /v1/orders/ORD429"] = {
      status: 429,
      body: { error: "too_many_requests" },
      headers: { "Retry-After": "120" },
    };
    await mpNotice("ORD429");
    await checkCharges();
    expect((await stored(id)).pspCheckAt).toEqual(new Date(Date.now() + 120_000));
    await mpNotice("ORD429");
    expect((await stored(id)).pspCheckAt).toEqual(new Date(Date.now() + 120_000));
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

  test("a provider webhook is a 404 until its keys are saved", async () => {
    expect((await abacateNotice("pix_char_1")).status).toBe(404);
    expect((await mpNotice("ORD01")).status).toBe(404);
  });
});
