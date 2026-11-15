import "server-only";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { isObject, jsonObject, safeEqual } from "../guard";
import { order } from "../schema";
import { PSP_MAX_SECONDS, busy, callPsp, cents, credentialsReply, limited, mismatch, objects } from "./psp";
import type { Adapter, Notice, PspKeys } from "./psp";

// Published on AbacatePay's webhook security page; the same for every account.
const ABACATEPAY_SIGNING_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

// The secret authenticates; the signature key is public and only proves the body was not altered.
function abacatePayNotice(raw: string, keys: PspKeys, headers: Headers, url: URL): Notice {
  const secret = headers.get("x-webhook-secret") ?? url.searchParams.get("webhookSecret") ?? "";
  const signature = createHmac("sha256", ABACATEPAY_SIGNING_KEY).update(raw).digest("base64");
  if (!safeEqual(secret, keys.webhookSecret) || !safeEqual(headers.get("x-webhook-signature") ?? "", signature))
    return { code: "INVALID_SIGNATURE", status: 401 };
  const data = jsonObject(raw)?.data;
  const charge = isObject(data) ? data.transparent : undefined;
  return { match: isObject(charge) && typeof charge.id === "string" ? eq(order.txid, charge.id) : undefined };
}

export const abacatepay: Adapter = {
  async create(row, keys, seconds) {
    const response = await callPsp("abacatepay", keys.apiKey, "/v2/transparents/create", {
      method: "PIX",
      data: {
        amount: row.amount,
        expiresIn: Math.min(PSP_MAX_SECONDS, Math.max(300, seconds)),
        externalId: row.id,
        description: `Pedido ${row.id}`,
        metadata: { orderId: row.id },
      },
    });

    const charge = response.body?.data;
    return response.status < 300 &&
      isObject(charge) &&
      typeof charge.id === "string" &&
      typeof charge.brCode === "string"
      ? { txid: charge.id, pixCode: charge.brCode }
      : { status: response.status };
  },
  async fetch(row, keys) {
    const response = await callPsp(
      "abacatepay",
      keys.apiKey,
      `/v2/transparents/list?id=${encodeURIComponent(row.txid)}`,
    );

    if (busy(response)) return limited(response);
    const charge = objects(response.body?.data).find((entry) => entry.id === row.txid);
    const amount = cents(charge?.amount);
    // A test key only sees test charges and the reverse; a mismatch means the charge is not from this account mode.
    if (response.status >= 300 || !charge || !amount || charge.devMode !== keys.apiKey.startsWith("abc_dev_"))
      return mismatch("abacatepay", row.id, response.status);
    if (charge.status === "REFUNDED")
      return { movements: [{ amount: -amount, externalId: `abacate:${row.txid}:revoked` }], raw: response.raw };
    return {
      movements: charge.status === "PAID" ? [{ amount, externalId: `abacate:${row.txid}` }] : [],
      raw: response.raw,
    };
  },
  notice: abacatePayNotice,
  async test(keys) {
    return credentialsReply(await callPsp("abacatepay", keys.apiKey, "/v2/transparents/list"));
  },
};
