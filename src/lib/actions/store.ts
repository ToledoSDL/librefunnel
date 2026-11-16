"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as catalog from "../catalog/products";
import { clientIp, demoMode } from "../guard";
import { isAdmin, signInAdmin, signOutAdmin } from "../sessions";
import { LINK, parseCpfCnpj, parseEmail, parseInteger, parseLine, parseMedia, parsePhone, parseTitle } from "../input";
import * as messages from "../messages";
import { company } from "../registry";
import * as config from "../settings";
import * as updates from "../updates";
import { done, field } from "./form";
import type { ActionState, FormArgs } from "./form";

export async function adminSignIn(...[, form]: FormArgs): Promise<ActionState> {
  const code = await signInAdmin(field(form, "password"), clientIp(await headers()));
  if (code) return { code };
  redirect("/admin");
}

export async function adminSignOut(): Promise<ActionState> {
  await signOutAdmin();
  redirect("/admin");
}

// Each settings screen posts only its own fields, so only the keys present in the form are validated and saved.
export async function saveSettings(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const values: config.SettingValues = {};
  const sent = (name: string) => form.has(name);

  if (sent("brand")) {
    const brand = parseTitle(field(form, "brand"));
    if (!brand) return { code: "INVALID_TITLE" };
    values.brand = brand;
  }

  for (const [name, key] of [
    ["ownerEmail", "owner_email"],
    ["supportEmail", "support_email"],
  ] satisfies [string, keyof config.SettingValues][]) {
    if (!sent(name)) continue;
    const raw = field(form, name).trim();
    const email = raw ? parseEmail(raw) : "";
    if (raw && !email) return { code: "INVALID_EMAIL" };
    values[key] = email ?? "";
  }

  for (const [name, key] of [
    ["ownerWhatsapp", "owner_whatsapp"],
    ["supportWhatsapp", "support_whatsapp"],
  ] satisfies [string, keyof config.SettingValues][]) {
    if (!sent(name)) continue;
    const raw = field(form, name).trim();
    const phone = raw ? parsePhone(raw) : "";
    if (raw && !phone) return { code: "INVALID_PHONE" };
    values[key] = phone ?? "";
  }

  for (const [name, key] of [
    ["termsUrl", "terms_url"],
    ["privacyUrl", "privacy_url"],
    ["thanksUrl", "thanks_url"],
  ] satisfies [string, keyof config.SettingValues][]) {
    if (!sent(name)) continue;
    const url = field(form, name).trim();
    if (url && !LINK.test(url)) return { code: "INVALID_URL" };
    values[key] = url;
  }

  for (const [name, key, max] of [
    ["termsVersion", "terms_version", 40],
    ["legalName", "legal_name", 120],
    ["description", "description", 200],
    ["checkoutButton", "checkout_button", 40],
    ["checkoutNotice", "checkout_notice", 200],
    ["thanksLabel", "thanks_label", 40],
  ] satisfies [string, keyof config.SettingValues, number][]) {
    if (!sent(name)) continue;
    const text = parseLine(field(form, name), max);
    if (text === undefined) return { code: "INVALID_TEXT" };
    values[key] = text ?? "";
  }

  for (const [name, key] of [
    ["logo", "logo"],
    ["icon", "icon"],
    ["shareImage", "share_image"],
  ] satisfies [string, keyof config.SettingValues][]) {
    if (!sent(name)) continue;
    const path = parseMedia(field(form, name));
    if (path === undefined) return { code: "INVALID_MEDIA" };
    values[key] = path ?? "";
  }

  for (const [name, key] of [
    ["poweredBy", "powered_by"],
    ["confirmEmail", "confirm_email"],
    ["checkoutCountdown", "checkout_countdown"],
    ["checkoutTrust", "checkout_trust"],
    ["checkoutGuarantee", "checkout_guarantee"],
    ["checkoutTestimonials", "checkout_testimonials"],
  ] satisfies [string, keyof config.SettingValues][]) {
    if (sent(name)) values[key] = field(form, name) === "1" ? "1" : "0";
  }

  if (sent("orderHours")) {
    const orderHours = parseInteger(field(form, "orderHours"), 1, 720);
    const lastStep = (await messages.recoverySteps()).at(-1)?.afterMinutes ?? 0;
    if (orderHours === undefined || lastStep >= orderHours * 60) return { code: "INVALID_ORDER_HOURS" };
    values.order_hours = String(orderHours);
  }

  if (sent("accent")) {
    const accent = field(form, "accent").trim().toLowerCase();
    if (accent && !/^#[0-9a-f]{6}$/.test(accent)) return { code: "INVALID_COLOR" };
    values.accent = accent;
  }

  if (sent("document")) {
    const document = parseCpfCnpj(field(form, "document"));
    if (document === undefined) return { code: "INVALID_DOCUMENT" };
    values.document = document ?? "";
    // A CNPJ brings its legal name when that field was left blank.
    if (document?.length === 14 && sent("legalName") && !values.legal_name)
      values.legal_name = (await company(document))?.name ?? "";
  }

  if (sent("home")) {
    const home = field(form, "home");
    if (home && home !== config.MEMBERS_HOME) {
      const product = await catalog.getProduct(home);
      if (!product || product.archived) return { code: "PRODUCT_NOT_FOUND" };
    }

    values.home = home;
  }

  if (sent("checkoutPhone")) {
    const mode = config.CHECKOUT_PHONE.find((option) => option === field(form, "checkoutPhone"));
    if (!mode) return { code: "INVALID_PAYLOAD" };
    values.checkout_phone = mode;
  }

  if (sent("checkoutTheme")) {
    const theme = config.CHECKOUT_THEME.find((option) => option === field(form, "checkoutTheme"));
    if (!theme) return { code: "INVALID_PAYLOAD" };
    values.checkout_theme = theme;
  }

  await config.saveSettings(values);
  return done(null);
}

export async function updateStore(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };

  const code = await updates.startUpdate(field(form, "version"));

  return code ? { code } : { code: null, ok: true };
}

export async function restartStore(): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };

  const code = await updates.restartStore();

  return code ? { code } : { code: null, ok: true };
}

export async function saveAutoUpdate(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };

  const code = await updates.setAutoUpdate(field(form, "hour"));

  return code ? { code } : done(null);
}
