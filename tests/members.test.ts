import { beforeEach, describe, expect, test, setSystemTime } from "bun:test";
import { completeLesson, confirmLogin, enterFromOrder, refundOrder, requestLogin, signOut } from "@/lib/actions";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/lib/db";
import { clientIp, isAdmin, sign, verify } from "@/lib/guard";
import { completedLessons, currentMember, hasPaidOrderCookie, memberProducts, mintLogin } from "@/lib/members";
import { customer, login, message } from "@/lib/schema";
import { cookieOptions, cookieStore, form, freshBrowser, redirected, requestHeaders } from "./fakes";
import { buy, pay, signInAsAdmin } from "./flows";

let ip = 0;

beforeEach(() => {
  ip += 1;
  freshBrowser(`203.0.113.${ip}`);
});

async function customerId(email: string): Promise<string> {
  return one(await db().select({ id: customer.id }).from(customer).where(eq(customer.email, email))).id;
}

async function loginToken(email: string, ttl = 3600): Promise<string> {
  return new URL(await mintLogin(await customerId(email), ttl)).searchParams.get("t") ?? "";
}

function loginMessages(address: string) {
  return db().$count(message, and(eq(message.kind, "login"), eq(message.address, address)));
}

describe("members area", () => {
  test("magic link opens a full session and lesson progress is keyed by product", async () => {
    const order = await buy({ email: "student@example.com", bump: "1" });
    await pay(order, 9700 + 1990, `student-${order}`);
    freshBrowser();
    const token = await loginToken("student@example.com");
    expect(await redirected(confirmLogin({ code: null }, form({ token })))).toBe("/m");
    expect(cookieOptions.get("lf_member")).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    const member = await currentMember();
    expect(member).toMatchObject({ email: "student@example.com", name: "Ana Souza", scope: "full" });
    expect(member && (await memberProducts(member)).map((product) => product.slug)).toEqual([
      "bolo-no-pote",
      "planilha-preco",
    ]);
    expect(await completeLesson({ code: null }, form({ product: "bolo-no-pote", lesson: "m1a1" }))).toEqual({
      code: null,
      ok: true,
    });
    expect((await completeLesson({ code: null }, form({ product: "planilha-preco", lesson: "m1a1" }))).code).toBe(
      "LESSON_NOT_FOUND",
    );
    expect((await completeLesson({ code: null }, form({ product: "bolo-no-pote", lesson: "made-up" }))).code).toBe(
      "LESSON_NOT_FOUND",
    );
    expect(member && [...(await completedLessons(member))]).toEqual(["bolo-no-pote:m1a1"]);
  });

  test("signing out ends the session on every device, including one that copied the cookies", async () => {
    const order = await buy({ email: "copied@example.com" });
    await pay(order);
    freshBrowser();
    await redirected(confirmLogin({ code: null }, form({ token: await loginToken("copied@example.com") })));
    const copied = new Map(cookieStore);
    setSystemTime(new Date(Date.now() + 2000));
    await redirected(signOut());
    expect(await currentMember()).toBeUndefined();
    freshBrowser();
    for (const [name, value] of copied) cookieStore.set(name, value);
    expect(await currentMember()).toBeUndefined();
    await redirected(confirmLogin({ code: null }, form({ token: await loginToken("copied@example.com") })));
    expect(await currentMember()).toMatchObject({ email: "copied@example.com" });
  });

  test("magic links are single use, expire, and a GET of the page does not consume them", async () => {
    const order = await buy({ email: "once@example.com" });
    await pay(order);
    const token = await loginToken("once@example.com");
    expect(
      one(
        await db()
          .select({ usedAt: login.usedAt })
          .from(login)
          .where(eq(login.customerId, await customerId("once@example.com"))),
      ).usedAt,
    ).toBeNull();
    await redirected(confirmLogin({ code: null }, form({ token })));
    freshBrowser();
    expect((await confirmLogin({ code: null }, form({ token }))).code).toBe("LINK_INVALID");
    const expiring = await loginToken("once@example.com", 60);
    setSystemTime(new Date("2026-11-14T12:02:00-03:00"));
    expect((await confirmLogin({ code: null }, form({ token: expiring }))).code).toBe("LINK_INVALID");
    setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    expect((await confirmLogin({ code: null }, form({ token: "x' OR 1=1 --" }))).code).toBe("LINK_INVALID");
  });

  test("the paying browser gets a session scoped to that order only", async () => {
    const first = await buy({ email: "victim@example.com", slug: "planilha-preco" });
    await pay(first, 4700, `v1-${first}`);
    freshBrowser();
    const attack = await buy({ email: "victim@example.com" });
    await pay(attack, 9700, `v2-${attack}`);
    expect(await hasPaidOrderCookie()).toBe(true);
    expect(await redirected(enterFromOrder())).toBe("/m");
    const member = await currentMember();
    expect(member?.scope).toBe("order");
    expect(member && (await memberProducts(member)).map((product) => product.slug)).toEqual(["bolo-no-pote"]);
    freshBrowser();
    expect((await enterFromOrder()).code).toBe("NOT_SIGNED_IN");
  });

  test("a stranger typing the buyer's details gets a new order, never the buyer's", async () => {
    const mine = await buy({ email: "target@example.com" });
    freshBrowser("192.0.2.77");
    const stranger = await buy({ email: "target@example.com" });
    expect(stranger).not.toBe(mine);
    await pay(mine, 9700, `target-${mine}`);
    expect((await enterFromOrder()).code).toBe("NOT_SIGNED_IN");
  });

  test("a refund revokes access immediately", async () => {
    const order = await buy({ email: "refund@example.com" });
    await pay(order);
    await redirected(enterFromOrder());
    expect((await currentMember())?.owned).toEqual(["bolo-no-pote"]);
    const memberCookies = new Map(cookieStore);
    await signInAsAdmin();
    expect(await refundOrder({ code: null }, form({ orderId: order }))).toEqual({ code: null, ok: true });
    for (const [name, value] of memberCookies) cookieStore.set(name, value);
    expect(await currentMember()).toBeUndefined();
  });

  test("login requests answer the same for unknown e-mails and stop at three per hour per buyer", async () => {
    const order = await buy({ email: "known@example.com" });
    await pay(order);
    expect(await requestLogin({ code: null }, form({ email: "nobody@example.com" }))).toEqual({ code: null, ok: true });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      requestHeaders.set("x-forwarded-for", `192.0.2.${attempt + 10}`);
      expect(await requestLogin({ code: null }, form({ email: "known@example.com" }))).toEqual({
        code: null,
        ok: true,
      });
    }
    expect(await loginMessages("known@example.com")).toBe(3);
    expect(await loginMessages("nobody@example.com")).toBe(0);
    expect((await requestLogin({ code: null }, form({ email: "a@x.com,b@y.com" }))).code).toBe("INVALID_EMAIL");
  });

  test("login requests are throttled per IP", async () => {
    freshBrowser("192.0.2.200");
    for (let attempt = 0; attempt < 5; attempt += 1)
      await requestLogin({ code: null }, form({ email: `x${attempt}@example.com` }));
    expect((await requestLogin({ code: null }, form({ email: "y@example.com" }))).code).toBe("RATE_LIMITED");
    freshBrowser("2001:db8:1::1");
    for (let attempt = 0; attempt < 5; attempt += 1)
      await requestLogin({ code: null }, form({ email: `v6-${attempt}@example.com` }));
    freshBrowser("2001:db8:1:0:ffff::2");
    expect((await requestLogin({ code: null }, form({ email: "v6@example.com" }))).code).toBe("RATE_LIMITED");
  });
});

