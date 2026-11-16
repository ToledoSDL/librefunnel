"use server";

import { demoMode } from "../guard";
import { isAdmin } from "../sessions";
import { ID, parseCents } from "../input";
import * as invoices from "../invoices";
import * as messages from "../messages";
import * as payments from "../orders/payments";
import { done, field } from "./form";
import type { ActionState, FormArgs } from "./form";

export async function releaseOrder(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const orderId = field(form, "orderId");
  if (!ID.test(orderId)) return { code: "ORDER_NOT_FOUND" };
  const amount = parseCents(field(form, "amount"));
  if (!amount) return { code: "INVALID_AMOUNT" };
  return done(await payments.releaseOrder(orderId, amount));
}

export async function refundOrder(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done(await payments.refundOrder(field(form, "orderId")));
}

export async function resendAccess(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.resendAccess(field(form, "orderId"))) ? null : "INVALID_TRANSITION");
}

export async function retryInvoice(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  if (demoMode()) return { code: "DEMO_BLOCKED" };
  const orderId = field(form, "orderId");
  if (!ID.test(orderId)) return { code: "ORDER_NOT_FOUND" };
  return done(await invoices.retryInvoice(orderId));
}
