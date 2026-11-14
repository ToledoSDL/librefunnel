import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createHmac } from "node:crypto";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  connectWhatsApp,
  optOut,
  saveCloud,
  saveEvolution,
  saveSettings,
  saveSmtp,
  sendReply,
  testConnection,
} from "@/lib/actions";
import { removeCredentials, saveCredentials } from "@/lib/catalog";
import { inbox, integrations } from "@/lib/dashboard";
import type { Conversation } from "@/lib/dashboard";
import { db, one } from "@/lib/db";
import { derive } from "@/lib/guard";
import { cloudVerify, cloudWebhook, optOutLink, queueRecovery, refreshPhotos, sendMessages } from "@/lib/messages";
import { contact, message, order } from "@/lib/schema";
import { GRAPH } from "@/lib/tracking";
import { POST as botWebhook } from "@/app/api/webhooks/whatsapp/route";
import { fakeServer, form, freshBrowser, mailFailures, mailTransports, sentMail } from "./fakes";
import { buy, pay, signInAsAdmin, webhook } from "./flows";

let evolution: Awaited<ReturnType<typeof fakeServer>>;
let ip = 0;

beforeAll(async () => {
  evolution = await fakeServer({});
  process.env.EVOLUTION_URL = evolution.url;
  process.env.EVOLUTION_KEY = "evolution-key";
  await saveCredentials(
    "smtp",
    { host: "smtp.test", port: "587", user: "shop@example.com", from: "" },
    { password: "smtp-password" },
  );
});

afterAll(() => evolution.close());

beforeEach(() => {
  ip += 1;
  freshBrowser(`203.0.113.${ip}`);
  vi.setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
  evolution.requests.length = 0;
  sentMail.length = 0;
  for (const route of Object.keys(evolution.routes)) delete evolution.routes[route];
  evolution.routes["GET /instance/connectionState/librefunnel"] = {
    status: 200,
    body: { instance: { instanceName: "librefunnel", state: "open" } },
  };
  evolution.routes["POST /message/sendText/librefunnel"] = {
    status: 201,
    body: { key: { id: "WAMSG1", remoteJid: "x", fromMe: true } },
  };
});

function at(time: string) {
  vi.setSystemTime(new Date(`2026-11-14T${time}:00-03:00`));
}

function messagesOf(id: string) {
  return db()
    .select({
      kind: message.kind,
      channel: message.channel,
      step: message.step,
      status: message.status,
      error: message.error,
      attempts: message.attempts,
      nextAt: message.nextAt,
      body: message.body,
    })
    .from(message)
    .where(eq(message.orderId, id))
    .orderBy(asc(message.id));
}

