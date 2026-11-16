"use server";

import { redirect } from "next/navigation";
import * as catalog from "../catalog/products";
import { demoMode, limited } from "../guard";
import {
  parseConversionAction,
  parseCredential,
  parseGoogleAccount,
  parseGoogleTags,
  parseMetaPixel,
  parseTikTokPixel,
  parseVerifications,
} from "../input";
import { isAdmin } from "../sessions";
import * as config from "../settings";
import { saveProductAccount } from "../tracking/accounts";
import { testConversions } from "../tracking/conversions";
import { authorizeUrl } from "../tracking/googleads";
import { done, field } from "./form";
import type { ActionState, FormArgs } from "./form";

// Unchecked switches send nothing, so a missing field is "off".
function switched(form: FormData, name: string): string {
  return field(form, name) === "1" ? "1" : "";
}

function testCode(form: FormData): string | undefined {
  const code = field(form, "testEventCode").trim();
  return !code || /^[A-Za-z0-9]{1,40}$/.test(code) ? code : undefined;
}

// Saving tests the connection at once, so one click tells the seller it works or why not. The values stay saved either
// way, so a fix is one field away.
export async function saveMeta(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const pixelId = parseMetaPixel(field(form, "pixelId"));
  if (!pixelId) return { code: "INVALID_PIXEL_ID" };
  const testEventCode = testCode(form);
  if (testEventCode === undefined) return { code: "INVALID_TEST_EVENT_CODE" };
  const token = parseCredential(field(form, "token"));
  if (token === undefined || (!token && !(await config.credentials("meta"))("meta")("token")))
    return { code: "INVALID_CREDENTIAL" };
  if (limited("test", "meta", 10, 600)) return { code: "RATE_LIMITED" };
  await config.saveCredentials("meta", { pixelId, testEventCode, pixel: switched(form, "pixel") }, { token });
  return done(await testConversions("meta"));
}

export async function saveTikTok(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const pixelCode = parseTikTokPixel(field(form, "pixelCode"));
  if (!pixelCode) return { code: "INVALID_TIKTOK_PIXEL" };
  const testEventCode = testCode(form);
  if (testEventCode === undefined) return { code: "INVALID_TEST_EVENT_CODE" };
  const token = parseCredential(field(form, "token"));
  if (token === undefined || (!token && !(await config.credentials("tiktok"))("tiktok")("token")))
    return { code: "INVALID_CREDENTIAL" };
  if (limited("test", "tiktok", 10, 600)) return { code: "RATE_LIMITED" };
  await config.saveCredentials("tiktok", { pixelCode, testEventCode, pixel: switched(form, "pixel") }, { token });
  return done(await testConversions("tiktok"));
}

// The whole Google tag code carries the Google Ads id too: pasted here, it fills that in when it is still empty.
export async function saveAnalytics(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const tags = parseGoogleTags(field(form, "measurementId"));
  if (!tags.analytics) return { code: "INVALID_MEASUREMENT_ID" };
  const stored = await config.credentials("analytics", "googleads");
  const apiSecret = parseCredential(field(form, "apiSecret"));
  if (apiSecret === undefined || (!apiSecret && !stored("analytics")("apiSecret")))
    return { code: "INVALID_CREDENTIAL" };
  if (limited("test", "analytics", 10, 600)) return { code: "RATE_LIMITED" };
  await config.saveCredentials(
    "analytics",
    { measurementId: tags.analytics, tag: switched(form, "tag") },
    { apiSecret },
  );
  if (tags.ads && !stored("googleads")("tagId")) await config.saveCredentials("googleads", { tagId: tags.ads });
  return done(await testConversions("analytics"));
}

