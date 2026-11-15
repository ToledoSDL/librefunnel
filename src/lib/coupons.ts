import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Product } from "./catalog";
import { db } from "./db";
import type { Database } from "./db";
import { limited, throttled } from "./guard";
import { parseCouponCode } from "./input";
import { coupon, customer, order } from "./schema";

export type CouponCode =
  | "COUPON_NOT_FOUND"
  | "COUPON_EXPIRED"
  | "COUPON_EXHAUSTED"
  | "COUPON_USED"
  | "COUPON_OTHER_PRODUCT"
  | "COUPON_TAKEN"
  | "INVALID_COUPON_CODE"
  | "INVALID_DISCOUNT"
  | "INVALID_USES"
  | "INVALID_TRANSITION";
export type Coupon = Omit<typeof coupon.$inferSelect, "createdAt">;
export type CouponFields = Omit<Coupon, "uses">;
export type Applied = { coupon: string; discount: number };

// A discounted price never goes under R$ 1,00, the lowest price a product can have.
const FLOOR = 100;
const TRIES = 5;

const COLUMNS = {
  code: coupon.code,
  kind: coupon.kind,
  value: coupon.value,
  products: coupon.products,
  expiresAt: coupon.expiresAt,
  maxUses: coupon.maxUses,
  uses: coupon.uses,
  oncePerEmail: coupon.oncePerEmail,
};

function couponDiscount(found: Pick<Coupon, "kind" | "value">, price: number): number {
  const off = found.kind === "percent" ? Math.floor((price * found.value) / 100) : found.value;
  return Math.min(off, price - FLOOR);
}

// A refunded order still counts, so a refund never frees the coupon for the same buyer.
async function usedBy(executor: Database, code: string, buyer: SQL): Promise<boolean> {
  const [used] = await executor
    .select({ id: order.id })
    .from(order)
    .where(and(eq(order.coupon, code), buyer, inArray(order.status, ["paid", "refunded"])))
    .limit(1);

  return used !== undefined;
}

// The checkout's answer; the payment checks the limit and the buyer again, under a lock, before the use counts.
async function applyCoupon(
  code: string,
  product: Product,
  email: string | null,
): Promise<Applied | { code: CouponCode }> {
  const [found] = await db().select(COLUMNS).from(coupon).where(eq(coupon.code, code));
  if (!found) return { code: "COUPON_NOT_FOUND" };
  if (found.expiresAt && found.expiresAt <= new Date()) return { code: "COUPON_EXPIRED" };
  const discount = couponDiscount(found, product.price);
  if ((found.products.length && !found.products.includes(product.slug)) || discount < 1)
    return { code: "COUPON_OTHER_PRODUCT" };
  if (found.maxUses !== null && found.uses >= found.maxUses) return { code: "COUPON_EXHAUSTED" };

  const buyer = email
    ? inArray(order.customerId, db().select({ id: customer.id }).from(customer).where(eq(customer.email, email)))
    : undefined;

  if (buyer && found.oncePerEmail && (await usedBy(db(), code, buyer))) return { code: "COUPON_USED" };
  return { coupon: code, discount };
}

// Only refused codes count toward the limit, so a buyer fixing a typo is not locked out but codes cannot be guessed.
export async function tryCoupon(
  raw: string,
  product: Product,
  email: string | null,
  ip: string,
): Promise<Applied | { code: CouponCode | "RATE_LIMITED" }> {
  if (throttled("coupon", ip, TRIES)) return { code: "RATE_LIMITED" };
  const code = parseCouponCode(raw);

  const applied: Applied | { code: CouponCode } = code
    ? await applyCoupon(code, product, email)
    : { code: "COUPON_NOT_FOUND" };

  if ("code" in applied) limited("coupon", ip, TRIES, 60);
  return applied;
}

// Locks the coupon until the payment's transaction ends, so concurrent payments are counted one after the other.
export async function couponOpen(tx: Database, code: string, customerId: string): Promise<boolean> {
  const [found] = await tx
    .select({ maxUses: coupon.maxUses, uses: coupon.uses, oncePerEmail: coupon.oncePerEmail })
    .from(coupon)
    .where(eq(coupon.code, code))
    .for("update");

  // A coupon deleted after the order was placed keeps the price the buyer was shown.
  if (!found) return true;
  if (found.maxUses !== null && found.uses >= found.maxUses) return false;
  return !(found.oncePerEmail && (await usedBy(tx, code, eq(order.customerId, customerId))));
}

export async function countUse(tx: Database, code: string) {
  await tx
    .update(coupon)
    .set({ uses: sql`${coupon.uses} + 1` })
    .where(eq(coupon.code, code));
}

export function coupons(): Promise<Coupon[]> {
  return db().select(COLUMNS).from(coupon).orderBy(desc(coupon.createdAt), coupon.code);
}

export async function saveCoupon(fields: CouponFields, created: boolean): Promise<CouponCode | null> {
  if (created) {
    const inserted = await db()
      .insert(coupon)
      .values({ ...fields, createdAt: new Date() })
      .onConflictDoNothing({ target: coupon.code })
      .returning({ code: coupon.code });

    return inserted.length === 1 ? null : "COUPON_TAKEN";
  }

  const { code, ...changes } = fields;
  const changed = await db().update(coupon).set(changes).where(eq(coupon.code, code)).returning({ code: coupon.code });
  return changed.length === 1 ? null : "INVALID_TRANSITION";
}

export async function deleteCoupon(code: string): Promise<boolean> {
  const deleted = await db().delete(coupon).where(eq(coupon.code, code)).returning({ code: coupon.code });
  return deleted.length === 1;
}
