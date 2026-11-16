import "server-only";
import { isIP } from "node:net";
import { baseUrl, jsonObject, now, sha256 } from "../guard";
import type { Credentials } from "../settings";
import type { Destination, Failure, Sale, Visit } from "./conversions";

type TikTok = { pixelCode: string; token: string; testEventCode: string };

const EVENTS = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

// 40100 is TikTok's rate limit; codes from 50000 up are its own failures.
const RATE_LIMITED = 40100;

function config(read: Credentials<"tiktok">): TikTok | undefined {
  const pixelCode = read("pixelCode");
  const token = read("token");
  return pixelCode && token ? { pixelCode, token, testEventCode: read("testEventCode") } : undefined;
}

async function send(config: TikTok, data: object[]): Promise<Failure | null> {
  try {
    const response = await fetch(EVENTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": config.token },
      body: JSON.stringify({
        event_source: "web",
        event_source_id: config.pixelCode,
        ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
        data,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = jsonObject(await response.text());
    const code = body?.code;
    if (response.ok && code === 0) return null;
    console.warn(`[librefunnel] tiktok events HTTP ${response.status} code ${String(code)}`);
    const busy = code === RATE_LIMITED || (typeof code === "number" && code >= 50000);
    return response.status >= 500 || response.status === 429 || busy ? "UNREACHABLE" : "REJECTED";
  } catch {
    return "UNREACHABLE";
  }
}

// TikTok matches on the same hashed id across events, so a buyer's events carry the visitor's id from before the order.
function user(row: Sale | Visit, externalId: string) {
  return {
    external_id: sha256(externalId),
    ...(row.clicks.ttclid ? { ttclid: row.clicks.ttclid } : {}),
    ...(row.ttp ? { ttp: row.ttp } : {}),
    ...(isIP(row.ip) ? { ip: row.ip } : {}),
    user_agent: row.userAgent,
  };
}

function sale(row: Sale) {
  const contents = [{ content_id: row.product, quantity: 1, price: row.productAmount / 100 }];
  if (row.bump && row.bumpAmount) contents.push({ content_id: row.bump, quantity: 1, price: row.bumpAmount / 100 });

  return {
    event: row.name,
    event_time: Math.floor(row.at.getTime() / 1000),
    event_id: `${row.orderId}:${row.name}`,
    user: {
      ...user(row, row.visitorId ?? row.customerId),
      email: sha256(row.email),
      ...(row.phone ? { phone: sha256(`+${row.phone}`) } : {}),
    },
    properties: {
      currency: "BRL",
      value: row.amount / 100,
      content_type: "product",
      contents,
      order_id: row.orderId,
    },
    page: { url: row.url },
  };
}

function visit(row: Visit) {
  return {
    event: row.name,
    event_time: Math.floor(row.at.getTime() / 1000),
    event_id: row.eventId,
    user: user(row, row.visitorId),
    properties: {
      currency: "BRL",
      value: row.price / 100,
      content_type: "product",
      contents: [{ content_id: row.product, quantity: 1, price: row.price / 100 }],
    },
    page: { url: row.url },
  };
}

export const tiktok: Destination<TikTok, "tiktok"> = {
  config,
  maxAge: 7 * 86400 - 3600,
  batch: 100,
  sale,
  visit,
  send,
  test: (config) =>
    send(config, [
      {
        event: "LibreFunnelTest",
        event_time: now(),
        event_id: `librefunnel-test-${now()}`,
        user: { external_id: sha256("librefunnel-test") },
        page: { url: baseUrl() },
      },
    ]),
};
