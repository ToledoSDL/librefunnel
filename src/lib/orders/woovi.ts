import "server-only";
import { createPublicKey, createVerify } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { credentials, saveCredentials } from "../catalog";
import { db } from "../db";
import { isObject, jsonObject, safeEqual } from "../guard";
import { order, payment } from "../schema";
import { PSP_HOSTS, PSP_MAX_SECONDS, busy, callPsp, cents, credentialsReply, limited, mismatch, objects } from "./psp";
import type { Adapter, Notice, PspKeys } from "./psp";

// Accepts the key as PEM, base64 of a PEM or base64 DER, and keeps it as base64 DER so the list fits one field.
function spki(text: string): string {
  const pem = text.includes("-----BEGIN") ? text : Buffer.from(text, "base64").toString("utf8");

  const key = pem.includes("-----BEGIN")
    ? createPublicKey(pem)
    : createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });

  return key.export({ type: "spki", format: "der" }).toString("base64");
}

function wooviSigned(raw: string, signature: string, keys: string[]): boolean {
  return keys.some((der) => {
    try {
      return createVerify("sha256")
        .update(raw)
        .verify(createPublicKey({ key: Buffer.from(der, "base64"), format: "der", type: "spki" }), signature, "base64");
    } catch {
      return false;
    }
  });
}

// Woovi's key is shared by every Woovi merchant: it proves the sender, not the account, hence the re-fetch with our AppID.
function wooviNotice(raw: string, keys: PspKeys, headers: Headers): Notice {
  const body = jsonObject(raw);
  const charge = body?.charge;
  const source = [body?.originalTransaction, body?.dispute].find(isObject);
  const correlationId = isObject(charge) && typeof charge.correlationID === "string" ? charge.correlationID : undefined;
  const endToEndId = typeof source?.endToEndId === "string" ? source.endToEndId : undefined;
  if (!correlationId && !endToEndId) return { match: undefined };
  const authorization = [headers.get("x-openpix-authorization"), headers.get("authorization")];
  if (keys.webhookSecret && !authorization.some((value) => safeEqual(value ?? "", keys.webhookSecret)))
    return { code: "INVALID_SIGNATURE", status: 401 };
  if (keys.publicKeys.length === 0) return { code: "PSP_UNREACHABLE", status: 503 };
  if (!wooviSigned(raw, headers.get("x-webhook-signature") ?? "", keys.publicKeys))
    return { code: "INVALID_SIGNATURE", status: 401 };
  if (correlationId) return { match: eq(order.txid, correlationId) };

  const paidBy = db()
    .select({ id: payment.orderId })
    .from(payment)
    .where(eq(payment.externalId, `woovi:${endToEndId}`));

  return { match: inArray(order.id, paidBy) };
}

// Woovi publishes its webhook keys with a one-hour cache; webhooks never call out, so the loop keeps them in the database.
export async function refreshWebhookKeys() {
  const woovi = (await credentials("woovi"))("woovi");
  if (!woovi("apiKey") || Date.now() - Number(woovi("keysAt")) < 3_600_000) return;
  try {
    const response = await fetch(`${PSP_HOSTS.woovi}/api/v1/webhook/public-keys`, {
      signal: AbortSignal.timeout(15_000),
    });

    const keys = objects(jsonObject(await response.text())?.public_keys).flatMap((entry) => {
      try {
        return typeof entry.key === "string" ? [spki(entry.key)] : [];
      } catch {
        return [];
      }
    });

    if (!response.ok || keys.length === 0) {
      console.warn(`[librefunnel] woovi public keys refused with HTTP ${response.status}`);
      return;
    }
    await saveCredentials("woovi", { publicKeys: keys.join(","), keysAt: String(Date.now()) });
  } catch (error) {
    console.warn("[librefunnel] woovi public keys unreachable", error);
  }
}

export const woovi: Adapter = {
  async create(row, keys, seconds) {
    const response = await callPsp("woovi", keys.apiKey, "/api/v1/charge?return_existing=true", {
      correlationID: row.id,
      value: row.amount,
      expiresIn: Math.min(PSP_MAX_SECONDS, Math.max(300, seconds)),
      comment: `Pedido ${row.id}`,
      customer: { name: row.name, email: row.email, ...(row.phone ? { phone: `+${row.phone}` } : {}) },
    });

    const charge = response.body?.charge;
    const brCode = isObject(charge) ? charge.brCode : undefined;
    const matches = isObject(charge) && charge.correlationID === row.id;
    return response.status < 300 && matches && typeof brCode === "string"
      ? { txid: row.id, pixCode: brCode }
      : { status: response.status };
  },
  async fetch(row, keys) {
    const id = encodeURIComponent(row.id);
    const response = await callPsp("woovi", keys.apiKey, `/api/v1/charge/${id}`);
    if (busy(response)) return limited(response);
    const charge = response.body?.charge;
    if (response.status >= 300 || !isObject(charge) || charge.correlationID !== row.id || row.txid !== row.id)
      return mismatch("woovi", row.id, response.status);
    if (charge.status !== "COMPLETED") return { movements: [], raw: response.raw };

    // The charge has no paid amount: the Pix transactions carry what actually arrived.
    const transactions = await callPsp("woovi", keys.apiKey, `/api/v1/transaction?charge=${id}&type=PAYMENT`);
    if (busy(transactions)) return limited(transactions);
    if (transactions.status >= 300) return mismatch("woovi", row.id, transactions.status);

    const paid = objects(transactions.body?.transactions).flatMap((entry) => {
      const endToEndId = [entry.endToEndId, entry.endToEndID].find(
        (value) => typeof value === "string" && value !== "",
      );

      const value = cents(entry.value);
      const linked = !isObject(entry.charge) || entry.charge.correlationID === row.id;
      return typeof endToEndId === "string" && value && linked ? [{ endToEndId, value }] : [];
    });

    if (paid.length === 0) return { retryIn: 60 };

    const refunds = await callPsp("woovi", keys.apiKey, `/api/v1/charge/${id}/refund`);
    if (busy(refunds)) return limited(refunds);
    if (refunds.status >= 300) return mismatch("woovi", row.id, refunds.status);

    const revoked = objects(refunds.body?.refunds).flatMap((refund) => {
      const value = cents(refund.value);
      return refund.status === "CONFIRMED" && value && typeof refund.endToEndId === "string"
        ? [{ amount: -value, externalId: `woovi:refund:${refund.endToEndId}` }]
        : [];
    });

    for (const pix of paid) {
      const dispute = await callPsp("woovi", keys.apiKey, `/api/v1/dispute/${encodeURIComponent(pix.endToEndId)}`);
      if (busy(dispute)) return limited(dispute);
      const found = dispute.body?.dispute;
      // A MED can claim part of the Pix: the dispute's value is what goes back.
      if (dispute.status < 300 && isObject(found) && found.status === "ACCEPTED")
        revoked.push({
          amount: -Math.min(pix.value, cents(found.value) ?? pix.value),
          externalId: `woovi:med:${pix.endToEndId}`,
        });
    }
    if (revoked.length) return { movements: revoked, raw: response.raw };
    return {
      movements: paid.map((pix) => ({ amount: pix.value, externalId: `woovi:${pix.endToEndId}` })),
      raw: response.raw,
    };
  },
  notice: wooviNotice,
  async test(keys) {
    const response = await callPsp("woovi", keys.apiKey, "/api/v1/charge/librefunnel-test");
    return response.status === 404 ? null : credentialsReply(response);
  },
};
