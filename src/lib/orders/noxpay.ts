import "server-only";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { baseUrl, isObject, jsonObject, safeEqual } from "../guard";
import type { Json } from "../guard";
import { parseCents } from "../input";
import { order } from "../schema";
import { busy, callPsp, credentialsReply, limited, mismatch } from "./psp";
import type { Adapter, Notice, PspKeys } from "./psp";

// Each code is one currency on one network, as NoxPay lists them.
export const NOXPAY_CURRENCIES = [
  { code: "TRX_USDT_S2UZ", label: "USDT na rede Tron" },
  { code: "SOL_USDT_EWAY", label: "USDT na rede Solana" },
  { code: "USDT_ERC20", label: "USDT na rede Ethereum" },
  { code: "SOL_USDC_PTHX", label: "USDC na rede Solana" },
  { code: "USDC", label: "USDC na rede Ethereum" },
  { code: "BTC", label: "Bitcoin" },
] as const;

function noxPayNotice(raw: string, keys: PspKeys, headers: Headers): Notice {
  const signature = createHmac("sha256", keys.webhookSecret).update(raw).digest("base64");
  if (!safeEqual(headers.get("x-signature") ?? "", signature)) return { code: "INVALID_SIGNATURE", status: 401 };
  const end2end = jsonObject(raw)?.end2end;
  return { match: typeof end2end === "string" ? eq(order.txid, end2end) : undefined };
}

function label(value: Json | undefined): string | undefined {
  return isObject(value) && typeof value.en === "string" ? value.en : undefined;
}

function noxCents(value: Json | undefined): number | undefined {
  if (typeof value === "string") return parseCents(value);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : undefined;
}

export const noxpay: Adapter = {
  async create(row, keys) {
    const response = await callPsp("noxpay", keys.apiKey, "/v2/crossramp_checkout", {
      currency_code: keys.currency,
      amount_fiat: row.amount / 100,
      payer_name: row.name,
      webhook: `${baseUrl()}/api/webhooks/payment?psp=noxpay`,
      return_url: `${baseUrl()}/c/${row.product}?order=${row.id}`,
    });

    const link = response.body?.link;

    const end2end =
      typeof link === "string" ? /^https:\/\/checkout\.noxpay\.io\/e2e\/(NOX\w+)$/.exec(link)?.[1] : undefined;

    return response.status < 300 && typeof link === "string" && end2end
      ? { txid: end2end, pixCode: link }
      : { status: response.status };
  },
  async fetch(row, keys) {
    const response = await callPsp("noxpay", keys.apiKey, `/v2/crossramp_checkout/${encodeURIComponent(row.txid)}`);
    if (busy(response)) return limited(response);
    const checkout = response.body;
    const attributes = isObject(checkout?.attributes) ? checkout.attributes : undefined;
    if (response.status >= 300 || !checkout || checkout.end2end !== row.txid || !attributes)
      return mismatch("noxpay", row.id, response.status);
    const status = label(checkout.status);
    const amount = noxCents(attributes.amount_payment);
    // Processing starts once the Pix arrives; a failed conversion leaves the money in the seller's NoxPay account.
    const received = status === "Success" || status === "Processing";
    return {
      movements: received && amount ? [{ amount, externalId: `nox:${row.txid}` }] : [],
      raw: response.raw,
    };
  },
  notice: noxPayNotice,
  async test(keys) {
    const response = await callPsp("noxpay", keys.apiKey, "/v2/crossramp_checkout/librefunnel-test");
    return response.status === 404 ? null : credentialsReply(response);
  },
};