function bot(payload: object, key = derive("bot")) {
  return botWebhook(
    new Request(`https://shop.example/api/webhooks/whatsapp?k=${key}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
}

function inbound(text: string, from = "5548999990000", id = `IN${Math.random()}`) {
  return bot({
    event: "messages.upsert",
    instance: "librefunnel",
    data: {
      key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id },
      message: { conversation: text },
      messageType: "conversation",
    },
  });
}

describe("recovery", () => {
  test("runs the sequence by channel and stops once paid", async () => {
    const order = await buy({ email: "recovery@example.com" });
    at("12:16");
    await Promise.all([queueRecovery(), queueRecovery()]);
    await Promise.all([sendMessages(), sendMessages()]);
    const sends = evolution.to("POST", "/message/sendText/librefunnel");
    expect(sends.length).toBe(1);
    expect(sends[0]?.headers["apikey"]).toBe("evolution-key");
    const sent = JSON.parse(sends[0]?.body ?? "{}");
    expect(sent.number).toBe("5548999990000");
    expect(sent.text).toContain(`https://shop.example/c/metodo-demo?order=${order}`);
    expect(sent.text).toContain("Oi Ana!");
    at("16:01");
    await queueRecovery();
    await sendMessages();
    expect(sentMail[0]?.subject).toBe("Seu acesso ao Método Demo: do zero à primeira venda está reservado");
    expect(sentMail[0]?.text).toContain("https://shop.example/m?unsubscribe=");
    await pay(order);
    vi.setSystemTime(new Date("2026-11-15T12:30:00-03:00"));
    await queueRecovery();
    expect((await messagesOf(order)).filter((row) => row.kind === "recovery").map((row) => row.step)).toEqual([0, 1]);
  });

  test("WhatsApp recovery waits for 09:00 during quiet hours", async () => {
    at("20:55");
    const order = await buy({ email: "night@example.com" });
    at("21:11");
    await queueRecovery();
    await sendMessages();

    const forOrder = () =>
      evolution.to("POST", "/message/sendText/librefunnel").filter((entry) => entry.body.includes(order));

    expect(forOrder().length).toBe(0);
    const [row] = await messagesOf(order);
    expect(row).toMatchObject({ status: "queued", attempts: 0, nextAt: new Date("2026-11-15T09:00:00-03:00") });
    vi.setSystemTime(new Date("2026-11-15T09:00:30-03:00"));
    await sendMessages();
    expect(forOrder().length).toBe(1);
  });

  test("skips buyers who already own the product, opted out, or hit the daily cap", async () => {
    const owned = await buy({ email: "owner@example.com", phone: "11988887777" });
    await pay(owned);
    freshBrowser("203.0.113.240");
    const again = await buy({ email: "owner@example.com", phone: "11988887777" });
    await inbound("Sair", "554899990000");
    const out = await buy({ email: "optedout@example.com" });
    const capped = await buy({ email: "capped@example.com", phone: "21977776666" });
    const sentAt = new Date();

    await db()
      .insert(message)
      .values(
        [...Array(300).keys()].map((index): typeof message.$inferInsert => ({
          channel: "whatsapp",
          address: `55119${index}`,
          kind: "reply",
          body: "x",
          status: "sent",
          createdAt: sentAt,
          sentAt,
        })),
      );

    at("12:20");
    await queueRecovery();
    await sendMessages();
    expect((await messagesOf(again))[0]).toMatchObject({ status: "skipped", error: "ALREADY_OWNED" });
    expect((await messagesOf(out))[0]).toMatchObject({ status: "skipped", error: "OPTED_OUT" });
    expect((await messagesOf(capped))[0]).toMatchObject({ status: "skipped", error: "DAILY_CAP" });
    expect(
      one(await db().select({ recoveryAt: order.recoveryAt }).from(order).where(eq(order.id, again))).recoveryAt,
    ).toBeNull();
    await db()
      .delete(message)
      .where(and(eq(message.kind, "reply"), eq(message.body, "x")));
  });

  test("provider failures retry with backoff and never store the provider body", async () => {
    const order = await buy({ email: "failure@example.com", phone: "31966665555" });
    evolution.routes["POST /message/sendText/librefunnel"] = { status: 500, body: { secret: "must-not-leak" } };
    at("12:16");
    await queueRecovery();
    await sendMessages();
    expect((await messagesOf(order))[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      error: "PROVIDER_UNREACHABLE",
      nextAt: new Date("2026-11-14T12:18:00-03:00"),
    });
    expect(JSON.stringify(await messagesOf(order))).not.toContain("must-not-leak");
    for (const minute of ["12:19", "12:24", "12:33", "12:50"]) {
      at(minute);
      await sendMessages();
    }
    expect((await messagesOf(order))[0]).toMatchObject({ status: "failed", attempts: 5 });
  });
});

