import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  archiveItem,
  completeLesson,
  createOrder,
  createProduct,
  enterFromOrder,
  moveItem,
  saveLesson,
  saveModule,
  saveProduct,
  saveRecoveryStep,
  saveReply,
  saveSettings,
} from "@/lib/actions";
import { and, eq } from "drizzle-orm";
import { getProduct, products, settings } from "@/lib/catalog";
import { db, migrate, one } from "@/lib/db";
import { derive } from "@/lib/guard";
import { completedLessons, currentMember, memberProducts } from "@/lib/members";
import { queueRecovery, recoverySteps } from "@/lib/messages";
import { getPixOrder } from "@/lib/orders";
import { message, order, product, setting } from "@/lib/schema";
import { POST as upload } from "@/app/admin/media/route";
import Checkout from "@/app/c/[slug]/page";
import { GET as media } from "@/app/media/[file]/route";
import { POST as botWebhook } from "@/app/api/webhooks/whatsapp/route";
import { form, freshBrowser, redirected } from "./fakes";
import { buy, pay, signInAsAdmin } from "./flows";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

async function checkoutHtml(query: Record<string, string>) {
  const page = createElement(Checkout, {
    params: Promise.resolve({ slug: "metodo-demo" }),
    searchParams: Promise.resolve(query),
  });

  return (await new Response((await prerender(page)).prelude).text()).replaceAll("<!-- -->", "");
}

const DEMO_FORM = {
  slug: "metodo-demo",
  name: "Método Demo: do zero à primeira venda",
  price: "97,00",
  tagline: "O passo a passo.",
  pixKey: "demo@exemplo.com",
  pixName: "LibreFunnel Demo",
  pixCity: "Florianopolis",
  offerEndsAt: "2026-11-30T23:59",
  guaranteeDays: "7",
  bumpProduct: "planilha-metas",
  bumpPrice: "19,90",
  bumpHeadline: "Leve junto",
  vslVideo: "/demo/vsl-demo.mp4",
  ctaSeconds: "8",
  ctaText: "Quero garantir minha vaga",
  banner: "/demo/banner.svg",
  cover: "/demo/cover.svg",
};

let ip = 0;

beforeEach(() => {
  ip += 1;
  freshBrowser(`203.0.113.${ip}`);
});

async function orderRow(id: string) {
  return one(
    await db()
      .select({ productAmount: order.productAmount, bumpAmount: order.bumpAmount, amount: order.amount })
      .from(order)
      .where(eq(order.id, id)),
  );
}

function sendFile(name: string, body: Buffer<ArrayBuffer>) {
  return upload(new Request(`https://shop.example/admin/media?name=${name}`, { method: "POST", body }));
}

function fetchMedia(file: string, range?: string) {
  const headers: Record<string, string> = range ? { range } : {};
  return media(new Request(`https://shop.example/media/${file}`, { headers }), { params: Promise.resolve({ file }) });
}

