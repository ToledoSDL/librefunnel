import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { archiveItem, saveProduct } from "@/lib/actions/products";
import { saveSettings } from "@/lib/actions/store";
import { getProduct } from "@/lib/catalog/products";
import { db } from "@/lib/db";
import { touch } from "@/lib/schema";
import { GET as ask } from "@/app/api/domain/route";
import Home from "@/app/page";
import { POST as track } from "@/app/t/route";
import { cookieStore, form, freshBrowser, redirected, requestHeaders } from "./fakes";
import { signInAsAdmin } from "./flows";

beforeEach(async () => {
  freshBrowser();
  await signInAsAdmin();
});

function setDomain(slug: string, domain: string) {
  return saveProduct({ code: null }, form({ slug, name: "Bolo no Pote", price: "97,00", guaranteeDays: "7", domain }));
}

async function certificate(domain: string) {
  return (await ask(new Request(`http://app:3000/api/domain?domain=${domain}`))).status;
}

function home(host: string, query: Record<string, string> = {}) {
  requestHeaders.set("host", host);
  return redirected(Home({ searchParams: Promise.resolve(query) }));
}

describe("product domains", () => {
  test("a pasted address is kept bare, and only a public name other than the store's is accepted", async () => {
    expect((await setDomain("bolo-no-pote", "https://BoloNoPote.com.br/")).ok).toBe(true);
    expect((await getProduct("bolo-no-pote"))?.domain).toBe("bolonopote.com.br");

    for (const refused of ["shop.example", "203.0.113.5", "localhost", "bolonopote.com.br/aula"])
      expect((await setDomain("bolo-no-pote", refused)).code).toBe("INVALID_DOMAIN");

    expect((await setDomain("planilha-preco", "bolonopote.com.br")).code).toBe("DOMAIN_TAKEN");
    expect((await setDomain("bolo-no-pote", "")).ok).toBe(true);
    expect((await getProduct("bolo-no-pote"))?.domain).toBeUndefined();
  });

  test("certificates are issued only for domains of products on sale", async () => {
    await setDomain("bolo-no-pote", "bolonopote.com.br");
    expect(await certificate("bolonopote.com.br")).toBe(200);
    expect(await certificate("outro.com.br")).toBe(404);
    expect(await certificate("")).toBe(404);
    await archiveItem({ code: null }, form({ kind: "product", key: "bolo-no-pote", archived: "1" }));
    expect(await certificate("bolonopote.com.br")).toBe(404);
  });

  test("the product domain opens its product with the ad's parameters; the store address follows the setting", async () => {
    expect((await setDomain("planilha-preco", "planilha.com.br")).ok).toBe(true);
    expect(await home("planilha.com.br:443", { utm_source: "meta", fbclid: "abc" })).toBe(
      "/c/planilha-preco?utm_source=meta&fbclid=abc",
    );

    expect((await saveSettings({ code: null }, form({ home: "/m" }))).ok).toBe(true);
    expect(await home("shop.example")).toBe("/m");
    expect(await home("planilha.com.br")).toBe("/c/planilha-preco");
    expect((await saveSettings({ code: null }, form({ home: "nao-existe" }))).code).toBe("PRODUCT_NOT_FOUND");
  });

  test("the public demo never saves a domain nor approves a certificate", async () => {
    process.env.DEMO_MODE = "1";

    try {
      expect((await setDomain("planilha-preco", "outra.com.br")).code).toBe("DEMO_BLOCKED");
      expect(await certificate("planilha.com.br")).toBe(404);
    } finally {
      delete process.env.DEMO_MODE;
    }

    expect(await certificate("planilha.com.br")).toBe(200);
  });

  test("moving between the pages of a product domain is not a visit from another site", async () => {
    const visit = (referrer: string) =>
      track(
        new Request("https://planilha.com.br/t", {
          method: "POST",
          body: JSON.stringify({ e: "page_view", p: "planilha-preco", q: "", r: referrer, l: "/c/planilha-preco" }),
          headers: { host: "planilha.com.br", "x-forwarded-for": "203.0.113.77" },
        }),
      );

    await visit("https://planilha.com.br/v/planilha-preco");
    await visit("https://instagram.com/");
    const visitor = cookieStore.get("lf_vid") ?? "";
    const touches = await db().select({ host: touch.referrerHost }).from(touch).where(eq(touch.visitorId, visitor));
    expect(touches).toEqual([{ host: "instagram.com" }]);
  });
});