describe("transactional messages", () => {
  test("access e-mail carries a fresh login link that is never stored", async () => {
    const order = await buy({ email: "access@example.com" });
    await pay(order);
    await sendMessages();
    const mail = sentMail.find((entry) => entry.to === "access@example.com");
    expect(mail?.text).toMatch(/https:\/\/shop\.example\/m\?t=[A-Za-z0-9_-]{43}/);
    const stored = (await messagesOf(order)).find((row) => row.kind === "access");
    expect(stored).toMatchObject({ status: "sent" });
    expect(String(stored?.body)).toContain("{login_link}");
    const whatsapp = JSON.parse(evolution.to("POST", "/message/sendText/librefunnel")[0]?.body ?? "{}");
    expect(whatsapp.text).not.toContain("/m?t=");
    expect(whatsapp.text).toContain("a***@example.com");
  });

  test("unconfigured channels are skipped, not reported as sent", async () => {
    await removeCredentials("smtp");
    const order = await buy({ email: "nosmtp@example.com" });
    await pay(order);
    await sendMessages();
    await saveCredentials(
      "smtp",
      { host: "smtp.test", port: "587", user: "shop@example.com", from: "" },
      { password: "smtp-password" },
    );
    expect((await messagesOf(order)).find((row) => row.kind === "access")).toMatchObject({
      status: "skipped",
      error: "CHANNEL_NOT_CONFIGURED",
    });
  });

  test("an SMTP rejection fails without retry, a timeout retries", async () => {
    const order = await buy({ email: "smtp@example.com", phone: "" });
    await pay(order);
    mailFailures.push(Object.assign(new Error("auth"), { code: "EAUTH", responseCode: 535 }));
    await sendMessages();
    expect((await messagesOf(order)).find((row) => row.kind === "access")).toMatchObject({
      status: "failed",
      error: "SMTP_AUTH_FAILED",
    });
    const other = await buy({ email: "smtp2@example.com", phone: "" });
    await pay(other);
    mailFailures.push(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    await sendMessages();
    expect((await messagesOf(other)).find((row) => row.kind === "access")).toMatchObject({
      status: "queued",
      error: "SMTP_UNREACHABLE",
    });
  });
});

describe("bot", () => {
  test("answers exact keywords only and stores every inbound text", async () => {
    await inbound("QUERO!", "5521911112222");
    await inbound("não quero", "5521911112222");
    await inbound("linkedin", "5521911112222");

    const rows = await db()
      .select({ kind: message.kind, body: message.body })
      .from(message)
      .where(eq(message.address, "5521911112222"))
      .orderBy(asc(message.id));

    expect(rows.map((row) => row.kind)).toEqual(["inbound", "reply", "inbound", "inbound"]);
    expect(rows[1]?.body).toBe("Que bom! Aqui está o link: https://shop.example/v/metodo-demo");
  });

  test("a stranger gets their WhatsApp name, and only WhatsApp's own image hosts are fetched for the photo", async () => {
    await signInAsAdmin();
    await bot({
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5521977771111@s.whatsapp.net", fromMe: false, id: "PROFILE1" },
        pushName: "Bia Souza",
        message: { conversation: "oi" },
      },
    });

    evolution.routes["POST /chat/fetchProfilePictureUrl/librefunnel"] = {
      status: 200,
      body: { profilePictureUrl: `${evolution.url}/stolen.jpg` },
    };

    await refreshPhotos();
    const open = await inbox("all", { channel: "whatsapp", address: "5521977771111" });
    expect(open.thread).toMatchObject({ name: "Bia Souza", photo: null, profile: { orders: [] } });
    expect(evolution.to("GET", "/stolen.jpg").length).toBe(0);
    expect(
      await db().$count(contact, and(eq(contact.address, "5521977771111"), isNotNull(contact.photoCheckedAt))),
    ).toBe(1);
  });

  test("the inbox shows who is waiting, and the seller's reply goes out through the queue", async () => {
    await signInAsAdmin();
    await inbound("já paguei", "5521944445555");
    expect((await inbox("waiting", null)).conversations[0]).toMatchObject({
      channel: "whatsapp",
      address: "5521944445555",
      kind: "inbound",
    });

    const reply = (address: string, text: string) => sendReply({ code: null }, form({ address, text }));

    expect(await reply("5521900001111", "oi")).toEqual({ code: "INVALID_ADDRESS" });
    expect(await reply("5521944445555", "   ")).toEqual({ code: "INVALID_TEXT" });
    expect(await reply("5521944445555", "Confirmado! O acesso está no seu e-mail.")).toEqual({ code: null, ok: true });
    await sendMessages();

    const sent = evolution
      .to("POST", "/message/sendText/librefunnel")
      .find((entry) => entry.body.includes("5521944445555"));

    expect(JSON.parse(sent?.body ?? "{}").text).toBe("Confirmado! O acesso está no seu e-mail.");
    const after = await inbox("waiting", { channel: "whatsapp", address: "5521944445555" });
    expect(after.conversations.some((row) => row.address === "5521944445555")).toBe(false);
    expect(after.thread?.messages.map((row) => [row.kind, row.status])).toEqual([
      ["manual", "sent"],
      ["inbound", "received"],
    ]);
  });

  test("ignores own messages, groups, privacy ids and replays", async () => {
    await bot({
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5521933334444@s.whatsapp.net", fromMe: true, id: "A" },
        message: { conversation: "quero" },
      },
    });
    await bot({
      event: "messages.upsert",
      data: { key: { remoteJid: "123@g.us", fromMe: false, id: "B" }, message: { conversation: "quero" } },
    });
    await bot({
      event: "messages.upsert",
      data: { key: { remoteJid: "999@lid", fromMe: false, id: "C" }, message: { conversation: "quero" } },
    });
    await Promise.all([inbound("oi", "5521933334444", "SAME"), inbound("oi", "5521933334444", "SAME")]);
    expect(await db().$count(message, and(eq(message.kind, "inbound"), eq(message.address, "5521933334444")))).toBe(1);
    expect(await db().$count(message, inArray(message.externalId, ["A", "B", "C"]))).toBe(0);
  });

  test("needs the derived key, and that key cannot sign payments", async () => {
    expect((await bot({ event: "messages.upsert" }, "wrong")).status).toBe(401);
    expect(
      (
        await botWebhook(
          new Request(`https://shop.example/api/webhooks/whatsapp?k=${derive("bot")}`, { method: "POST", body: "[1]" }),
        )
      ).status,
    ).toBe(400);
    const order = await buy({ email: "key@example.com" });
    const body = JSON.stringify({ order, status: "paid", amount: 9700, id: "bot-key" });
    expect((await webhook(body, createHmac("sha256", derive("bot")).update(body).digest("hex"))).status).toBe(401);
  });

  test("delivery receipts move sent messages forward, never back", async () => {
    const order = await buy({ email: "receipt@example.com" });
    await pay(order);
    await sendMessages();
    await bot({ event: "messages.update", data: { keyId: "WAMSG1", status: "READ" } });
    await bot({ event: "messages.update", data: { keyId: "WAMSG1", status: "DELIVERY_ACK" } });
    expect((await messagesOf(order)).find((row) => row.kind === "paid")?.status).toBe("read");
  });

  test("e-mail opt-out link works once signed and refuses tampering", async () => {
    const link = new URL(optOutLink("reader@example.com"));
    const token = link.searchParams.get("unsubscribe") ?? "";
    expect((await optOut({ code: null }, form({ token: `${token}x` }))).code).toBe("LINK_INVALID");
    expect(await optOut({ code: null }, form({ token }))).toEqual({ code: null, ok: true });
    expect(
      await db().$count(contact, and(eq(contact.address, "reader@example.com"), isNotNull(contact.optedOutAt))),
    ).toBe(1);
  });
});

