import "server-only";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { countUse, couponOpen } from "../coupons";
import type { CouponCode } from "../coupons";
import { db, one } from "../db";
import type { Database } from "../db";
import { demoMode } from "../guard";
import type { GuardCode } from "../guard";
import { cancelInvoice, queueInvoice } from "../invoices";
import { enqueueSale } from "../messages";
import { customer, order, payment } from "../schema";
import { orderStep } from "../tracking";
import type { OrderCode, OrderStatus } from "./checkout";

type StoredOrder = {
  id: string;
  status: OrderStatus;
  amount: number;
  customerId: string;
  email: string;
  phone: string | null;
  name: string;
  product: string;
  bump: string | null;
  coupon: string | null;
};

// Locks the order row: concurrent webhooks and owner releases for one order run one after the other.
async function findOrder(tx: Database, reference: string): Promise<StoredOrder | undefined> {
  const [row] = await tx
    .select({
      id: order.id,
      status: order.status,
      amount: order.amount,
      customerId: order.customerId,
      email: customer.email,
      phone: order.phone,
      name: order.name,
      product: order.product,
      bump: order.bump,
      coupon: order.coupon,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(or(eq(order.id, reference), eq(order.txid, reference)))
    .for("update", { of: order });

  return row;
}

async function insertPayment(
  tx: Database,
  orderId: string,
  amount: number,
  source: "webhook" | "admin",
  externalId: string | null,
  payload: string | null,
): Promise<number | undefined> {
  const inserted = await tx
    .insert(payment)
    .values({ orderId, amount, source, externalId, payload, createdAt: new Date() })
    .onConflictDoNothing({ target: payment.externalId })
    .returning({ id: payment.id });

  return inserted.length === 0 ? undefined : received(tx, orderId);
}

async function received(tx: Database, orderId: string): Promise<number> {
  const { net } = one(
    await tx
      .select({ net: sql<number>`COALESCE(SUM(${payment.amount}), 0)`.mapWith(Number) })
      .from(payment)
      .where(eq(payment.orderId, orderId)),
  );

  return net;
}

async function markPaid(tx: Database, found: StoredOrder, manual = false): Promise<OrderCode | CouponCode | null> {
  // The money stays recorded and the order pending, so the seller decides; a release by hand counts past the limit.
  if (found.coupon && !manual && !(await couponOpen(tx, found.coupon, found.customerId))) return "COUPON_EXHAUSTED";

  const changed = await tx
    .update(order)
    .set({ status: "paid", recoveryAt: null, pspCheckAt: null })
    .where(and(eq(order.id, found.id), eq(order.status, found.status)))
    .returning({ id: order.id });

  if (changed.length !== 1) return "INVALID_TRANSITION";
  if (found.coupon) await countUse(tx, found.coupon);
  await orderStep(tx, found.id, "paid");
  await enqueueSale(tx, found);
  await queueInvoice(tx, found.id);
  return null;
}

export function recordPayment(
  reference: string,
  amount: number,
  externalId: string,
  payload: string,
): Promise<OrderCode | CouponCode | null> {
  return db().transaction(async (tx) => {
    const found = await findOrder(tx, reference);
    if (!found) return "ORDER_NOT_FOUND";
    const settled = found.status === "paid" || found.status === "refunded";
    // A released order is never debited past what it received (a refund, then the MED for the same Pix).
    const debit = amount < 0 && settled ? -Math.min(-amount, await received(tx, found.id)) : amount;
    const net = debit === 0 ? 0 : await insertPayment(tx, found.id, debit, "webhook", externalId, payload);
    if (net === undefined) return "DUPLICATE_PAYMENT";
    if (amount < 0) {
      await tx
        .update(order)
        .set({ status: "refunded" })
        .where(and(eq(order.id, found.id), eq(order.status, "paid")));
      await cancelInvoice(tx, found.id);
      return null;
    }
    if (settled) return null;
    return net < found.amount ? "UNDERPAID" : markPaid(tx, found);
  });
}

export async function releaseOrder(orderId: string, amount: number): Promise<OrderCode | CouponCode | null> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return "INVALID_AMOUNT";
  return db().transaction(async (tx) => {
    const found = await findOrder(tx, orderId);
    if (!found) return "ORDER_NOT_FOUND";
    if (found.status === "paid" || found.status === "refunded") return "INVALID_TRANSITION";
    await insertPayment(tx, found.id, amount, "admin", null, null);
    return markPaid(tx, found, true);
  });
}

// The demo has no bank behind it: this records the full amount through the same path a confirmed Pix takes.
export async function simulatePayment(orderId: string): Promise<OrderCode | CouponCode | GuardCode | null> {
  if (!demoMode()) return "DEMO_ONLY";

  const [open] = await db()
    .select({ amount: order.amount })
    .from(order)
    .where(and(eq(order.id, orderId), eq(order.status, "pending"), gt(order.expiresAt, new Date())));

  return open ? recordPayment(orderId, open.amount, `demo:${orderId}`, "") : "INVALID_TRANSITION";
}

export function refundOrder(orderId: string): Promise<OrderCode | null> {
  return db().transaction(async (tx) => {
    const [found] = await tx
      .select({
        status: order.status,
        net: sql<number>`${tx
          .select({ net: sql`COALESCE(SUM(${payment.amount}), 0)` })
          .from(payment)
          .where(eq(payment.orderId, order.id))}`.mapWith(Number),
      })
      .from(order)
      .where(eq(order.id, orderId))
      .for("update");

    if (!found) return "ORDER_NOT_FOUND";
    if (found.status !== "paid") return "INVALID_TRANSITION";
    if (found.net > 0) await insertPayment(tx, orderId, -found.net, "admin", null, null);
    await tx
      .update(order)
      .set({ status: "refunded" })
      .where(and(eq(order.id, orderId), eq(order.status, "paid")));
    await cancelInvoice(tx, orderId);
    return null;
  });
}
