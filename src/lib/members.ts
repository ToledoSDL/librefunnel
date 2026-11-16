import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { ownedProducts } from "./catalog/products";
import type { Product } from "./catalog/products";
import { addSeconds, db } from "./db";
import { baseUrl, demoMode, limited, sha256 } from "./guard";
import { endCustomerSessions, endSession, readSession, startSession } from "./sessions";
import { customer, login, message, order, progress } from "./schema";

export type MemberCode = "INVALID_EMAIL" | "RATE_LIMITED" | "LINK_INVALID" | "NOT_SIGNED_IN" | "LESSON_NOT_FOUND";
export type Member = { customerId: string; email: string; name: string; scope: "full" | "order"; owned: string[] };

const FULL_TTL = 30 * 86400;
const ORDER_TTL = 7 * 86400;
const LOGIN_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function currentMember(): Promise<Member | undefined> {
  const found = await readSession("member");
  if (!found?.customerId) return undefined;

  if (!found.orderId) {
    const rows = await db()
      .select({ email: customer.email, name: order.name, product: order.product, bump: order.bump })
      .from(customer)
      .leftJoin(order, and(eq(order.customerId, customer.id), eq(order.status, "paid")))
      .where(eq(customer.id, found.customerId))
      .orderBy(desc(order.createdAt));

    const [latest] = rows;
    if (!latest) return undefined;
    const owned = rows.flatMap((row) => [row.product, row.bump]).filter((slug) => slug !== null);

    return {
      customerId: found.customerId,
      email: latest.email,
      name: latest.name ?? "",
      scope: "full",
      owned: [...new Set(owned)],
    };
  }

  const [row] = await db()
    .select({
      customerId: order.customerId,
      email: customer.email,
      name: order.name,
      product: order.product,
      bump: order.bump,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.id, found.orderId), eq(order.status, "paid")));

  if (!row) return undefined;
  return {
    customerId: row.customerId,
    email: row.email,
    name: row.name,
    scope: "order",
    owned: row.bump ? [row.product, row.bump] : [row.product],
  };
}
export function memberProducts(member: Member): Promise<Product[]> {
  return ownedProducts(member.owned);
}

export async function completedLessons(member: Member): Promise<Set<string>> {
  const rows = await db()
    .select({ product: progress.product, lesson: progress.lesson })
    .from(progress)
    .where(eq(progress.customerId, member.customerId));

  return new Set(rows.map((row) => `${row.product}:${row.lesson}`));
}

// The checkout's own order: lets the buyer reuse an open Pix and, once paid, enter the members area without e-mail.
export async function rememberOrder(orderId: string) {
  await startSession("order", { orderId }, FULL_TTL);
}

export async function orderFromCookie(): Promise<string | undefined> {
  return (await readSession("order"))?.orderId ?? undefined;
}

async function paidOrderFromCookie(): Promise<{ id: string; customerId: string } | undefined> {
  const orderId = await orderFromCookie();
  if (!orderId) return undefined;

  const [paid] = await db()
    .select({ id: order.id, customerId: order.customerId })
    .from(order)
    .where(and(eq(order.id, orderId), eq(order.status, "paid")));

  return paid;
}

export async function hasPaidOrderCookie(): Promise<boolean> {
  return (await paidOrderFromCookie()) !== undefined;
}
export type Standing = { kind: "owned" | "pending"; href: string };

// What this browser already has for a product, so its pages lead there instead of selling it again: the members area
// for a signed-in owner, the paid order (which opens the area) or the Pix still waiting from this browser's checkout.
export async function standing(slug: string): Promise<Standing | undefined> {
  const member = await currentMember();
  if (member?.owned.includes(slug)) return { kind: "owned", href: "/m" };
  const orderId = await orderFromCookie();
  if (!orderId) return undefined;

  const [found] = await db()
    .select({ status: order.status, product: order.product, bump: order.bump, expiresAt: order.expiresAt })
    .from(order)
    .where(eq(order.id, orderId));

  if (!found || (found.product !== slug && found.bump !== slug)) return undefined;
  const href = `/c/${found.product}?order=${orderId}`;
  if (found.status === "paid") return { kind: "owned", href };
  return found.status === "pending" && found.expiresAt > new Date() ? { kind: "pending", href } : undefined;
}