describe("WhatsApp connection", () => {
  test("creates the instance once, registers the webhook and returns QR and pairing code", async () => {
    evolution.routes["GET /instance/connectionState/librefunnel"] = { status: 404, body: { status: 404 } };
    evolution.routes["POST /instance/create"] = {
      status: 201,
      body: { instance: { instanceName: "librefunnel" }, hash: "h" },
    };
    evolution.routes["POST /webhook/set/librefunnel"] = { status: 201, body: {} };
    evolution.routes["GET /instance/connect/librefunnel"] = {
      status: 200,
      body: { pairingCode: "WZYX1234", code: "2@abc", base64: "data:image/png;base64,QUJD", count: 1 },
    };
    await signInAsAdmin();
    expect(await connectWhatsApp()).toEqual({ code: null, qr: "data:image/png;base64,QUJD", pairingCode: "WZYX1234" });
    expect(JSON.parse(evolution.to("POST", "/instance/create")[0]?.body ?? "{}").instanceName).toBe("librefunnel");
    const hook = JSON.parse(evolution.to("POST", "/webhook/set/librefunnel")[0]?.body ?? "{}");
    expect(hook.webhook.url).toBe(`https://shop.example/api/webhooks/whatsapp?k=${derive("bot")}`);
    evolution.routes["GET /instance/connectionState/librefunnel"] = {
      status: 200,
      body: { instance: { state: "connecting" } },
    };
    await connectWhatsApp();
    expect(evolution.to("POST", "/instance/create").length).toBe(1);
    freshBrowser();
    expect((await connectWhatsApp()).code).toBe("NOT_SIGNED_IN");
  });
});

