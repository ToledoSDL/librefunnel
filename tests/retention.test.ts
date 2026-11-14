import { beforeEach, describe, expect, test } from "vitest";
import { asc, eq } from "drizzle-orm";
import { archive, createProduct } from "@/lib/catalog";
import { db } from "@/lib/db";
import { retention } from "@/lib/schema";
import { retentionCurve } from "@/lib/tracking";
import { POST as trackRoute } from "@/app/t/route";
import { freshBrowser } from "./fakes";

let ip = 0;
let slug = "";

beforeEach(async () => {
  ip += 1;
  slug = `retencao-${ip}`;
  freshBrowser(`192.0.2.${ip}`);
  await createProduct(slug, {
    name: "Curso de retenção",
    price: 4700,
    pixKey: "loja@example.com",
    pixName: "Loja",
    pixCity: "Florianopolis",
  });
});

function watch(seconds: object | string, product = slug) {
  return trackRoute(
    new Request("https://shop.example/t", {
      method: "POST",
      body: JSON.stringify({ e: "retention", p: product, s: seconds }),
      headers: { "x-forwarded-for": `192.0.2.${ip}` },
    }),
  );
}

function views() {
  return db()
    .select({ second: retention.second, views: retention.views })
    .from(retention)
    .where(eq(retention.product, slug))
    .orderBy(asc(retention.second));
}

describe("retention", () => {
  test("counts each second once per batch and adds up across page loads", async () => {
    expect((await watch([0, 1, 2, 2])).status).toBe(204);
    expect((await watch([0, 1, 2])).status).toBe(204);
    expect((await watch([0])).status).toBe(204);
    expect(await views()).toEqual([
      { second: 0, views: 3 },
      { second: 1, views: 2 },
      { second: 2, views: 2 },
    ]);
  });

  test("rejects invalid seconds, oversized batches and products that are not on sale", async () => {
    for (const seconds of [[-1], [7201], [1.5], ["3"], [], "0", Array.from({ length: 121 }, (_, second) => second)])
      expect((await watch(seconds)).status).toBe(400);
    expect((await watch([0], "made-up")).status).toBe(400);
    expect((await watch([0], "Bad Slug")).status).toBe(400);
    await archive("product", slug, true);
    expect((await watch([0])).status).toBe(400);
    expect(await views()).toEqual([]);
  });

  test("curve is each moment's views as a share of the plays", async () => {
    expect(await retentionCurve(slug)).toEqual({ plays: 0, points: [] });
    const all = Array.from({ length: 120 }, (_, second) => second);
    await watch(all);
    await watch(all.slice(0, 60));
    await watch(all.slice(0, 30));
    await watch(all.slice(0, 30));

    const curve = await retentionCurve(slug);
    expect(curve.plays).toBe(4);
    expect(curve.points).toHaveLength(60);
    expect(curve.points[0]).toEqual({ second: 0, share: 1 });
    expect(curve.points[20]).toEqual({ second: 40, share: 0.5 });
    expect(curve.points[59]).toEqual({ second: 118, share: 0.25 });
  });

  test("caps the share when resumed plays outnumber the start", async () => {
    await watch([0, 1]);
    await watch([1]);
    expect((await retentionCurve(slug)).points).toEqual([
      { second: 0, share: 1 },
      { second: 1, share: 1 },
    ]);
  });
});
