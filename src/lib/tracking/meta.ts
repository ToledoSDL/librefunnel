import "server-only";
import { isIP } from "node:net";
import { isObject, jsonObject, now, sha256 } from "../guard";
import type { Credentials } from "../settings";
import type { Destination, Failure, Sale, Visit } from "./conversions";

type Meta = { pixelId: string; token: string; testEventCode: string };

export const GRAPH = "https://graph.facebook.com/v27.0";

const RETRYABLE = [1, 2, 4, 17, 341, 613];

function config(read: Credentials<"meta">): Meta | undefined {
  const pixelId = read("pixelId");
  const token = read("token");
  return pixelId && token ? { pixelId, token, testEventCode: read("testEventCode") } : undefined;
}

async function send(config: Meta, data: object[]): Promise<Failure | null> {
  try {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(config.pixelId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data,
        access_token: config.token,
        ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = jsonObject(await response.text());
    if (response.ok && body?.events_received === data.length) return null;
    const error = body?.error;
    const code = isObject(error) ? error.code : undefined;
    const trace = isObject(error) ? error.fbtrace_id : undefined;
    console.warn(`[librefunnel] meta capi HTTP ${response.status} code ${String(code)} trace ${String(trace)}`);
    return response.status >= 500 || (typeof code === "number" && RETRYABLE.includes(code))
      ? "UNREACHABLE"
      : "REJECTED";
  } catch {
    return "UNREACHABLE";
  }
}

function nameParts(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

function browser(row: Sale | Visit) {
  return {
    ...(isIP(row.ip) ? { client_ip_address: row.ip } : {}),
    client_user_agent: row.userAgent,
    ...(row.fbp ? { fbp: row.fbp } : {}),
    ...(row.fbc ? { fbc: row.fbc } : {}),
  };
}

function sale(row: Sale) {
  const parts = nameParts(row.buyer);
  const contents = [{ id: row.product, quantity: 1, item_price: row.productAmount / 100 }];
  if (row.bump && row.bumpAmount) contents.push({ id: row.bump, quantity: 1, item_price: row.bumpAmount / 100 });

  return {
    event_name: row.name,
    event_time: Math.floor(row.at.getTime() / 1000),
    event_id: `${row.orderId}:${row.name}`,
    action_source: "website",
    event_source_url: row.url,
    user_data: {
      em: [sha256(row.email)],
      ...(row.phone ? { ph: [sha256(row.phone)] } : {}),
      ...(parts[0] ? { fn: [sha256(parts[0])] } : {}),
      ...(parts.length > 1 ? { ln: [sha256(parts[parts.length - 1] ?? "")] } : {}),
      country: [sha256("br")],
      // The visitor id ties this buyer to the ViewContent and InitiateCheckout they sent before buying.
      external_id: [sha256(row.customerId), ...(row.visitorId ? [sha256(row.visitorId)] : [])],
      ...browser(row),
    },
    custom_data: {
      currency: "BRL",
      value: row.amount / 100,
      content_ids: contents.map((item) => item.id),
      contents,
      content_type: "product",
      num_items: contents.length,
      order_id: row.orderId,
    },
  };
}

function visit(row: Visit) {
  return {
    event_name: row.name,
    event_time: Math.floor(row.at.getTime() / 1000),
    event_id: row.eventId,
    action_source: "website",
    event_source_url: row.url,
    user_data: { external_id: [sha256(row.visitorId)], ...browser(row) },
    custom_data: { currency: "BRL", value: row.price / 100, content_ids: [row.product], content_type: "product" },
  };
}

export const meta: Destination<Meta, "meta"> = {
  config,
  // Meta refuses the whole request for one event older than 7 days.
  maxAge: 7 * 86400 - 3600,
  batch: 100,
  sale,
  visit,
  send,
  test: (config) =>
    send(config, [
      {
        event_name: "LibreFunnelTest",
        event_time: now(),
        action_source: "system_generated",
        user_data: { external_id: [sha256("librefunnel-test")] },
      },
    ]),
};