describe("connections in the panel", () => {
  test("SMTP saved in the panel is used on the next send, and the test checks login before mailing the owner", async () => {
    await signInAsAdmin();
    expect(
      (
        await saveSmtp(
          { code: null },
          form({ preset: "", host: "https://smtp.x", port: "587", user: "a@b.com", password: "p" }),
        )
      ).code,
    ).toBe("INVALID_HOST");
    expect(
      (
        await saveSmtp(
          { code: null },
          form({ preset: "", host: "smtp.x.com", port: "70000", user: "a@b.com", password: "p" }),
        )
      ).code,
    ).toBe("INVALID_PORT");
    expect(
      (await saveSmtp({ code: null }, form({ preset: "gmail", user: "seller@gmail.com", password: "abcd efgh" }))).code,
    ).toBe("INVALID_CREDENTIAL");
    expect(
      await saveSmtp({ code: null }, form({ preset: "gmail", user: "seller@gmail.com", password: "abcdefghijklmnop" })),
    ).toEqual({ code: null, ok: true });
    mailTransports.length = 0;
    const order = await buy({ email: "panel-smtp@example.com", phone: "" });
    await pay(order);
    await sendMessages();
    expect(mailTransports[0]).toMatchObject({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "seller@gmail.com", pass: "abcdefghijklmnop" },
    });

    expect(
      await saveSmtp(
        { code: null },
        form({ preset: "", host: "smtp-relay.brevo.com", port: "465", user: "seller@gmail.com", password: "" }),
      ),
    ).toEqual({ code: null, ok: true });
    await saveSettings({ code: null }, form({ brand: "Loja", ownerEmail: "", orderHours: "72" }));
    mailFailures.push(Object.assign(new Error("auth"), { code: "EAUTH", responseCode: 535 }));
    expect((await testConnection({ code: null }, form({ kind: "smtp" }))).code).toBe("SMTP_AUTH_FAILED");
    expect((await testConnection({ code: null }, form({ kind: "smtp" }))).code).toBe("OWNER_ADDRESS_MISSING");
    await saveSettings({ code: null }, form({ brand: "Loja", ownerEmail: "dono@example.com", orderHours: "72" }));
    sentMail.length = 0;
    expect(await testConnection({ code: null }, form({ kind: "smtp" }))).toEqual({ code: null, ok: true });
    expect(sentMail[0]?.to).toBe("dono@example.com");
    expect(mailTransports.at(-1)).toMatchObject({
      host: "smtp-relay.brevo.com",
      port: 465,
      secure: true,
      auth: { pass: "abcdefghijklmnop" },
    });
    await saveCredentials(
      "smtp",
      { host: "smtp.test", port: "587", user: "shop@example.com", from: "" },
      { password: "smtp-password" },
    );
  });

  test("an Evolution saved in the panel overrides the bundled one, and a blank address goes back to it", async () => {
    const external = await fakeServer({
      "GET /instance/connectionState/librefunnel": { status: 401, body: { error: "Unauthorized" } },
    });

    await signInAsAdmin();
    expect((await saveEvolution({ code: null }, form({ url: "evolution.example", key: "k" }))).code).toBe(
      "INVALID_EVOLUTION_URL",
    );
    expect((await saveEvolution({ code: null }, form({ url: external.url, key: "" }))).code).toBe("INVALID_CREDENTIAL");
    expect(await saveEvolution({ code: null }, form({ url: external.url, key: "external-key" }))).toEqual({
      code: null,
      ok: true,
    });
    expect((await testConnection({ code: null }, form({ kind: "evolution" }))).code).toBe("PROVIDER_REJECTED");
    expect(external.requests[0]?.headers["apikey"]).toBe("external-key");
    expect(await saveEvolution({ code: null }, form({ url: "", key: "" }))).toEqual({ code: null, ok: true });
    await saveSettings({ code: null }, form({ brand: "Loja", ownerWhatsapp: "48999990000", orderHours: "72" }));
    expect(await testConnection({ code: null }, form({ kind: "evolution" }))).toEqual({ code: null, ok: true });
    expect(evolution.to("POST", "/message/sendText/librefunnel")[0]?.headers["apikey"]).toBe("evolution-key");
    await external.close();
  });
});

