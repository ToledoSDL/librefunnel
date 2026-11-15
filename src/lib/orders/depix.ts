import "server-only";
import { eq } from "drizzle-orm";
import { isObject, jsonObject, safeEqual } from "../guard";
import type { Json, JsonObject } from "../guard";
import { order } from "../schema";
import { busy, callPsp, cents, credentialsReply, limited, mismatch } from "./psp";
import type { Adapter, Notice, PspKeys, PspResponse } from "./psp";

// Eulen sends the registered secret as is, with no signature; the re-fetch is what proves the payment.
function depixNotice(raw: string, keys: PspKeys, headers: Headers): Notice {
  if (!safeEqual(headers.get("authorization") ?? "", `Basic ${keys.webhookSecret}`))
    return { code: "INVALID_SIGNATURE", status: 401 };
  const qrId = jsonObject(raw)?.qrId;
  return { match: typeof qrId === "string" ? eq(order.txid, qrId) : undefined };
}

// Eulen access tokens last minutes and client-credential logins never rotate, so each process keeps its own.
let depixSession: { clientId: string; token: string; until: number } | undefined;

async function callDepix(keys: PspKeys, path: string, body?: Json): Promise<PspResponse> {
  const cached = depixSession?.clientId === keys.clientId && depixSession.until > Date.now();
  const response = await callDepixOnce(keys, path, body);
  // A token revoked before its expiry is replaced by one new login, then the call is repeated.
  if (response.status !== 401 || !cached) return response;
  depixSession = undefined;
  return callDepixOnce(keys, path, body);
}

async function callDepixOnce(keys: PspKeys, path: string, body?: Json): Promise<PspResponse> {
  if (!depixSession || depixSession.clientId !== keys.clientId || depixSession.until <= Date.now()) {
    const login = await callPsp("depix", "", "/api/v2/auth/login", {
      client_id: keys.clientId,
      client_secret: keys.apiKey,
    });

    const token = login.body?.access_token;
    const seconds = cents(login.body?.expires_in) ?? 300;
    if (login.status >= 300 || typeof token !== "string") return login;
    depixSession = { clientId: keys.clientId, token, until: Date.now() + Math.max(30, seconds - 60) * 1000 };
  }
  return callPsp("depix", depixSession.token, path, body);
}

function depixDeposit(response: PspResponse): JsonObject | undefined {
  const deposit = response.body?.response;
  return isObject(deposit) ? deposit : undefined;
}

export const depix: Adapter = {
  // Eulen takes no idempotency key or reference: the deposit id is the only link to the order.
  async create(row, keys, seconds) {
    const response = await callDepix(keys, "/api/deposit", {
      amountInCents: row.amount,
      endUserFullName: row.name,
      timeout: Math.min(86_400, Math.max(1200, seconds)),
    });

    const deposit = depixDeposit(response);
    return response.status < 300 && typeof deposit?.id === "string" && typeof deposit.qrCopyPaste === "string"
      ? { txid: deposit.id, pixCode: deposit.qrCopyPaste }
      : { status: response.status };
  },
  async fetch(row, keys) {
    const response = await callDepix(keys, `/api/deposit-status?id=${encodeURIComponent(row.txid)}`);
    if (busy(response)) return limited(response);
    const deposit = depixDeposit(response);
    if (response.status >= 300 || !deposit || deposit.qrId !== row.txid)
      return mismatch("depix", row.id, response.status);
    const amount = cents(deposit.valueInCents);
    const status = deposit.status;
    if (status === "refunded" && amount)
      return { movements: [{ amount: -amount, externalId: `depix:${row.txid}:revoked` }], raw: response.raw };
    if ((status === "approved" || status === "depix_sent") && amount)
      return { movements: [{ amount, externalId: `depix:${row.txid}` }], raw: response.raw };
    // A bank block sends no webhook and can last days; polling it every minute would only spend the rate limit.
    if (status === "under_bank_review") return { retryIn: 1800 };
    const expiration = typeof deposit.expiration === "string" ? Date.parse(deposit.expiration) : Number.NaN;
    const over = status === "expired" || status === "canceled" || status === "error";
    // Eulen does not retry webhooks, so an open deposit is polled until it settles or its code expires.
    return over || (status === "pending" && !(expiration > Date.now()))
      ? { movements: [], raw: response.raw }
      : { retryIn: 60 };
  },
  notice: depixNotice,
  async test(keys) {
    return credentialsReply(await callDepix(keys, "/api/ping"));
  },
};