export async function mintLogin(customerId: string, ttl: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const t = new Date();
  await db()
    .insert(login)
    .values({ tokenHash: sha256(token), customerId, createdAt: t, expiresAt: addSeconds(t, ttl) });
  return `${baseUrl()}/m?t=${token}`;
}

// Same answer for unknown, unpaid and throttled e-mails so the form never reveals who bought.
export async function requestLogin(email: string, ip: string): Promise<MemberCode | null> {
  if (limited("login", ip, 5, 3600)) return "RATE_LIMITED";
  const t = new Date();

  const [row] = await db()
    .select({
      id: customer.id,
      paid: sql<boolean>`EXISTS ${db()
        .select({ id: order.id })
        .from(order)
        .where(and(eq(order.customerId, customer.id), eq(order.status, "paid")))}`,
      recent: sql<number>`${db()
        .select({ total: count() })
        .from(message)
        .where(
          and(
            eq(message.customerId, customer.id),
            eq(message.kind, "login"),
            gt(message.createdAt, addSeconds(t, -3600)),
          ),
        )}`.mapWith(Number),
    })
    .from(customer)
    .where(eq(customer.email, email));

  if (!row || !row.paid || row.recent >= 3) return null;
  await db().insert(message).values({
    channel: "email",
    address: email,
    kind: "login",
    customerId: row.id,
    body: "Seu link de acesso\n\nUse este link para entrar na área de membros (vale 1 hora e funciona uma vez): {login_link}\n\nNão pediu este link? Ignore este e-mail.",
    status: "queued",
    nextAt: t,
    createdAt: t,
  });
  return null;
}

export async function confirmLogin(token: string): Promise<MemberCode | null> {
  if (!LOGIN_TOKEN.test(token)) return "LINK_INVALID";
  const t = new Date();

  const [used] = await db()
    .update(login)
    .set({ usedAt: t })
    .where(and(eq(login.tokenHash, sha256(token)), isNull(login.usedAt), gt(login.expiresAt, t)))
    .returning({ customerId: login.customerId });

  if (!used) return "LINK_INVALID";
  await startSession("member", { customerId: used.customerId }, FULL_TTL);
  return null;
}

export async function enterFromOrder(): Promise<MemberCode | null> {
  const current = await currentMember();
  if (current?.scope === "full") return null;
  const paid = await paidOrderFromCookie();
  if (!paid) return "NOT_SIGNED_IN";
  await startSession("member", { customerId: paid.customerId, orderId: paid.id }, ORDER_TTL);
  return null;
}

// The demo sends no e-mail, so its members area opens as the example buyer who owns the most products.
export async function enterDemo() {
  if (!demoMode()) return;

  const [buyer] = await db()
    .select({ customerId: order.customerId })
    .from(order)
    .where(eq(order.status, "paid"))
    .groupBy(order.customerId)
    .orderBy(desc(count()), desc(sql`max(${order.createdAt})`))
    .limit(1);

  if (buyer) await startSession("member", { customerId: buyer.customerId }, FULL_TTL);
}

export async function completeLesson(product: string, lesson: string): Promise<MemberCode | null> {
  const member = await currentMember();
  if (!member) return "NOT_SIGNED_IN";

  const lessons =
    (await memberProducts(member))
      .find((entry) => entry.slug === product)
      ?.modules.flatMap((module) => module.lessons) ?? [];

  if (!lessons.some((entry) => entry.id === lesson)) return "LESSON_NOT_FOUND";
  await db()
    .insert(progress)
    .values({ customerId: member.customerId, product, lesson, doneAt: new Date() })
    .onConflictDoNothing();
  return null;
}

// Ends the session on every device, along with the checkout cookies that could open a new one.
export async function signOut() {
  const member = await currentMember();
  if (member) await endCustomerSessions(member.customerId);
  await endSession("member");
  await endSession("order");
}