describe("official WhatsApp", () => {
  const realFetch = globalThis.fetch;
  const APP_SECRET = "0123456789abcdef0123456789abcdef";
  const TOKEN = "EAAG-system-user-token";
  let graph: Awaited<ReturnType<typeof fakeServer>>;
  const path = (rest: string) => `${new URL(GRAPH).pathname}/${rest}`;

  beforeAll(async () => {
    graph = await fakeServer({});
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
      realFetch(input.replace("https://graph.facebook.com", graph.url), init),
    );
  });

  afterAll(async () => {
    vi.stubGlobal("fetch", realFetch);
    await removeCredentials("whatsapp");
    await graph.close();
  });

  beforeEach(() => {
    graph.requests.length = 0;
    graph.routes[`POST ${path("1234567890/messages")}`] = { status: 200, body: { messages: [{ id: "wamid.OUT1" }] } };
    graph.routes[`GET ${path("1234567890")}`] = { status: 200, body: { display_phone_number: "+55 48 99999-0000" } };

    graph.routes[`GET ${path("debug_token")}`] = {
      status: 200,
      body: {
        data: {
          app_id: "777",
          is_valid: true,
          expires_at: 0,
          granular_scopes: [
            { scope: "whatsapp_business_messaging", target_ids: ["555"] },
            { scope: "whatsapp_business_management", target_ids: ["555"] },
          ],
        },
      },
    };

    graph.routes[`GET ${path("555/phone_numbers")}`] = {
      status: 200,
      body: { data: [{ id: "1234567890", display_phone_number: "+55 48 99999-0000" }] },
    };

    graph.routes[`GET ${path("777")}`] = { status: 200, body: { id: "777" } };
    graph.routes[`POST ${path("777/subscriptions")}`] = { status: 200, body: { success: true } };
    graph.routes[`POST ${path("555/subscribed_apps")}`] = { status: 200, body: { success: true } };
    graph.routes[`GET ${path("555/message_templates")}`] = { status: 200, body: { data: [] } };
    graph.routes[`POST ${path("555/message_templates")}`] = { status: 200, body: { id: "9", status: "PENDING" } };
  });

  const connect = (fields: Record<string, string> = {}) =>
    saveCloud({ code: null }, form({ token: TOKEN, appSecret: APP_SECRET, ...fields }));

  function debugToken(data: object) {
    graph.routes[`GET ${path("debug_token")}`] = { status: 200, body: { data } };
  }

  function cloudHook(payload: object, secret = APP_SECRET) {
    const body = JSON.stringify(payload);
    return cloudWebhook(
      new Request("https://shop.example/api/webhooks/whatsapp/cloud", {
        method: "POST",
        headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
        body,
      }),
    );
  }

  function change(value: object) {
    return { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value }] }] };
  }

  test("connecting names each problem in the seller's Meta setup and saves nothing until all pass", async () => {
    await signInAsAdmin();
    expect((await connect({ token: "" })).code).toBe("INVALID_CREDENTIAL");
    expect((await connect({ appSecret: "not-a-secret" })).code).toBe("CLOUD_APP_SECRET_INVALID");
    debugToken({ is_valid: false });
    expect((await connect()).code).toBe("CLOUD_TOKEN_INVALID");
    debugToken({ app_id: "777", is_valid: true, expires_at: 1794700000 });
    expect((await connect()).code).toBe("CLOUD_TOKEN_TEMPORARY");
    debugToken({ app_id: "777", is_valid: true, expires_at: 0, granular_scopes: [] });
    expect((await connect()).code).toBe("CLOUD_PERMISSION_MISSING");
    expect(graph.to("POST", path("777/subscriptions")).length).toBe(0);
  });

  test("one paste finds the number, creates the template, subscribes the webhook and replaces the QR Code", async () => {
    await signInAsAdmin();
    graph.routes[`GET ${path("555/phone_numbers")}`] = { status: 200, body: { data: [] } };
    expect((await connect()).code).toBe("CLOUD_NO_NUMBER");
    graph.routes[`GET ${path("555/phone_numbers")}`] = {
      status: 200,
      body: { data: [{ id: "1234567890", display_phone_number: "+55 48 99999-0000" }] },
    };
    graph.routes[`GET ${path("777")}`] = { status: 400, body: { error: { code: 190 } } };
    expect((await connect()).code).toBe("CLOUD_APP_SECRET_INVALID");
    graph.routes[`GET ${path("777")}`] = { status: 200, body: { id: "777" } };
    graph.routes[`POST ${path("777/subscriptions")}`] = { status: 400, body: { error: { code: 1 } } };
    expect((await connect()).code).toBe("CLOUD_WEBHOOK_FAILED");
    expect(await integrations()).toMatchObject({ cloud: { configured: false } });
    graph.routes[`POST ${path("777/subscriptions")}`] = { status: 200, body: { success: true } };
    expect(await connect()).toEqual({ code: null, ok: true });

    const [hook] = graph.to("POST", path("777/subscriptions"));
    expect(hook?.headers["authorization"]).toBe(`Bearer 777|${APP_SECRET}`);
    expect(JSON.parse(hook?.body ?? "{}")).toMatchObject({
      object: "whatsapp_business_account",
      callback_url: "https://shop.example/api/webhooks/whatsapp/cloud",
      verify_token: derive("cloud"),
      fields: "messages",
    });
    const template = JSON.parse(graph.to("POST", path("555/message_templates"))[0]?.body ?? "{}");
    expect(template).toMatchObject({ name: "librefunnel_aviso", language: "pt_BR", category: "UTILITY" });
    expect(template.components[0].text).toMatch(/^[^{]+\{\{1\}\}[^{]+$/);
    graph.routes[`GET ${path("555/message_templates")}`] = {
      status: 200,
      body: { data: [{ name: "librefunnel_aviso", status: "PENDING" }] },
    };
    expect(await integrations()).toMatchObject({
      cloud: { configured: true, number: "+55 48 99999-0000", template: "pending" },
    });
    graph.requests.length = 0;
    expect(await connect()).toEqual({ code: null, ok: true });
    expect(graph.to("POST", path("555/message_templates")).length).toBe(0);

    const order = await buy({ email: "cloud@example.com", phone: "11977778888" });
    at("12:16");
    await queueRecovery();
    graph.routes[`POST ${path("1234567890/messages")}`] = { status: 404, body: { error: { code: 132001 } } };
    await sendMessages();
    expect((await messagesOf(order))[0]).toMatchObject({ status: "queued", error: "TEMPLATE_PENDING" });
    graph.routes[`POST ${path("1234567890/messages")}`] = { status: 200, body: { messages: [{ id: "wamid.OUT1" }] } };
    graph.requests.length = 0;
    at("12:20");
    await sendMessages();
    expect(evolution.to("POST", "/message/sendText/librefunnel").length).toBe(0);
    const [sent] = graph.to("POST", path("1234567890/messages"));
    expect(sent?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(sent?.body ?? "{}");
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "5511977778888", type: "template" });
    expect(body.template).toMatchObject({ name: "librefunnel_aviso", language: { code: "pt_BR" } });
    const parameter: string = body.template.components[0].parameters[0].text;
    expect(parameter).toContain(`https://shop.example/c/metodo-demo?order=${order}`);
    expect(parameter).not.toMatch(/\n/);
    expect((await messagesOf(order))[0]).toMatchObject({ status: "sent" });
  });

  test("an unregistered number asks for the PIN, and another number is picked without pasting the keys", async () => {
    at("12:11");
    await signInAsAdmin();
    graph.routes[`GET ${path("555/phone_numbers")}`] = {
      status: 200,
      body: {
        data: [
          { id: "1234567890", display_phone_number: "+55 48 99999-0000", platform_type: "CLOUD_API" },
          { id: "2222222222", display_phone_number: "+55 11 3333-4444", platform_type: "NOT_APPLICABLE" },
        ],
      },
    };
    const pick = (fields: Record<string, string>) => connect({ token: "", appSecret: "", ...fields });
    expect((await pick({ phoneId: "2222222222" })).code).toBe("CLOUD_PIN_REQUIRED");
    expect((await pick({ phoneId: "2222222222", pin: "12" })).code).toBe("CLOUD_PIN_INVALID");
    graph.routes[`POST ${path("2222222222/register")}`] = { status: 400, body: { error: { code: 133005 } } };
    expect((await pick({ phoneId: "2222222222", pin: "123456" })).code).toBe("CLOUD_PIN_INVALID");
    graph.routes[`POST ${path("2222222222/register")}`] = { status: 200, body: { success: true } };
    expect(await pick({ phoneId: "2222222222", pin: "123456" })).toEqual({ code: null, ok: true });
    expect(JSON.parse(graph.to("POST", path("2222222222/register")).at(-1)?.body ?? "{}").pin).toBe("123456");
    expect((await integrations()).cloud).toMatchObject({ phoneId: "2222222222", number: "+55 11 3333-4444" });
    expect((await integrations()).cloud.numbers).toHaveLength(2);
    expect((await pick({ phoneId: "9999999999" })).code).toBe("CLOUD_NO_NUMBER");
    expect(await pick({ phoneId: "1234567890" })).toEqual({ code: null, ok: true });
    expect((await integrations()).cloud.phoneId).toBe("1234567890");
  });

  test("the test reads the number first, so a bad token is told apart", async () => {
    await signInAsAdmin();
    await saveSettings({ code: null }, form({ brand: "Loja", ownerWhatsapp: "48999990000", orderHours: "72" }));
    graph.routes[`GET ${path("1234567890")}`] = { status: 401, body: { error: { message: "must-not-leak" } } };
    expect((await testConnection({ code: null }, form({ kind: "whatsapp" }))).code).toBe("PROVIDER_REJECTED");
    expect(graph.to("POST", path("1234567890/messages")).length).toBe(0);
    graph.routes[`GET ${path("1234567890")}`] = { status: 200, body: {} };
    expect(await testConnection({ code: null }, form({ kind: "whatsapp" }))).toEqual({ code: null, ok: true });
    expect(JSON.parse(graph.to("POST", path("1234567890/messages"))[0]?.body ?? "{}").type).toBe("template");
  });

  test("the webhook verifies with the panel token and only accepts Meta's signature", async () => {
    const verify = (token: string, challenge = "1158201444") =>
      cloudVerify(
        new Request(
          `https://shop.example/api/webhooks/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`,
        ),
      );

    expect(await (await verify(derive("cloud"))).text()).toBe("1158201444");
    expect((await verify("wrong")).status).toBe(403);
    expect((await verify(derive("cloud"), "<script>")).status).toBe(403);

    const sair = change({
      messages: [{ from: "552188887777", id: "wamid.IN1", type: "text", text: { body: "Sair" } }],
    });

    expect((await cloudHook(sair, "forged")).status).toBe(401);
    expect(await db().$count(contact, and(eq(contact.address, "5521988887777"), isNotNull(contact.optedOutAt)))).toBe(
      0,
    );
    expect((await cloudHook(sair)).status).toBe(200);
    expect(await db().$count(contact, and(eq(contact.address, "5521988887777"), isNotNull(contact.optedOutAt)))).toBe(
      1,
    );
  });

  test("throughput limits retry, and an unregistered number asks to reconnect with the PIN", async () => {
    const order = await buy({ email: "throughput@example.com", phone: "11966665555" });
    at("12:16");
    await queueRecovery();
    graph.routes[`POST ${path("1234567890/messages")}`] = { status: 400, body: { error: { code: 130429 } } };
    await sendMessages();
    expect((await messagesOf(order))[0]).toMatchObject({ status: "queued", error: "PROVIDER_UNREACHABLE" });
    graph.routes[`POST ${path("1234567890/messages")}`] = { status: 400, body: { error: { code: 133010 } } };
    at("12:20");
    await sendMessages();
    expect((await messagesOf(order))[0]).toMatchObject({ status: "skipped", error: "CLOUD_PIN_REQUIRED" });
  });

  test("keyword replies go as free text and failed statuses mark the message failed", async () => {
    await cloudHook(
      change({ messages: [{ from: "5521955556666", id: "wamid.IN2", type: "text", text: { body: "quero" } }] }),
    );
    await sendMessages();

    const reply = JSON.parse(
      graph.to("POST", path("1234567890/messages")).find((entry) => entry.body.includes("5521955556666"))?.body ?? "{}",
    );

    expect(reply).toMatchObject({ to: "5521955556666", type: "text" });
    expect(reply.text.body).toBe("Que bom! Aqui está o link: https://shop.example/v/metodo-demo");
    await cloudHook(change({ statuses: [{ id: "wamid.OUT1", status: "failed", recipient_id: "5521955556666" }] }));

    const [row] = await db()
      .select({ status: message.status, error: message.error })
      .from(message)
      .where(and(eq(message.address, "5521955556666"), eq(message.kind, "reply")));

    expect(row).toEqual({ status: "failed", error: "PROVIDER_REJECTED" });
  });

  test("the seller's reply goes as free text only inside 24 hours of the buyer's last message", async () => {
    await signInAsAdmin();
    await cloudHook(
      change({
        messages: [{ from: "5521933332222", id: "wamid.IN3", type: "text", text: { body: "tenho uma dúvida" } }],
      }),
    );
    const open: Conversation = { channel: "whatsapp", address: "5521933332222" };
    expect((await inbox("all", open)).thread?.canReply).toBe(true);
    expect(await sendReply({ code: null }, form({ address: open.address, text: "Pode falar!" }))).toEqual({
      code: null,
      ok: true,
    });
    await sendMessages();

    const sent = JSON.parse(
      graph.to("POST", path("1234567890/messages")).find((entry) => entry.body.includes(open.address))?.body ?? "{}",
    );

    expect(sent).toMatchObject({ type: "text", text: { body: "Pode falar!" } });
    vi.setSystemTime(new Date("2026-11-15T12:01:00-03:00"));
    await signInAsAdmin();
    expect((await inbox("all", open)).thread?.canReply).toBe(false);
    expect((await sendReply({ code: null }, form({ address: open.address, text: "Ainda aí?" }))).code).toBe(
      "REPLY_WINDOW_CLOSED",
    );
  });
});
