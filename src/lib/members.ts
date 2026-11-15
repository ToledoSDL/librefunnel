import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { ownedProducts } from "./catalog";
import type { Product } from "./catalog";
import { addSeconds, db } from "./db";
import { baseUrl, limited, now, setCookie, sha256, sign, verify } from "./guard";
import { customer, login, message, order, progress } from "./schema";

export type MemberCode = "INVALID_EMAIL" | "RATE_LIMITED" | "LINK_INVALID" | "NOT_SIGNED_IN" | "LESSON_NOT_FOUND";
export type Member = { customerId: string; email: string; name: string; scope: "full" | "order"; owned: string[] };

const MEMBER_COOKIE = "lf_member";
const ORDER_COOKIE = "lf_order";
const FULL_TTL = 30 * 86400;
const ORDER_TTL = 7 * 86400;
const LOGIN_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function currentMember(): Promise<Member | undefined> {
  const token = (await cookies()).get(MEMBER_COOKIE)?.value;
  const session = token ? verify("member", token) : undefined;
  // Cookies from before sessions carried their start time count as started at 0.
  const [scope, id, started = "0"] = session?.split(":") ?? [];
  if (!id) return undefined;
  const revoked = (after: Date | null) => after !== null && Number(started) < Math.floor(after.getTime() / 1000);
  if (scope === "c") {
    const rows = await db()
      .select({
        email: customer.email,
        sessionsAfter: customer.sessionsAfter,
        name: order.name,
        product: order.product,
        bump: order.bump,
      })
      .from(customer)
      .leftJoin(order, and(eq(order.customerId, customer.id), eq(order.status, "paid")))
      .where(eq(customer.id, id))
      .orderBy(desc(order.createdAt));

    const [latest] = rows;
    if (!latest || revoked(latest.sessionsAfter)) return undefined;
    const owned = rows.flatMap((row) => [row.product, row.bump]).filter((slug) => slug !== null);
    return { customerId: id, email: latest.email, name: latest.name ?? "", scope: "full", owned: [...new Set(owned)] };
  }
  if (scope !== "o") return undefined;

  const [row] = await db()
    .select({
      customerId: order.customerId,
      email: customer.email,
      sessionsAfter: customer.sessionsAfter,
      name: order.name,
      product: order.product,
      bump: order.bump,
    })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(and(eq(order.id, id), eq(order.status, "paid")));

  if (!row || revoked(row.sessionsAfter)) return undefined;
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

export async function rememberOrder(orderId: string) {
  await setCookie(ORDER_COOKIE, sign("order", orderId, FULL_TTL), FULL_TTL, "lax");
}

export async function orderFromCookie(): Promise<string | undefined> {
  const token = (await cookies()).get(ORDER_COOKIE)?.value;
  return token ? verify("order", token) : undefined;
}

async function paidOrderFromCookie(): Promise<string | undefined> {
  const orderId = await orderFromCookie();
  if (!orderId) return undefined;

  // The order cookie is set at checkout, so after a sign-out it must not open a new session.
  const [paid] = await db()
    .select({ id: order.id })
    .from(order)
    .innerJoin(customer, eq(customer.id, order.customerId))
    .where(
      and(
        eq(order.id, orderId),
        eq(order.status, "paid"),
        or(isNull(customer.sessionsAfter), gt(order.createdAt, customer.sessionsAfter)),
      ),
    );

  return paid?.id;
}

export async function hasPaidOrderCookie(): Promise<boolean> {
  return (await paidOrderFromCookie()) !== undefined;
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
  await setCookie(MEMBER_COOKIE, sign("member", `c:${used.customerId}:${now()}`, FULL_TTL), FULL_TTL, "lax");
  return null;
}

export async function enterFromOrder(): Promise<MemberCode | null> {
  const current = await currentMember();
  if (current?.scope === "full") return null;
  const orderId = await paidOrderFromCookie();
  if (!orderId) return "NOT_SIGNED_IN";
  await setCookie(MEMBER_COOKIE, sign("member", `o:${orderId}:${now()}`, ORDER_TTL), ORDER_TTL, "lax");
  return null;
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

// A copied cookie would otherwise keep working for its 30 days; signing out ends it on every device.
export async function signOut() {
  const member = await currentMember();
  if (member) await db().update(customer).set({ sessionsAfter: new Date() }).where(eq(customer.id, member.customerId));
  (await cookies()).delete(MEMBER_COOKIE);
}
