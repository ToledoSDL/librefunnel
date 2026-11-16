import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { credentials, saveCredentials } from "../settings";
import { db } from "../db";
import { hmacHex, jsonObject, readBody, safeEqual } from "../guard";
import { order } from "../schema";
import { ADAPTERS } from "./charges";
import { recordPayment } from "./payments";
import { pspConfigured, pspKeys, pspOf } from "./psp";

const WEBHOOK_LIMIT = 64 * 1024;

function webhookReply(body: { ok: true } | { code: string }, status = 200): Response {
  return Response.json(body, { status });
}

export async function rotateWebhookSecret(): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  await saveCredentials("webhook", {}, { secret });
  return secret;
}

export async function paymentWebhook(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("psp");
  const psp = pspOf(name);
  if (!psp) {
    const secret = name === null ? (await credentials("webhook"))("webhook")("secret") : "";
    if (!secret) return new Response(null, { status: 404 });
    const raw = await readBody(request, WEBHOOK_LIMIT);
    return raw === undefined
      ? webhookReply({ code: "PAYLOAD_TOO_LARGE" }, 413)
      : genericWebhook(request.headers, raw, secret);
  }

  const keys = pspKeys((await credentials(psp))(psp));
  if (!pspConfigured(psp, keys)) return new Response(null, { status: 404 });
  const raw = await readBody(request, WEBHOOK_LIMIT);
  if (raw === undefined) return webhookReply({ code: "PAYLOAD_TOO_LARGE" }, 413);
  const notice = ADAPTERS[psp].notice(raw, keys, request.headers, url);
  if ("code" in notice) return webhookReply({ code: notice.code }, notice.status);
  if (!notice.match) return webhookReply({ ok: true });

  // The webhook only brings the next re-fetch forward; if the provider is rate limiting, that one re-fetch is paused again.
  const marked = await db()
    .update(order)
    .set({ pspCheckAt: new Date() })
    .where(and(notice.match, eq(order.psp, psp)))
    .returning({ id: order.id });

  return webhookReply(marked.length ? { ok: true } : { code: "ORDER_NOT_FOUND" });
}

async function genericWebhook(headers: Headers, raw: string, secret: string): Promise<Response> {
  if (!safeEqual(headers.get("x-signature") ?? "", hmacHex(secret, raw)))
    return webhookReply({ code: "INVALID_SIGNATURE" }, 401);
  const body = jsonObject(raw);
  const reference = body?.order;
  const status = body?.status;
  const amount = body?.amount;
  const id = body?.id;
  if (
    typeof reference !== "string" ||
    reference.length > 64 ||
    (status !== "paid" && status !== "refunded") ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 200
  ) {
    return webhookReply({ code: "INVALID_PAYLOAD" }, 400);
  }
  const code = await recordPayment(reference, status === "paid" ? amount : -amount, id, raw);
  return webhookReply(code ? { code } : { ok: true });
}
