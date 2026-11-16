import "server-only";
import { isIP } from "node:net";
import { ORDER_STEPS } from "@/funnel";
import { isObject, jsonObject, sha256 } from "../guard";
import type { Credentials } from "../settings";
import type { Destination, Failure, Sale } from "./conversions";

type Analytics = { measurementId: string; apiSecret: string };

const COLLECT = "https://www.google-analytics.com/mp/collect";

const DEBUG = "https://www.google-analytics.com/debug/mp/collect";

function config(read: Credentials<"analytics">): Analytics | undefined {
  const measurementId = read("measurementId");
  const apiSecret = read("apiSecret");
  return measurementId && apiSecret ? { measurementId, apiSecret } : undefined;
}

// Google matches hashed e-mails after this normalization: Gmail ignores dots in the name.
export function googleEmail(email: string): string {
  const [name = "", domain = ""] = email.trim().toLowerCase().split("@");
  return domain === "gmail.com" || domain === "googlemail.com"
    ? `${name.replaceAll(".", "")}@${domain}`
    : `${name}@${domain}`;
}

async function post(url: string, config: Analytics, body: object) {
  const query = new URLSearchParams({ measurement_id: config.measurementId, api_secret: config.apiSecret });

  return fetch(`${url}?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

// The Measurement Protocol takes one browser per request, so each sale goes alone. It answers 2xx even for an event it
// drops, so only the connection test (the validation server) can tell a malformed event.
async function send(config: Analytics, bodies: object[]): Promise<Failure | null> {
  for (const body of bodies) {
    try {
      const response = await post(COLLECT, config, body);
      if (response.ok) continue;
      console.warn(`[librefunnel] google analytics HTTP ${response.status}`);
      return response.status >= 500 || response.status === 429 ? "UNREACHABLE" : "REJECTED";
    } catch {
      return "UNREACHABLE";
    }
  }
  return null;
}

function sale(row: Sale) {
  const items = [{ item_id: row.product, price: row.productAmount / 100, quantity: 1 }];
  if (row.bump && row.bumpAmount) items.push({ item_id: row.bump, price: row.bumpAmount / 100, quantity: 1 });
  const step = Object.values(ORDER_STEPS).find((entry) => entry.name === row.name);

  return {
    // The browser's own id when the Google tag ran, so the sale joins the visit and the ad that brought it.
    client_id: row.gaClient ?? row.visitorId ?? row.customerId,
    user_id: row.customerId,
    timestamp_micros: row.at.getTime() * 1000,
    ...(isIP(row.ip) ? { ip_override: row.ip } : {}),
    user_data: {
      sha256_email_address: [sha256(googleEmail(row.email))],
      ...(row.phone ? { sha256_phone_number: [sha256(`+${row.phone}`)] } : {}),
    },
    events: [
      {
        name: step?.analytics ?? "purchase",
        params: {
          transaction_id: row.orderId,
          currency: "BRL",
          value: row.amount / 100,
          items,
          ...(row.gaSession ? { session_id: row.gaSession } : {}),
          engagement_time_msec: 1,
        },
      },
    ],
  };
}

async function test(config: Analytics): Promise<Failure | null> {
  try {
    const response = await post(DEBUG, config, {
      client_id: "librefunnel.test",
      events: [{ name: "librefunnel_test", params: { engagement_time_msec: 1 } }],
    });

    const messages = jsonObject(await response.text())?.validationMessages;
    if (!response.ok) return response.status >= 500 ? "UNREACHABLE" : "REJECTED";
    return Array.isArray(messages) && messages.some(isObject) ? "REJECTED" : null;
  } catch {
    return "UNREACHABLE";
  }
}

export const analytics: Destination<Analytics, "analytics"> = {
  config,
  // Google Analytics drops events backdated more than 72 hours.
  maxAge: 72 * 3600 - 3600,
  batch: 1,
  sale,
  send,
  test,
};
