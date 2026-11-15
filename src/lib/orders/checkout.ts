import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { orderBump, settings } from "../catalog";
import type { Product } from "../catalog";
import type { Applied } from "../coupons";
import { addSeconds, db, newId, one } from "../db";
import { ID } from "../input";
import { recoverySteps } from "../messages";
import { customer, order } from "../schema";
import { orderStep } from "../tracking";
import { brCode } from "./pix";
import { formatFirstName, formatMaskedEmail } from "@/format";

export type OrderStatus = (typeof order.$inferSelect)["status"];

export type OrderCode =
  | "PRODUCT_NOT_FOUND"
  | "OFFER_ENDED"
  | "INVALID_NAME"
  | "INVALID_EMAIL"
  | "INVALID_PHONE"
  | "RATE_LIMITED"
  | "ORDER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_AMOUNT"
  | "UNDERPAID"
  | "DUPLICATE_PAYMENT"
  | "PSP_NOT_CONFIGURED"
  | "PSP_REJECTED"
  | "PSP_UNREACHABLE"
  | "CRYPTO_REFUSED"
  | "INVALID_WALLET";

export type PixOrder = {
  id: string;
  product: string;
  bump: string | null;
  amount: number;
  firstName: string;
  maskedEmail: string;
  status: OrderStatus;
  txid: string;
  pixCode: string;
  payUrl: string | null;
  expiresAt: Date;
};

export type OrderInput = {
  product: Product;
  name: string;
  email: string;
  phone: string | null;
  document: string | null;
  coupon: Applied | undefined;
  bump: boolean;
  ownOrder: string | undefined;
  visitorId: string;
  ip: string;
  userAgent: string;
  fbp: string | null;
  fbc: string | null;
};

export function offerOpen(product: Product): boolean {
  return product.offerEndsAt === undefined || product.offerEndsAt > new Date();
}

export async function getPixOrder(id: string, slug: string): Promise<PixOrder | undefined> {
  if (!ID.test(id)) return undefined;

  const [row] = await db()
    .select({
      id: order.id,
      product: order.product,
      bump: order.bump,
      amount: order.amount,
      name: order.name,
      email: customer.email,
      status: order.status,
      txid: order.txid,
      pixCode: order.pixCode,
      expiresAt: order.expiresAt,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.id, id), eq(order.product, slug)));

  if (!row) return undefined;
  return {
    id: row.id,
    product: row.product,
    bump: row.bump,
    amount: row.amount,
    firstName: formatFirstName(row.name),
    maskedEmail: formatMaskedEmail(row.email),
    status: row.status === "pending" && row.expiresAt <= new Date() ? "expired" : row.status,
    txid: row.txid,
    pixCode: row.pixCode,
    // A BR Code starts with "000201"; a provider that only hosts its own payment page stores that page's address.
    payUrl: row.pixCode.startsWith("https://") ? row.pixCode : null,
    expiresAt: row.expiresAt,
  };
}

export async function placeOrder(input: OrderInput): Promise<{ id: string } | { code: OrderCode }> {
  if (input.product.archived) return { code: "PRODUCT_NOT_FOUND" };
  if (!offerOpen(input.product)) return { code: "OFFER_ENDED" };
  const productAmount = input.product.price - (input.coupon?.discount ?? 0);
  const bump = input.bump ? await orderBump(input.product) : undefined;
  const store = await settings();
  const firstStep = (await recoverySteps())[0];
  const t = new Date();
  return db().transaction(async (tx) => {
    // The upsert locks the customer row, so one buyer's concurrent checkouts run one after the other.
    const { id: customerId } = one(
      await tx
        .insert(customer)
        .values({ id: newId(), email: input.email, createdAt: t })
        .onConflictDoUpdate({ target: customer.email, set: { email: sql`excluded.email` } })
        .returning({ id: customer.id }),
    );

    const [open] = await tx
      .select({
        id: order.id,
        bump: order.bump,
        name: order.name,
        phone: order.phone,
        document: order.document,
        coupon: order.coupon,
        expiresAt: order.expiresAt,
      })
      .from(order)
      .where(and(eq(order.customerId, customerId), eq(order.product, input.product.slug), eq(order.status, "pending")));

    if (open) {
      // Only the browser that placed the order gets it back: anyone else typing the buyer's details would receive their order id.
      const same =
        open.id === input.ownOrder &&
        open.bump === (bump?.slug ?? null) &&
        open.name === input.name &&
        open.phone === input.phone &&
        open.document === input.document &&
        open.coupon === (input.coupon?.coupon ?? null);

      if (same && open.expiresAt > t) return { id: open.id };
      await tx
        .update(order)
        .set({ status: sql`CASE WHEN ${lte(order.expiresAt, t)} THEN 'expired' ELSE 'canceled' END`, recoveryAt: null })
        .where(and(eq(order.id, open.id), eq(order.status, "pending")));
    }
    const id = newId();
    const amount = productAmount + (bump?.bumpPrice ?? 0);
    await tx.insert(order).values({
      id,
      customerId,
      product: input.product.slug,
      bump: bump?.slug ?? null,
      productAmount,
      bumpAmount: bump?.bumpPrice ?? null,
      name: input.name,
      phone: input.phone,
      document: input.document,
      coupon: input.coupon?.coupon ?? null,
      discount: input.coupon?.discount ?? null,
      txid: id,
      pixCode: brCode(input.product.pix, amount, id),
      expiresAt: addSeconds(t, store.orderHours * 3600),
      recoveryAt: firstStep ? addSeconds(t, firstStep.afterMinutes * 60) : null,
      visitorId: input.visitorId,
      ip: input.ip,
      userAgent: input.userAgent,
      fbp: input.fbp,
      fbc: input.fbc,
      termsVersion: store.termsVersion,
      createdAt: t,
    });
    // A buyer correcting their details replaces a live order: Meta already has this checkout.
    if (!open || open.expiresAt <= t) await orderStep(tx, id, "created");
    return { id };
  });
}

export async function expireOrders() {
  await db()
    .update(order)
    .set({ status: "expired", recoveryAt: null })
    .where(and(eq(order.status, "pending"), lte(order.expiresAt, new Date())));
}