// Saving a new OAuth client goes straight to Google's login, which comes back to the panel connected and tested.
export async function saveGoogleAds(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const customerId = parseGoogleAccount(field(form, "customerId"));
  const typedLogin = field(form, "loginCustomerId").trim();
  const loginCustomerId = typedLogin ? parseGoogleAccount(typedLogin) : "";
  if (!customerId || loginCustomerId === undefined) return { code: "INVALID_GOOGLE_ADS_ACCOUNT" };
  const actionId = parseConversionAction(field(form, "actionId"));
  if (!actionId) return { code: "INVALID_CONVERSION_ACTION" };
  const typedTag = field(form, "tagId").trim();
  const tagId = typedTag ? parseGoogleTags(typedTag).ads : "";
  if (tagId === undefined) return { code: "INVALID_GOOGLE_TAG" };
  const clientId = field(form, "clientId").trim();
  if (!/^[\w-]{10,200}\.apps\.googleusercontent\.com$/.test(clientId)) return { code: "INVALID_CREDENTIAL" };
  const clientSecret = parseCredential(field(form, "clientSecret"));
  const stored = (await config.credentials("googleads"))("googleads");
  if (clientSecret === undefined || (!clientSecret && !stored("clientSecret"))) return { code: "INVALID_CREDENTIAL" };
  await config.saveCredentials(
    "googleads",
    { clientId, customerId, loginCustomerId, actionId, tagId },
    { clientSecret },
  );
  if (stored("refreshToken") && stored("clientId") === clientId && !clientSecret)
    return done(await testConversions("googleads"));
  return connectGoogle();
}

export async function connectGoogle(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const url = await authorizeUrl();
  if (!url) return { code: "GOOGLE_ADS_NOT_CONFIGURED" };
  redirect(url);
}

// Each product domain is its own Search Console property with its own code; Meta uses one code per business.
export async function saveVerification(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const google = parseVerifications(field(form, "google"), 20);
  const meta = parseVerifications(field(form, "meta"), 1);
  if (!google || !meta) return { code: "INVALID_VERIFICATION" };
  await config.saveSettings({ google_verification: google.join(" "), meta_verification: meta[0] ?? "" });
  return done(null);
}

// A product's own pixels and conversion action. A blank id goes back to the store's connection.
export async function saveProductAds(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const product = await catalog.getProduct(field(form, "slug"));
  if (!product) return { code: "PRODUCT_NOT_FOUND" };
  const typed = (name: string) => field(form, name).trim();
  const metaPixel = typed("metaPixel") ? parseMetaPixel(typed("metaPixel")) : "";
  if (metaPixel === undefined) return { code: "INVALID_PIXEL_ID" };
  const tiktokPixel = typed("tiktokPixel") ? parseTikTokPixel(typed("tiktokPixel")) : "";
  if (tiktokPixel === undefined) return { code: "INVALID_TIKTOK_PIXEL" };
  const measurementId = typed("measurementId") ? parseGoogleTags(typed("measurementId")).analytics : "";
  if (measurementId === undefined) return { code: "INVALID_MEASUREMENT_ID" };
  const actionId = typed("actionId") ? parseConversionAction(typed("actionId")) : "";
  if (actionId === undefined) return { code: "INVALID_CONVERSION_ACTION" };
  const customerId = typed("customerId") ? parseGoogleAccount(typed("customerId")) : "";
  if (customerId === undefined) return { code: "INVALID_GOOGLE_ADS_ACCOUNT" };
  const metaToken = parseCredential(field(form, "metaToken"));
  const tiktokToken = parseCredential(field(form, "tiktokToken"));
  const apiSecret = parseCredential(field(form, "apiSecret"));
  if (metaToken === undefined || tiktokToken === undefined || apiSecret === undefined)
    return { code: "INVALID_CREDENTIAL" };
  await saveProductAccount(product.slug, "meta", { pixelId: metaPixel }, { token: metaToken });
  await saveProductAccount(product.slug, "tiktok", { pixelCode: tiktokPixel }, { token: tiktokToken });
  await saveProductAccount(product.slug, "analytics", { measurementId }, { apiSecret });
  await saveProductAccount(product.slug, "googleads", { actionId, customerId }, {});
  return done(null);
}
