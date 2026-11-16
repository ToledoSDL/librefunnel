import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { checkCoupon, deleteCoupon, saveCoupon } from "@/lib/actions/coupons";
import { createOrder } from "@/lib/actions/checkout";
import { refundOrder, releaseOrder } from "@/lib/actions/orders";
import { db, one } from "@/lib/db";
import { coupon, order } from "@/lib/schema";
import { form, freshBrowser } from "./fakes";
import { buy, pay, signInAsAdmin } from "./flows";

let ip = 0;

beforeEach(() => {
  ip += 1;
  freshBrowser(`198.18.0.${ip}`);
});

function addCoupon(code: string, fields: Partial<typeof coupon.$inferInsert> = {}) {
  return db()
    .insert(coupon)
    .values({ code, kind: "percent", value: 10, createdAt: new Date(), ...fields });
}

function stored(id: string) {
  return db()
    .select({
      status: order.status,
      amount: order.amount,
      productAmount: order.productAmount,
      discount: order.discount,
    })
    .from(order)
    .where(eq(order.id, id))
    .then(one);
}

function uses(code: string) {
  return db()
    .select({ uses: coupon.uses })
    .from(coupon)
    .where(eq(coupon.code, code))
    .then((rows) => one(rows).uses);
}

function attempt(fields: Record<string, string>) {
  return createOrder(
    { code: null },
    form({ slug: "bolo-no-pote", name: "Ana Souza", email: "coupon@example.com", touch: "", ...fields }),
  );
}

describe("coupons at checkout", () => {
  test("the discount is computed on the server and snapshotted on the order", async () => {
    await addCoupon("TEN", { kind: "percent", value: 10 });
    const id = await buy({ email: "ten@example.com", coupon: " ten ", discount: "9000", price: "1", bump: "1" });
    expect(await stored(id)).toMatchObject({ productAmount: 9700 - 970, discount: 970, amount: 8730 + 1990 });
    await db().update(coupon).set({ value: 50 }).where(eq(coupon.code, "TEN"));
    expect((await stored(id)).amount).toBe(8730 + 1990);
  });

  test("a fixed discount never takes the price under R$ 1,00", async () => {
    await addCoupon("HUGE", { kind: "fixed", value: 50_000 });
    const id = await buy({ email: "huge@example.com", coupon: "HUGE" });
    expect(await stored(id)).toMatchObject({ productAmount: 100, discount: 9600 });
  });

  test("expired, other product and unknown codes are refused", async () => {
    await addCoupon("OLD", { expiresAt: new Date("2026-11-01T00:00:00-03:00") });
    await addCoupon("PLAN", { products: ["planilha-preco"] });
    expect((await attempt({ coupon: "OLD" })).code).toBe("COUPON_EXPIRED");
    expect((await attempt({ coupon: "PLAN" })).code).toBe("COUPON_OTHER_PRODUCT");
    expect((await attempt({ coupon: "NOPE" })).code).toBe("COUPON_NOT_FOUND");
  });

  test("five refused codes per minute, while valid checks do not count", async () => {
    await addCoupon("VALID");
    const check = (code: string) => checkCoupon({ code: null }, form({ slug: "bolo-no-pote", coupon: code }));
    for (let index = 0; index < 10; index += 1) expect((await check("VALID")).discount).toBe(970);
    for (let index = 0; index < 5; index += 1) expect((await check(`GUESS${index}`)).code).toBe("COUPON_NOT_FOUND");
    expect((await check("VALID")).code).toBe("RATE_LIMITED");
    expect((await attempt({ coupon: "VALID" })).code).toBe("RATE_LIMITED");
  });
});

describe("coupon uses", () => {
  test("concurrent payments never pass the limit; the extra order keeps its money and waits", async () => {
    await addCoupon("ONE", { maxUses: 1, oncePerEmail: false });
    const first = await buy({ email: "one-a@example.com", coupon: "ONE" });
    const second = await buy({ email: "one-b@example.com", coupon: "ONE" });
    const replies = await Promise.all([pay(first, 8730), pay(second, 8730)]);
    const codes = await Promise.all(replies.map((reply) => reply.json()));
    expect(codes.filter((body) => body.code === "COUPON_EXHAUSTED")).toHaveLength(1);
    expect(await uses("ONE")).toBe(1);
    const statuses = [(await stored(first)).status, (await stored(second)).status].sort();
    expect(statuses).toEqual(["paid", "pending"]);
    expect((await attempt({ email: "one-c@example.com", coupon: "ONE" })).code).toBe("COUPON_EXHAUSTED");
  });

  test("the seller can release an order past the limit", async () => {
    await addCoupon("SOLO", { maxUses: 1, oncePerEmail: false });
    const first = await buy({ email: "solo-a@example.com", coupon: "SOLO" });
    const second = await buy({ email: "solo-b@example.com", coupon: "SOLO" });
    await pay(first, 8730);
    expect(await (await pay(second, 8730)).json()).toEqual({ code: "COUPON_EXHAUSTED" });
    await signInAsAdmin();
    expect((await releaseOrder({ code: null }, form({ orderId: second, amount: "87,30" }))).code).toBeNull();
    expect(await uses("SOLO")).toBe(2);
  });

  test("one use per e-mail survives a refund", async () => {
    await addCoupon("ONCE");
    const id = await buy({ email: "once@example.com", coupon: "ONCE" });
    await pay(id, 8730);
    await signInAsAdmin();
    await refundOrder({ code: null }, form({ orderId: id }));
    freshBrowser("198.18.1.1");
    expect((await attempt({ email: "once@example.com", coupon: "ONCE" })).code).toBe("COUPON_USED");
  });

  test("two pending orders by one e-mail release only one discount", async () => {
    await addCoupon("TWICE");
    const first = await buy({ email: "twice@example.com", coupon: "TWICE" });
    const second = await buy({ email: "twice@example.com", slug: "planilha-preco", coupon: "TWICE" });
    expect((await pay(first, 8730)).status).toBe(200);
    const extra = await stored(second);
    expect(await (await pay(second, extra.amount, `e2e-twice-${second}`)).json()).toEqual({ code: "COUPON_EXHAUSTED" });
    expect((await stored(second)).status).toBe("pending");
  });
});

describe("coupon admin", () => {
  test("only the admin creates and deletes, and codes are unique", async () => {
    freshBrowser("198.18.2.1");
    const fields = { code: "promo-x", kind: "fixed", value: "20,00", maxUses: "", expiresAt: "", oncePerEmail: "1" };
    expect((await saveCoupon({ code: null }, form(fields))).code).toBe("NOT_SIGNED_IN");
    await signInAsAdmin();
    expect((await saveCoupon({ code: null }, form(fields))).ok).toBe(true);
    expect((await saveCoupon({ code: null }, form(fields))).code).toBe("COUPON_TAKEN");
    expect((await saveCoupon({ code: null }, form({ ...fields, kind: "percent", value: "100" }))).code).toBe(
      "INVALID_DISCOUNT",
    );

    const saved = one(
      await db().select({ value: coupon.value, kind: coupon.kind }).from(coupon).where(eq(coupon.code, "PROMO-X")),
    );

    expect(saved).toEqual({ value: 2000, kind: "fixed" });
    expect((await deleteCoupon({ code: null }, form({ code: "PROMO-X" }))).ok).toBe(true);
  });
});
