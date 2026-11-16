import "server-only";
import { randomBytes } from "node:crypto";
import { baseUrl, isObject, jsonObject, safeEqual, sha256 } from "../guard";
import type { JsonObject } from "../guard";
import { credentials, saveCredentials } from "../settings";
import type { Credentials } from "../settings";
import { googleEmail } from "./analytics";
import type { Destination, Failure, Sale } from "./conversions";

export type GoogleAuthCode = "GOOGLE_AUTH_EXPIRED" | "GOOGLE_AUTH_DENIED" | "GOOGLE_AUTH_FAILED";

type GoogleAds = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId: string;
  actionId: string;
};

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";

const TOKEN = "https://oauth2.googleapis.com/token";

// Since June 2026 Google takes new offline conversion integrations only through the Data Manager API.
const INGEST = "https://datamanager.googleapis.com/v1/events:ingest";

const SCOPE = "https://www.googleapis.com/auth/datamanager";

const STATE_TTL_MS = 10 * 60_000;

function config(read: Credentials<"googleads">): GoogleAds | undefined {
  const value = {
    clientId: read("clientId"),
    clientSecret: read("clientSecret"),
    refreshToken: read("refreshToken"),
    customerId: read("customerId"),
    loginCustomerId: read("loginCustomerId") || read("customerId"),
    actionId: read("actionId"),
  };

  return Object.values(value).every(Boolean) ? value : undefined;
}

export function redirectUri(): string {
  return `${baseUrl()}/api/google/callback`;
}

async function token(body: Record<string, string>): Promise<{ status: number; body: JsonObject | undefined }> {
  try {
    const response = await fetch(TOKEN, {
      method: "POST",
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15_000),
    });

    const parsed = jsonObject(await response.text());
    if (!response.ok) console.warn(`[librefunnel] google oauth HTTP ${response.status} ${String(parsed?.error)}`);
    return { status: response.status, body: parsed };
  } catch {
    return { status: 0, body: undefined };
  }
}

async function ingest(config: GoogleAds, events: object[], validateOnly: boolean): Promise<Failure | null> {
  const granted = await token({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const access = granted.body?.access_token;
  // A revoked or expired login is refused for good until the seller connects again.
  if (typeof access !== "string") return granted.status === 0 || granted.status >= 500 ? "UNREACHABLE" : "REJECTED";

  try {
    const response = await fetch(INGEST, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        destinations: [
          {
            operatingAccount: { accountType: "GOOGLE_ADS", accountId: config.customerId },
            loginAccount: { accountType: "GOOGLE_ADS", accountId: config.loginCustomerId },
            productDestinationId: config.actionId,
          },
        ],
        encoding: "HEX",
        events,
        validateOnly,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) return null;
    const error = jsonObject(await response.text())?.error;
    console.warn(
      `[librefunnel] google data manager HTTP ${response.status} ${String(isObject(error) && error.status)}`,
    );
    return response.status >= 500 || response.status === 429 ? "UNREACHABLE" : "REJECTED";
  } catch {
    return "UNREACHABLE";
  }
}

function identifiers(email: string, phone: string | null) {
  return {
    userIdentifiers: [
      { emailAddress: sha256(googleEmail(email)) },
      ...(phone ? [{ phoneNumber: sha256(`+${phone}`) }] : []),
    ],
  };
}

function sale(row: Sale) {
  // Google takes one click id per conversion: gbraid and wbraid only stand in when there is no gclid.
  const click = row.clicks.gclid
    ? { gclid: row.clicks.gclid }
    : row.clicks.gbraid
      ? { gbraid: row.clicks.gbraid }
      : row.clicks.wbraid
        ? { wbraid: row.clicks.wbraid }
        : undefined;

  return {
    ...(click ? { adIdentifiers: click } : {}),
    transactionId: row.orderId,
    eventTimestamp: row.at.toISOString(),
    conversionValue: row.amount / 100,
    currency: "BRL",
    eventSource: "WEB",
    userData: identifiers(row.email, row.phone),
  };
}

export const googleAds: Destination<GoogleAds, "googleads"> = {
  config,
  // Google Ads counts a conversion up to 90 days after the click.
  maxAge: 90 * 86400 - 3600,
  batch: 100,
  sale,
  send: (config, events) => ingest(config, events, false),
  // Checks the login, the account and the conversion action without recording anything.
  test: (config) =>
    ingest(
      config,
      [
        {
          transactionId: "librefunnel-test",
          eventTimestamp: new Date().toISOString(),
          conversionValue: 1,
          currency: "BRL",
          eventSource: "WEB",
          userData: identifiers("teste@librefunnel.com", null),
        },
      ],
      true,
    ),
};

// The Google login page for "Conectar com Google", or undefined while the OAuth client is not saved.
export async function authorizeUrl(): Promise<string | undefined> {
  const read = (await credentials("googleads"))("googleads");
  const clientId = read("clientId");
  if (!clientId || !read("clientSecret")) return undefined;
  const state = randomBytes(24).toString("base64url");
  await saveCredentials("googleads", { state, stateAt: String(Date.now()) });

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${AUTHORIZE}?${query}`;
}

// The admin cookie does not come back from Google's page (SameSite=Strict), so the one-time state the admin's request
// stored is what proves this login was started from the panel.
export async function finishAuthorization(code: string, state: string): Promise<GoogleAuthCode | null> {
  const read = (await credentials("googleads"))("googleads");
  const expected = read("state");
  const fresh = Date.now() - Number(read("stateAt")) < STATE_TTL_MS;
  if (!expected || !fresh || !safeEqual(state, expected)) return "GOOGLE_AUTH_EXPIRED";
  await saveCredentials("googleads", { state: "", stateAt: "" });

  const granted = await token({
    code,
    client_id: read("clientId"),
    client_secret: read("clientSecret"),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });

  const refreshToken = granted.body?.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) return "GOOGLE_AUTH_FAILED";
  await saveCredentials("googleads", {}, { refreshToken });
  return null;
}
