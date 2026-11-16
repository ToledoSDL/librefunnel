"use server";

import { headers } from "next/headers";
import * as catalog from "../catalog/products";
import * as coupons from "../coupons";
import { clientIp } from "../guard";
import { isAdmin } from "../sessions";
import { SLUG, parseCouponCode, parseEmail, parseInteger, parsePrice } from "../input";
import { column, done, field } from "./form";
import type { ActionState, FormArgs } from "./form";

export type CouponState = ActionState & { coupon?: string; discount?: number };

// The checkout's "Aplicar" button: the discount it shows is computed here and again when the order is placed.
export async function checkCoupon(...[, form]: FormArgs): Promise<CouponState> {
  const product = await catalog.getProduct(field(form, "slug"));
  if (!product || product.archived) return { code: "PRODUCT_NOT_FOUND" };
  const email = parseEmail(field(form, "email")) ?? null;
  const applied = await coupons.tryCoupon(field(form, "coupon"), product, email, clientIp(await headers()));
  return "code" in applied ? { code: applied.code } : { code: null, ok: true, ...applied };
}

export async function saveCoupon(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const code = parseCouponCode(field(form, "code"));
  if (!code) return { code: "INVALID_COUPON_CODE" };
  const kind = field(form, "kind");
  if (kind !== "percent" && kind !== "fixed") return { code: "INVALID_PAYLOAD" };
  const value = kind === "percent" ? parseInteger(field(form, "value"), 1, 99) : parsePrice(field(form, "value"));
  if (value === undefined) return { code: "INVALID_DISCOUNT" };
  const expiry = field(form, "expiresAt").trim();
  const expiresAt = expiry ? new Date(expiry) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return { code: "INVALID_DATE" };
  const uses = field(form, "maxUses").trim();
  const maxUses = uses ? parseInteger(uses, 1, 1_000_000) : null;
  if (maxUses === undefined) return { code: "INVALID_USES" };
  const products = column(form, "products");
  if (products.some((slug) => !SLUG.test(slug))) return { code: "INVALID_PAYLOAD" };

  const saved = await coupons.saveCoupon(
    { code, kind, value, products, expiresAt, maxUses, oncePerEmail: field(form, "oncePerEmail") === "1" },
    field(form, "editing") !== "1",
  );

  return done(saved);
}

export async function deleteCoupon(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await coupons.deleteCoupon(field(form, "code"))) ? null : "INVALID_TRANSITION");
}