function mediaFiles(): string[] {
  const dir = join(process.env.DATA_DIR ?? "", "media");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("products", () => {
  test("creation validates name, slug, price and Pix, and opens the editor", async () => {
    const valid = {
      name: "Curso de Confeitaria",
      price: "1.234,50",
      slug: "",
      pixKey: "+55 48 99999-0000",
      pixName: "Doces da Ana",
      pixCity: "São José",
    };

    expect((await createProduct({ code: null }, form(valid))).code).toBe("NOT_SIGNED_IN");
    await signInAsAdmin();
    const create = (fields: Record<string, string>) => createProduct({ code: null }, form({ ...valid, ...fields }));
    expect((await create({ name: "A" })).code).toBe("INVALID_TITLE");
    expect((await create({ slug: "Curso Novo" })).code).toBe("INVALID_SLUG");
    expect((await create({ price: "0,50" })).code).toBe("INVALID_PRICE");
    expect((await create({ price: "97,999" })).code).toBe("INVALID_PRICE");
    expect((await create({ price: "100000,01" })).code).toBe("INVALID_PRICE");
    expect((await create({ pixKey: "48999990000" })).code).toBe("INVALID_PIX_KEY");
    expect((await create({ pixName: "  " })).code).toBe("INVALID_PIX_HOLDER");
    expect((await create({ slug: "metodo-demo" })).code).toBe("SLUG_TAKEN");
    expect(await redirected(create({}))).toBe("/admin?tab=products&product=curso-de-confeitaria");
    expect(await getProduct("curso-de-confeitaria")).toMatchObject({
      price: 123450,
      pix: { key: "+5548999990000", name: "Doces da Ana", city: "Sao Jose" },
      guaranteeDays: 7,
      archived: false,
    });
  });

  test("editing validates every field and stores FAQ and testimonials", async () => {
    await signInAsAdmin();
    const save = (fields: Record<string, string>) => saveProduct({ code: null }, form({ ...DEMO_FORM, ...fields }));
    expect((await save({ ctaSeconds: "7201" })).code).toBe("INVALID_CTA_SECONDS");
    expect((await save({ ctaSeconds: "1.5" })).code).toBe("INVALID_CTA_SECONDS");
    expect((await save({ offerEndsAt: "amanhã" })).code).toBe("INVALID_DATE");
    expect((await save({ guaranteeDays: "3" })).code).toBe("INVALID_GUARANTEE");
    expect((await save({ bumpProduct: "metodo-demo" })).code).toBe("INVALID_BUMP");
    expect((await save({ bumpProduct: "does-not-exist" })).code).toBe("INVALID_BUMP");
    expect((await save({ vslVideo: "/etc/passwd" })).code).toBe("INVALID_MEDIA");
    expect((await save({ banner: "javascript:alert(1)" })).code).toBe("INVALID_MEDIA");
    expect((await save({ tagline: "x".repeat(301) })).code).toBe("INVALID_TEXT");
    expect((await save({ faq_q: "Pergunta sem resposta" })).code).toBe("INVALID_FAQ");
    expect((await save({ testimonial_name: "Bia", testimonial_text: "Gostei", testimonial_stars: "6" })).code).toBe(
      "INVALID_TESTIMONIAL",
    );

    const fields = form({
      ...DEMO_FORM,
      offerEndsAt: "2026-12-24T18:00",
      testimonial_name: "Bia Lima",
      testimonial_text: "Vendi no primeiro dia.",
      testimonial_stars: "5",
    });

    fields.append("faq_q", "Tem certificado?");
    fields.append("faq_a", "Sim.");
    fields.append("faq_q", "");
    fields.append("faq_a", "");
    expect(await saveProduct({ code: null }, fields)).toEqual({ code: null, ok: true });
    expect(await getProduct("metodo-demo")).toMatchObject({
      offerEndsAt: new Date("2026-12-24T18:00:00-03:00"),
      faq: [{ q: "Tem certificado?", a: "Sim." }],
      testimonials: [{ name: "Bia Lima", text: "Vendi no primeiro dia.", stars: 5 }],
      orderBump: { product: "planilha-metas", price: 1990, headline: "Leve junto" },
    });
    expect(await save({})).toEqual({ code: null, ok: true });
  });

  test("a price edit only reaches new orders", async () => {
    await signInAsAdmin();
    const before = await buy({ email: "before-price@example.com", bump: "1" });
    expect(await saveProduct({ code: null }, form({ ...DEMO_FORM, price: "120,00", bumpPrice: "25" }))).toEqual({
      code: null,
      ok: true,
    });
    const after = await buy({ email: "after-price@example.com", bump: "1" });
    expect(await orderRow(before)).toEqual({ productAmount: 9700, bumpAmount: 1990, amount: 11690 });
    expect(await orderRow(after)).toEqual({ productAmount: 12000, bumpAmount: 2500, amount: 14500 });
    await saveProduct({ code: null }, form(DEMO_FORM));
  });

  test("archiving stops sales but keeps old orders and member access", async () => {
    await signInAsAdmin();
    const paid = await buy({ email: "archived@example.com" });
    await pay(paid);
    await redirected(enterFromOrder());
    expect(await archiveItem({ code: null }, form({ kind: "product", key: "metodo-demo", archived: "1" }))).toEqual({
      code: null,
      ok: true,
    });
    expect((await archiveItem({ code: null }, form({ kind: "product", key: "metodo-demo", archived: "1" }))).code).toBe(
      "INVALID_TRANSITION",
    );
    expect((await products()).map((entry) => entry.slug)).not.toContain("metodo-demo");
    expect(
      (await createOrder({ code: null }, form({ slug: "metodo-demo", name: "Ana Souza", email: "late@example.com" })))
        .code,
    ).toBe("PRODUCT_NOT_FOUND");
    expect((await getPixOrder(paid, "metodo-demo"))?.status).toBe("paid");
    const member = await currentMember();
    expect(member && (await memberProducts(member)).map((entry) => entry.slug)).toEqual(["metodo-demo"]);
    expect(await completeLesson({ code: null }, form({ product: "metodo-demo", lesson: "m2a1" }))).toEqual({
      code: null,
      ok: true,
    });
    expect(await archiveItem({ code: null }, form({ kind: "product", key: "metodo-demo", archived: "0" }))).toEqual({
      code: null,
      ok: true,
    });
    expect((await products()).map((entry) => entry.slug)).toContain("metodo-demo");
  });

  test("lessons keep their progress key through reorder, rename and archive", async () => {
    await signInAsAdmin();
    const bought = await buy({ email: "progress@example.com" });
    await pay(bought);
    await redirected(enterFromOrder());
    await completeLesson({ code: null }, form({ product: "metodo-demo", lesson: "m1a1" }));
    expect(await moveItem({ code: null }, form({ kind: "lesson", key: "m1a2", direction: "up" }))).toEqual({
      code: null,
      ok: true,
    });
    expect((await moveItem({ code: null }, form({ kind: "lesson", key: "m1a2", direction: "up" }))).code).toBe(
      "INVALID_TRANSITION",
    );
    expect(
      await saveLesson({ code: null }, form({ lesson: "m1a1", title: "Quem compra", video: "", text: "Novo texto" })),
    ).toEqual({ code: null, ok: true });
    expect((await saveLesson({ code: null }, form({ lesson: "m1a1", title: "Q", video: "", text: "" }))).code).toBe(
      "INVALID_TITLE",
    );
    expect(await moveItem({ code: null }, form({ kind: "module", key: "2", direction: "up" }))).toEqual({
      code: null,
      ok: true,
    });
    const member = await currentMember();
    const modules = member ? (await memberProducts(member)).find((entry) => entry.slug === "metodo-demo")?.modules : [];
    expect(modules?.map((module) => module.lessons.map((lesson) => `${lesson.id}:${lesson.title}`))).toEqual([
      ["m2a1:UTM em todo link"],
      ["m1a2:Preço e garantia", "m1a1:Quem compra"],
    ]);
    expect(member && [...(await completedLessons(member))]).toContain("metodo-demo:m1a1");
    await archiveItem({ code: null }, form({ kind: "lesson", key: "m1a2", archived: "1" }));
    expect((await getProduct("metodo-demo"))?.modules[1]?.lessons.map((lesson) => lesson.id)).toEqual(["m1a1"]);
    expect(
      (await getProduct("metodo-demo", true))?.modules[1]?.lessons.map((lesson) => [lesson.id, lesson.archived]),
    ).toEqual([
      ["m1a2", true],
      ["m1a1", false],
    ]);
    expect((await completeLesson({ code: null }, form({ product: "metodo-demo", lesson: "m1a2" }))).code).toBe(
      "LESSON_NOT_FOUND",
    );
  });

  test("modules and lessons are added at the end with a stable random lesson id", async () => {
    await signInAsAdmin();
    expect(await saveModule({ code: null }, form({ product: "planilha-metas", title: "Bônus", cover: "" }))).toEqual({
      code: null,
      ok: true,
    });
    expect(
      (await saveModule({ code: null }, form({ product: "planilha-metas", title: "Capa", cover: "/media/../x" }))).code,
    ).toBe("INVALID_MEDIA");
    const bonus = (await getProduct("planilha-metas"))?.modules.at(-1);
    expect(bonus?.title).toBe("Bônus");
    expect(
      await saveLesson(
        { code: null },
        form({ module: String(bonus?.id), title: "Planilha extra", video: "", text: "" }),
      ),
    ).toEqual({ code: null, ok: true });
    const lesson = (await getProduct("planilha-metas"))?.modules.at(-1)?.lessons[0];
    expect(lesson?.id).toMatch(/^[a-z0-9]{10}$/);
    expect(lesson?.title).toBe("Planilha extra");
    freshBrowser();
    expect((await saveModule({ code: null }, form({ product: "planilha-metas", title: "Outro" }))).code).toBe(
      "NOT_SIGNED_IN",
    );
  });
});

describe("automations and settings", () => {
  test("keyword replies come from the database", async () => {
    await signInAsAdmin();
    expect((await saveReply({ code: null }, form({ keywords: " , ", text: "Oi" }))).code).toBe("INVALID_KEYWORDS");
    expect((await saveReply({ code: null }, form({ keywords: "oi", text: "Oi {nome}" }))).code).toBe(
      "INVALID_TEMPLATE",
    );
    expect(
      await saveReply(
        { code: null },
        form({ keywords: "horário, horario", text: "Atendemos das 9h às 18h. Loja: {base}" }),
      ),
    ).toEqual({ code: null, ok: true });
    const key = derive("bot");

    const payload = {
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5521944445555@s.whatsapp.net", fromMe: false, id: "KW1" },
        message: { conversation: "Horário?" },
      },
    };

    await botWebhook(
      new Request(`https://shop.example/api/webhooks/whatsapp?k=${key}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(
      one(
        await db()
          .select({ body: message.body })
          .from(message)
          .where(and(eq(message.address, "5521944445555"), eq(message.kind, "reply"))),
      ).body,
    ).toBe("Atendemos das 9h às 18h. Loja: https://shop.example");
  });

  test("recovery steps come from the database and are validated", async () => {
    await signInAsAdmin();
    const first = (await recoverySteps())[0];

    const step = {
      id: String(first?.id),
      delay: "15",
      unit: "1",
      channel: "whatsapp",
      text: "Novo lembrete, {name}: {link}",
    };

    expect((await saveRecoveryStep({ code: null }, form({ ...step, delay: "3", unit: "1440" }))).code).toBe(
      "INVALID_DELAY",
    );
    expect((await saveRecoveryStep({ code: null }, form({ ...step, delay: "0" }))).code).toBe("INVALID_DELAY");
    expect((await saveRecoveryStep({ code: null }, form({ ...step, text: "Oi {first_name}" }))).code).toBe(
      "INVALID_TEMPLATE",
    );
    expect((await saveRecoveryStep({ code: null }, form({ ...step, channel: "sms" }))).code).toBe("INVALID_PAYLOAD");
    expect(await saveRecoveryStep({ code: null }, form(step))).toEqual({ code: null, ok: true });
    const pending = await buy({ email: "new-recovery@example.com" });
    vi.setSystemTime(new Date("2026-11-14T12:16:00-03:00"));
    await queueRecovery();
    vi.setSystemTime(new Date("2026-11-14T12:00:00-03:00"));
    expect(
      one(
        await db()
          .select({ body: message.body })
          .from(message)
          .where(and(eq(message.orderId, pending), eq(message.kind, "recovery"))),
      ).body,
    ).toContain(`Novo lembrete, Ana: https://shop.example/c/metodo-demo?order=${pending}`);
  });

  test("settings are validated and apply to the next order", async () => {
    await signInAsAdmin();

    const valid = {
      brand: "Doces da Ana",
      ownerEmail: "ana@doces.com",
      ownerWhatsapp: "(48) 99999-0000",
      termsUrl: "https://doces.com/termos",
      termsVersion: "2026-11",
      orderHours: "48",
    };

    const save = (fields: Record<string, string>) => saveSettings({ code: null }, form({ ...valid, ...fields }));
    expect((await save({ brand: "" })).code).toBe("INVALID_TITLE");
    expect((await save({ ownerEmail: "ana" })).code).toBe("INVALID_EMAIL");
    expect((await save({ ownerWhatsapp: "123" })).code).toBe("INVALID_PHONE");
    expect((await save({ termsUrl: "doces.com" })).code).toBe("INVALID_URL");
    expect((await save({ orderHours: "721" })).code).toBe("INVALID_ORDER_HOURS");
    expect((await save({ orderHours: "24" })).code).toBe("INVALID_ORDER_HOURS");
    expect(await save({})).toEqual({ code: null, ok: true });
    expect(await settings()).toEqual({
      ...valid,
      ownerWhatsapp: "5548999990000",
      orderHours: 48,
      poweredBy: true,
      checkoutPhone: "optional",
      confirmEmail: true,
      checkoutTheme: "light",
      checkoutButton: "Pagar com Pix",
      checkoutCountdown: true,
      checkoutTrust: true,
      checkoutGuarantee: true,
      checkoutTestimonials: true,
      thanksLabel: "Próximo passo",
    });
    expect((await saveSettings({ code: null }, form({ accent: "verde" }))).code).toBe("INVALID_COLOR");
    expect((await saveSettings({ code: null }, form({ document: "123" }))).code).toBe("INVALID_DOCUMENT");
    expect((await saveSettings({ code: null }, form({ checkoutPhone: "required", accent: "#254CCB" }))).ok).toBe(true);
    expect(await settings()).toMatchObject({ brand: "Doces da Ana", accent: "#254ccb", checkoutPhone: "required" });

    const noPhone = form({
      slug: "metodo-demo",
      name: "Ana Souza",
      email: "nophone@example.com",
      phone: "",
      touch: "",
    });

    expect((await createOrder({ code: null }, noPhone)).code).toBe("INVALID_PHONE");
    expect((await saveSettings({ code: null }, form({ checkoutPhone: "optional" }))).ok).toBe(true);
    const id = await buy({ email: "terms@example.com" });

    const row = one(
      await db()
        .select({ termsVersion: order.termsVersion, createdAt: order.createdAt, expiresAt: order.expiresAt })
        .from(order)
        .where(eq(order.id, id)),
    );

    expect(row.termsVersion).toBe("2026-11");
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(48 * 3600 * 1000);
  });

  test("checkout options are validated and shape the buyer pages", async () => {
    await signInAsAdmin();
    const save = (fields: Record<string, string>) => saveSettings({ code: null }, form(fields));
    expect((await save({ checkoutTheme: "neon" })).code).toBe("INVALID_PAYLOAD");
    expect((await save({ thanksUrl: "grupo.com" })).code).toBe("INVALID_URL");
    expect((await save({ checkoutButton: "x".repeat(41) })).code).toBe("INVALID_TEXT");
    expect((await save({ checkoutNotice: "x".repeat(201) })).code).toBe("INVALID_TEXT");

    await db()
      .update(product)
      .set({
        offerEndsAt: new Date("2026-12-01T00:00:00-03:00"),
        testimonials: [{ name: "Bruna Lima", text: "Vendi na primeira semana.", stars: 5 }],
      })
      .where(eq(product.slug, "metodo-demo"));

    const standard = await checkoutHtml({
      name: "Ana Souza",
      email: "ana@example.com",
      phone: "48999990000",
      utm_source: "ig",
    });

    expect(standard).toContain("surface-buyer");
    expect(standard).toContain("Esta oferta termina em");
    expect(standard).toContain("Compra 100% segura");
    expect(standard).toContain("Garantia de 7 dias");
    expect(standard).toContain("Bruna Lima");
    expect(standard).toContain("Pagar com Pix");
    expect(standard).toContain('value="Ana Souza"');
    expect(standard).toContain('value="ana@example.com"');
    expect(standard).toContain('value="48999990000"');
    expect(standard).toContain('name="touch" value="?utm_source=ig"');

    const custom = {
      checkoutTheme: "dark",
      checkoutButton: "Quero meu acesso",
      checkoutNotice: "Turma começa em 1º de dezembro",
      checkoutCountdown: "0",
      checkoutTrust: "0",
      checkoutGuarantee: "0",
      checkoutTestimonials: "0",
    };

    expect((await save(custom)).ok).toBe(true);
    const changed = await checkoutHtml({});
    expect(changed).toContain("surface-experience");
    expect(changed).toContain("Quero meu acesso");
    expect(changed).not.toContain("Pagar com Pix");
    expect(changed).toContain("Turma começa em 1º de dezembro");
    expect(changed).not.toContain("Esta oferta termina em");
    expect(changed).not.toContain("Compra 100% segura");
    expect(changed).not.toContain("Garantia de");
    expect(changed).not.toContain("Bruna Lima");

    expect((await save({ checkoutTheme: "auto", checkoutTrust: "1" })).ok).toBe(true);
    const auto = await checkoutHtml({});
    expect(auto).not.toMatch(/surface-(buyer|experience)/);
    expect(auto).toContain("Garantia de 7 dias");

    const id = await buy({ email: "thanks@example.com" });
    await pay(id, (await getPixOrder(id, "metodo-demo"))?.amount);
    expect(await checkoutHtml({ order: id })).not.toContain("Entrar no grupo da turma");
    const thanks = { thanksUrl: "https://chat.whatsapp.com/turma", thanksLabel: "Entrar no grupo da turma" };
    expect((await save(thanks)).ok).toBe(true);
    const paid = await checkoutHtml({ order: id });
    expect(paid).toContain('href="https://chat.whatsapp.com/turma"');
    expect(paid).toContain("Entrar no grupo da turma");

    await save({ checkoutTheme: "light", checkoutCountdown: "1", checkoutGuarantee: "1", checkoutTestimonials: "1" });
    await db().update(product).set({ offerEndsAt: null, testimonials: [] }).where(eq(product.slug, "metodo-demo"));
  });
});

describe("media", () => {
  test("uploads are admin only and checked by content, not by name", async () => {
    const image = Buffer.concat([PNG, Buffer.alloc(92)]);
    expect((await sendFile("photo.png", image)).status).toBe(401);
    await signInAsAdmin();
    expect(await (await sendFile("logo.svg", Buffer.from("<svg onload=alert(1)>"))).json()).toEqual({
      code: "MEDIA_TYPE",
    });
    expect(await (await sendFile("photo.png", Buffer.from("<svg onload=alert(1)></svg>"))).json()).toEqual({
      code: "MEDIA_TYPE",
    });
    expect(await (await sendFile("video.mp4", image)).json()).toEqual({ code: "MEDIA_TYPE" });
    const tooBig = await sendFile("huge.png", Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ code: "MEDIA_TOO_LARGE" });
    expect(mediaFiles()).toEqual([]);
    const saved = await (await sendFile("Foto Capa.PNG", image)).json();
    expect(saved.path).toMatch(/^\/media\/[a-f0-9]{32}\.png$/);
    expect(mediaFiles()).toEqual([saved.path.slice(7)]);
  });

  test("files are served with byte ranges and long caching", async () => {
    await signInAsAdmin();
    const bytes = Buffer.concat([Buffer.from("00000018667479706d703432", "hex"), Buffer.alloc(88, 7)]);
    const { path } = await (await sendFile("aula.mp4", bytes)).json();
    const file = String(path).slice(7);
    const full = await fetchMedia(file);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);
    const head = await fetchMedia(file, "bytes=0-1");
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 0-1/100");
    expect(head.headers.get("content-length")).toBe("2");
    expect([...Buffer.from(await head.arrayBuffer())]).toEqual([0, 0]);
    const tail = await fetchMedia(file, "bytes=-3");
    expect(tail.headers.get("content-range")).toBe("bytes 97-99/100");
    expect((await fetchMedia(file, "bytes=90-")).headers.get("content-range")).toBe("bytes 90-99/100");
    const outside = await fetchMedia(file, "bytes=100-");
    expect(outside.status).toBe(416);
    expect(outside.headers.get("content-range")).toBe("bytes */100");
    expect((await fetchMedia("../librefunnel.db")).status).toBe(404);
    expect((await fetchMedia(`${"a".repeat(32)}.mp4`)).status).toBe(404);
  });

  test("a lesson video opens only for the admin and current buyers", async () => {
    await signInAsAdmin();
    const bytes = Buffer.concat([Buffer.from("00000018667479706d703432", "hex"), Buffer.alloc(88, 7)]);
    const { path } = await (await sendFile("aula.mp4", bytes)).json();
    const file = String(path).slice(7);
    await saveLesson({ code: null }, form({ lesson: "m1a2", title: "Aula paga", video: path, text: "" }));
    const asAdmin = await fetchMedia(file);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.headers.get("cache-control")).toBe("private, no-store");
    freshBrowser("192.0.2.88");
    expect((await fetchMedia(file)).status).toBe(404);
    const id = await buy({ email: "viewer@example.com" });
    await pay(id, 9700, `viewer-${id}`);
    await redirected(enterFromOrder());
    expect((await fetchMedia(file)).status).toBe(200);
    await db().update(order).set({ status: "refunded" }).where(eq(order.id, id));
    expect((await fetchMedia(file)).status).toBe(404);
  });
});

describe("database", () => {
  test("migrations rerun on an existing database without seeding it again", async () => {
    const before = await db().$count(product);
    await migrate();
    expect(await db().$count(product)).toBe(before);
    expect(await db().$count(setting, eq(setting.key, "brand"))).toBe(1);
  });
});