describe("admin session and signatures", () => {
  test("admin cookie is strict, expires, and dies when the password changes", async () => {
    await signInAsAdmin();
    expect(cookieOptions.get("lf_admin")).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict" });
    expect(await isAdmin()).toBe(true);
    const token = cookieStore.get("lf_admin") ?? "";
    cookieStore.set("lf_admin", `${token.slice(0, -2)}xx`);
    expect(await isAdmin()).toBe(false);
    cookieStore.set("lf_admin", token);
    setSystemTime(new Date("2026-11-15T01:00:00-03:00"));
    expect(await isAdmin()).toBe(false);
    setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    const saved = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "another-long-password";
    expect(await isAdmin()).toBe(false);
    process.env.ADMIN_PASSWORD = saved;
    expect(await isAdmin()).toBe(true);
  });

  test("wrong passwords lock the IP even for the right one", async () => {
    const { adminSignIn } = await import("@/lib/actions");
    freshBrowser("192.0.2.250");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await adminSignIn({ code: null }, form({ password: "guess" }))).code).toBe("INVALID_PASSWORD");
    }
    expect((await adminSignIn({ code: null }, form({ password: process.env.ADMIN_PASSWORD ?? "" }))).code).toBe(
      "RATE_LIMITED",
    );
  });

  test("signatures are bound to their label", () => {
    const token = sign("order", "abc", 60);
    expect(verify("order", token)).toBe("abc");
    expect(verify("member", token)).toBeUndefined();
  });

  test("X-Forwarded-For only counts behind a trusted proxy", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 200.1.2.3" });
    expect(clientIp(headers)).toBe("200.1.2.3");
    process.env.TRUST_PROXY = "0";
    expect(clientIp(headers)).toBe("direct");
    process.env.TRUST_PROXY = "1";
  });
});
