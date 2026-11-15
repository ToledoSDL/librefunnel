import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "bun:test";
import { inArray } from "drizzle-orm";
import { savePixKey, saveSettings, saveSmtp } from "@/lib/actions";
import { credentials, removeCredentials, settings, storePix } from "@/lib/catalog";
import { db } from "@/lib/db";
import { setting } from "@/lib/schema";
import { fakeServer, form, redirectFetch } from "./fakes";
import { signInAsAdmin } from "./flows";

const CNPJ = "11222333000181";
const FILLED = ["legal_name", "document", "support_email", "owner_email"] as const;

describe("forms filled from what the store already knows", () => {
  let registry: Awaited<ReturnType<typeof fakeServer>>;

  beforeAll(async () => {
    registry = await fakeServer({
      [`GET /api/cnpj/v1/${CNPJ}`]: {
        status: 200,
        body: {
          razao_social: "DOCES DA ANA LTDA",
          codigo_municipio_ibge: 4216602,
          municipio: "SAO JOSE",
          uf: "SC",
          opcao_pelo_simples: true,
          opcao_pelo_mei: false,
        },
      },
    });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    redirectFetch("https://brasilapi.com.br", registry.url);
    await db()
      .delete(setting)
      .where(inArray(setting.key, [...FILLED]));
    await signInAsAdmin();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await registry.close();
  });

  test("a CNPJ Pix key brings the holder's legal name and city", async () => {
    expect(await savePixKey({ code: null }, form({ pixKey: "11.222.333/0001-81", pixName: "", pixCity: "" }))).toEqual({
      code: null,
      ok: true,
    });
    expect(await storePix()).toEqual({ key: CNPJ, name: "DOCES DA ANA LTDA", city: "Sao Jose" });
  });

  test("a phone key takes the store's legal name and the city of the store's CNPJ", async () => {
    await saveSettings({ code: null }, form({ document: CNPJ, legalName: "Ana Doces" }));
    expect(await savePixKey({ code: null }, form({ pixKey: "+55 48 99999-0000", pixName: "", pixCity: "" }))).toEqual({
      code: null,
      ok: true,
    });
    expect(await storePix()).toMatchObject({ name: "Ana Doces", city: "Sao Jose" });
  });

  test("a CNPJ in the seller's data fills the legal name left blank, and a wrong check digit is refused", async () => {
    expect(await saveSettings({ code: null }, form({ document: "11.222.333/0001-82", legalName: "" }))).toEqual({
      code: "INVALID_DOCUMENT",
    });
    expect(await saveSettings({ code: null }, form({ document: "11.222.333/0001-81", legalName: "" }))).toEqual({
      code: null,
      ok: true,
    });
    expect(await settings()).toMatchObject({ document: CNPJ, legalName: "DOCES DA ANA LTDA" });
  });

  test("a Gmail address needs no server, and becomes the support and sales e-mail unless one was cleared", async () => {
    await saveSettings({ code: null }, form({ supportEmail: "" }));
    expect(
      await saveSmtp(
        { code: null },
        form({ preset: "", host: "", port: "", user: "loja@gmail.com", password: "app", from: "" }),
      ),
    ).toEqual({ code: null, ok: true });

    const smtp = (await credentials("smtp"))("smtp");
    expect([smtp("host"), smtp("port")]).toEqual(["smtp.gmail.com", "587"]);
    expect(await settings()).toMatchObject({ supportEmail: undefined, ownerEmail: "loja@gmail.com" });
    await removeCredentials("smtp");
  });
});
