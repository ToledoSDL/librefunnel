import "server-only";
import { eq } from "drizzle-orm";
import { hmacHex, isObject, jsonObject, safeEqual } from "../guard";
import type { JsonObject } from "../guard";
import { parseCents } from "../input";
import { order } from "../schema";
import { busy, callPsp, credentialsReply, limited, mismatch, objects } from "./psp";
import type { Adapter, Notice, PspKeys } from "./psp";
import { formatDecimal, formatFirstName } from "@/format";

const MP_FAILED = ["rejected", "failed", "canceled", "cancelled"];

function firstPayment(charge: JsonObject | undefined): JsonObject | undefined {
  const transactions = charge?.transactions;
  const payments = isObject(transactions) ? transactions.payments : undefined;
  const first = Array.isArray(payments) ? payments[0] : undefined;
  return isObject(first) ? first : undefined;
}

// Mercado Pago signs `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
function mercadoPagoNotice(raw: string, keys: PspKeys, headers: Headers, url: URL): Notice {
  const parts = new Map(
    (headers.get("x-signature") ?? "").split(",").map((part) => {
      const [name = "", value = ""] = part.split("=");
      return [name.trim(), value.trim()];
    }),
  );

  const data = jsonObject(raw)?.data;
  const dataId = url.searchParams.get("data.id") ?? (isObject(data) && typeof data.id === "string" ? data.id : "");
  const requestId = headers.get("x-request-id");
  const ts = parts.get("ts");

  const manifest = [
    dataId ? `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};` : "",
    requestId ? `request-id:${requestId};` : "",
    ts ? `ts:${ts};` : "",
  ].join("");

  if (!ts || !safeEqual(parts.get("v1") ?? "", hmacHex(keys.webhookSecret, manifest)))
    return { code: "INVALID_SIGNATURE", status: 401 };
  if (!dataId) return { code: "INVALID_PAYLOAD", status: 400 };
  return { match: eq(order.txid, dataId) };
}

export const mercadopago: Adapter = {
  async create(row, keys, seconds) {
    const value = formatDecimal(row.amount);

    const response = await callPsp(
      "mercadopago",
      keys.apiKey,
      "/v1/orders",
      {
        type: "online",
        processing_mode: "automatic",
        total_amount: value,
        external_reference: row.id,
        payer: { email: row.email, first_name: formatFirstName(row.name) },
        transactions: {
          payments: [
            {
              amount: value,
              payment_method: { id: "pix", type: "bank_transfer" },
              expiration_time: `PT${Math.min(43_200, Math.max(30, Math.floor(seconds / 60)))}M`,
            },
          ],
        },
      },
      row.id,
    );

    const method = firstPayment(response.body)?.payment_method;
    const qrCode = isObject(method) ? method.qr_code : undefined;
    const chargeId = response.body?.id;
    return response.status < 300 && typeof qrCode === "string" && typeof chargeId === "string"
      ? { txid: chargeId, pixCode: qrCode }
      : { status: response.status };
  },
  async fetch(row, keys) {
    const response = await callPsp("mercadopago", keys.apiKey, `/v1/orders/${encodeURIComponent(row.txid)}`);
    if (busy(response)) return limited(response);
    const charge = response.body;
    const first = firstPayment(charge);
    const paymentId = first?.id;
    if (response.status >= 300 || !charge || charge.external_reference !== row.id || typeof paymentId !== "string")
      return mismatch("mercadopago", row.id, response.status);
    const paid = typeof charge.total_paid_amount === "string" ? parseCents(charge.total_paid_amount) : undefined;
    const total = typeof charge.total_amount === "string" ? parseCents(charge.total_amount) : undefined;
    const transactions = isObject(charge.transactions) ? charge.transactions : undefined;
    const refunding = charge.status === "refunded" || charge.status_detail === "partially_refunded";

    // Each refund and chargeback is debited by its own id and amount, so a partial refund followed by a full one adds up.
    const debits = [
      ...(refunding ? objects(transactions?.refunds).map((entry) => ({ entry, kind: "refund" })) : []),
      ...objects(transactions?.chargebacks).map((entry) => ({ entry, kind: "chargeback" })),
    ].flatMap(({ entry, kind }) => {
      const amount = typeof entry.amount === "string" ? parseCents(entry.amount) : undefined;
      const failed = typeof entry.status === "string" && MP_FAILED.includes(entry.status);
      return typeof entry.id === "string" && amount && !failed
        ? [{ amount: -amount, externalId: `mp:${kind}:${entry.id}` }]
        : [];
    });

    const revoked =
      refunding || charge.status === "charged_back" || first?.status === "charged_back" || debits.length > 0;

    if (revoked) {
      const fallback = total ? [{ amount: -total, externalId: `mp:${paymentId}:revoked` }] : [];
      return { movements: debits.length ? debits : fallback, raw: response.raw };
    }
    return {
      movements: charge.status === "processed" && paid ? [{ amount: paid, externalId: `mp:${paymentId}` }] : [],
      raw: response.raw,
    };
  },
  notice: mercadoPagoNotice,
  async test(keys) {
    return credentialsReply(await callPsp("mercadopago", keys.apiKey, "/users/me"));
  },
};
