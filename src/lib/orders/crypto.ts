import "server-only";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { credentials, saveCredentials } from "../catalog";
import { db } from "../db";
import { demoMode, isObject } from "../guard";
import { order } from "../schema";
import type { OrderCode } from "./checkout";
import { callPsp, cents, objects } from "./psp";
import type { PspResponse } from "./psp";

export type CryptoMode = "off" | "balance" | "sale";

// Woovi's stablecoin deposits: USDT is not offered on Base, USDC is not offered on Tron.
export const WOOVI_ASSETS = [
  { id: "USDT:POLYGON", label: "USDT na rede Polygon" },
  { id: "USDT:TRON", label: "USDT na rede Tron" },
  { id: "USDT:ETHEREUM", label: "USDT na rede Ethereum" },
  { id: "USDT:CELO", label: "USDT na rede Celo" },
  { id: "USDC:POLYGON", label: "USDC na rede Polygon" },
  { id: "USDC:BASE", label: "USDC na rede Base" },
  { id: "USDC:ETHEREUM", label: "USDC na rede Ethereum" },
  { id: "USDC:CELO", label: "USDC na rede Celo" },
] as const;

// The balance is swept once an hour and only above R$ 50, so conversions are few and the fixed costs stay small.
const SWEEP_MIN = 5000;
const SWEEP_EVERY_MS = 3_600_000;
const CONVERT_RETRY_MS = 600_000;

type Conversion = { apiKey: string; coin: string; network: string; wallet: string };

const CONVERSION_ERRORS = ["PSP_REJECTED", "PSP_UNREACHABLE", "CRYPTO_REFUSED"] as const;

export function cryptoMode(value: string): CryptoMode {
  return value === "balance" || value === "sale" ? value : "off";
}

export function conversionError(value: string) {
  return CONVERSION_ERRORS.find((code) => code === value);
}

export function wooviAsset(value: string) {
  return WOOVI_ASSETS.find((asset) => asset.id === value)?.id;
}

// Tron addresses are base58 starting with T; the other networks Woovi offers are EVM chains.
export function cryptoWallet(asset: string, raw: string): string | undefined {
  const wallet = raw.trim();

  const valid = asset.endsWith(":TRON")
    ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)
    : /^0x[0-9a-fA-F]{40}$/.test(wallet);

  return valid ? wallet : undefined;
}

function conversionReply(response: PspResponse): OrderCode {
  if (response.status === 401 || response.status === 403) return "PSP_REJECTED";
  return response.status === 400 ? "CRYPTO_REFUSED" : "PSP_UNREACHABLE";
}

// Approval is what debits the BRL balance; the correlation id ties the pair so a retried deposit is not created twice.
async function convert(target: Conversion, value: number, correlationId: string): Promise<OrderCode | null> {
  const created = await callPsp("woovi", target.apiKey, "/api/v1/stablecoin/deposit", {
    value,
    currency: target.coin,
    network: target.network,
    correlationId,
    destinationWalletAddress: target.wallet,
  });

  if (created.status >= 300) return conversionReply(created);
  const approved = await callPsp("woovi", target.apiKey, "/api/v1/stablecoin/deposit/approve", { correlationId });
  if (approved.status < 300) return null;
  // An earlier run approved it but stopped before marking the order: Woovi answers "already completed" or "already being processed".
  if (approved.status === 400 && /already (completed|being processed)/i.test(approved.raw)) return null;
  return conversionReply(approved);
}

async function convertBalance(target: Conversion): Promise<OrderCode | null> {
  const response = await callPsp("woovi", target.apiKey, "/api/v1/account/");
  if (response.status >= 300) return conversionReply(response);
  const main = objects(response.body?.accounts).find((account) => account.isDefault === true);
  const available = isObject(main?.balance) ? cents(main.balance.available) : undefined;
  if (!available || available < SWEEP_MIN) return null;
  return convert(target, available, `librefunnel-${Math.floor(Date.now() / SWEEP_EVERY_MS)}`);
}

async function convertSales(target: Conversion, since: Date): Promise<OrderCode | null> {
  const rows = await db()
    .select({ id: order.id, amount: order.amount })
    .from(order)
    .where(and(eq(order.status, "paid"), eq(order.psp, "woovi"), isNull(order.cryptoAt), gte(order.createdAt, since)))
    .orderBy(asc(order.createdAt))
    .limit(10);

  for (const row of rows) {
    const response = await callPsp("woovi", target.apiKey, `/api/v1/charge/${encodeURIComponent(row.id)}`);
    // An order this Woovi account does not know (keys replaced since the sale) is skipped instead of blocking the rest.
    if (response.status >= 300 && response.status !== 404) return conversionReply(response);
    const charge = response.body?.charge;
    const methods = isObject(charge) ? charge.paymentMethods : undefined;
    const pix = isObject(methods) ? methods.pix : undefined;
    // Woovi takes its Pix fee from the balance; without the fee on the charge, R$ 5 (its highest Pix fee) stays in reais.
    const fee = (isObject(pix) ? cents(pix.fee) : undefined) ?? 500;
    if (response.status !== 404 && row.amount > fee) {
      const code = await convert(target, row.amount - fee, `librefunnel-${row.id}`);
      if (code) return code;
    }
    await db().update(order).set({ cryptoAt: new Date() }).where(eq(order.id, row.id));
  }
  return null;
}

// Runs in the background loop: a refused conversion waits ten minutes and its reason shows in Conexões.
export async function convertToCrypto() {
  const woovi = (await credentials("woovi"))("woovi");
  const mode = woovi("convertMode");
  const [coin, network] = woovi("convertAsset").split(":");
  const apiKey = woovi("apiKey");
  const wallet = woovi("convertWallet");
  if ((mode !== "balance" && mode !== "sale") || !coin || !network || !apiKey || !wallet || demoMode()) return;
  if (Number(woovi("convertNextAt")) > Date.now()) return;
  const target = { apiKey, coin, network, wallet };
  let code: OrderCode | null;
  try {
    code =
      mode === "balance"
        ? await convertBalance(target)
        : await convertSales(target, new Date(Number(woovi("convertSince"))));
  } catch (error) {
    console.warn("[librefunnel] woovi unreachable while converting", error);
    code = "PSP_UNREACHABLE";
  }
  const next = code ? CONVERT_RETRY_MS : mode === "balance" ? SWEEP_EVERY_MS : 0;
  await saveCredentials("woovi", { convertError: code ?? "", convertNextAt: String(Date.now() + next) });
}

export async function testConversion(asset: string): Promise<OrderCode | null> {
  const apiKey = (await credentials("woovi"))("woovi")("apiKey");
  if (!apiKey) return "PSP_NOT_CONFIGURED";
  const coin = asset.split(":")[0] ?? "USDT";
  try {
    const response = await callPsp("woovi", apiKey, `/api/v1/stablecoin/quote?value=10000&currency=${coin}`);
    return response.status < 300 ? null : conversionReply(response);
  } catch {
    return "PSP_UNREACHABLE";
  }
}
