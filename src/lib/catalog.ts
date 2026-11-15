import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { cache } from "react";
import { db, newId } from "./db";
import type { Database } from "./db";
import { cleanEmail, seal, unseal } from "./guard";
import { integration, lesson, module, product, setting } from "./schema";

export type CatalogCode =
  | "INVALID_COLOR"
  | "INVALID_DOCUMENT"
  | "INVALID_SLUG"
  | "SLUG_TAKEN"
  | "INVALID_TITLE"
  | "INVALID_PRICE"
  | "INVALID_PIX_KEY"
  | "INVALID_PIX_HOLDER"
  | "INVALID_DATE"
  | "INVALID_CTA_SECONDS"
  | "INVALID_TRIGGER"
  | "INVALID_GUARANTEE"
  | "INVALID_BUMP"
  | "INVALID_TEXT"
  | "INVALID_MEDIA"
  | "INVALID_FAQ"
  | "INVALID_TESTIMONIAL"
  | "INVALID_ORDER_HOURS"
  | "INVALID_URL"
  | "INVALID_TRANSITION"
  | "INVALID_HOST"
  | "INVALID_PORT"
  | "INVALID_CREDENTIAL"
  | "INVALID_PIXEL_ID"
  | "INVALID_TEST_EVENT_CODE"
  | "INVALID_EVOLUTION_URL"
  | "INVALID_WEBHOOK_SECRET"
  | "PIX_PROVIDER_NOT_CONFIGURED";
type Lesson = { id: string; title: string; video: string; text: string; archived: boolean };
export type Module = { id: number; title: string; cover?: string; lessons: Lesson[]; archived: boolean };
export type Testimonial = { name: string; text: string; stars: number };
export type Faq = { q: string; a: string };
export type Player = {
  autoplay: boolean;
  resume: boolean;
  fastBar: boolean;
  floating: boolean;
  button: boolean;
  speed: boolean;
};
export const DEFAULT_BAR = "#c62828";
export type Trigger = { at: number; until: number; text: string; button: boolean };
export type Product = {
  slug: string;
  name: string;
  price: number;
  tagline?: string;
  vsl?: { video: string; ctaSeconds: number; ctaText?: string; captions?: string };
  player: Player;
  triggers: Trigger[];
  bar?: { text: string; color?: string };
  pix: { key: string; name: string; city: string };
  banner?: string;
  cover?: string;
  offerEndsAt?: Date;
  guaranteeDays: number;
  orderBump?: { product: string; price?: number; headline?: string };
  modules: Module[];
  testimonials: Testimonial[];
  faq: Faq[];
  archived: boolean;
};
export type OrderBump = Product & { bumpPrice: number; headline?: string };
export type ProductFields = {
  name: string;
  price: number;
  tagline: string | null;
  offerEndsAt: Date | null;
  guaranteeDays: number;
  bumpProduct: string | null;
  bumpPrice: number | null;
  bumpHeadline: string | null;
  vslVideo: string | null;
  ctaSeconds: number;
  ctaText: string | null;
  captions: string | null;
  player: Player;
  triggers: Trigger[];
  barText: string | null;
  barColor: string | null;
  banner: string | null;
  cover: string | null;
  faq: Faq[];
  testimonials: Testimonial[];
};
export type Settings = {
  brand: string;
  ownerEmail?: string;
  ownerWhatsapp?: string;
  termsUrl?: string;
  termsVersion: string;
  orderHours: number;
  logo?: string;
  icon?: string;
  accent?: string;
  supportEmail?: string;
  supportWhatsapp?: string;
  legalName?: string;
  document?: string;
  privacyUrl?: string;
  poweredBy: boolean;
  description?: string;
  shareImage?: string;
  home?: string;
  checkoutPhone: "optional" | "required" | "hidden";
  confirmEmail: boolean;
  checkoutTheme: "light" | "dark" | "auto";
  checkoutButton: string;
  checkoutNotice?: string;
  checkoutCountdown: boolean;
  checkoutTrust: boolean;
  checkoutGuarantee: boolean;
  checkoutTestimonials: boolean;
  thanksUrl?: string;
  thanksLabel: string;
};
export const CHECKOUT_PHONE = ["optional", "required", "hidden"] as const;
export const CHECKOUT_THEME = ["light", "dark", "auto"] as const;
export const CHECKOUT_LABELS = { button: "Pagar com Pix", thanks: "Próximo passo" };
const SETTING_KEYS = setting.key.enumValues;
export type SettingValues = Partial<Record<(typeof setting.$inferSelect)["key"], string>>;
export type IntegrationKind = (typeof integration.$inferSelect)["kind"];
type FieldName<K extends IntegrationKind> = (typeof INTEGRATIONS)[K]["fields"][number];
type SecretName<K extends IntegrationKind> = (typeof INTEGRATIONS)[K]["secrets"][number];
export type Credentials<K extends IntegrationKind> = (name: FieldName<K> | SecretName<K>) => string;
type Kind = "product" | "module" | "lesson";
type Item = {
  table: PgTable;
  key: AnyPgColumn;
  position: AnyPgColumn;
  parent: AnyPgColumn | null;
  archivedAt: AnyPgColumn;
};

const ITEMS: Record<Kind, Item> = {
  product: {
    table: product,
    key: product.slug,
    position: product.position,
    parent: null,
    archivedAt: product.archivedAt,
  },
  module: {
    table: module,
    key: module.id,
    position: module.position,
    parent: module.product,
    archivedAt: module.archivedAt,
  },
  lesson: {
    table: lesson,
    key: lesson.slug,
    position: lesson.position,
    parent: lesson.moduleId,
    archivedAt: lesson.archivedAt,
  },
};

// The Pix providers share field names; the panel labels them Access Token, AppID, API key or Client Secret.
const INTEGRATIONS = {
  smtp: { fields: ["host", "port", "user", "from"], secrets: ["password"] },
  meta: { fields: ["pixelId", "testEventCode"], secrets: ["token"] },
  pix: { fields: ["provider", "key", "name", "city"], secrets: [] },
  mercadopago: { fields: [], secrets: ["apiKey", "webhookSecret"] },
  woovi: {
    fields: [
      "publicKeys",
      "keysAt",
      "convertMode",
      "convertAsset",
      "convertWallet",
      "convertSince",
      "convertNextAt",
      "convertError",
    ],
    secrets: ["apiKey", "webhookSecret"],
  },
  abacatepay: { fields: [], secrets: ["apiKey", "webhookSecret"] },
  depix: { fields: ["clientId"], secrets: ["apiKey", "webhookSecret"] },
  noxpay: { fields: ["currency"], secrets: ["apiKey", "webhookSecret"] },
  webhook: { fields: [], secrets: ["secret"] },
  storage: { fields: ["endpoint", "bucket", "region", "accessKey"], secrets: ["secret"] },
  evolution: { fields: ["url"], secrets: ["key"] },
  whatsapp: { fields: ["phoneId", "wabaId", "number"], secrets: ["token", "appSecret"] },
} as const satisfies Record<IntegrationKind, { fields: readonly string[]; secrets: readonly string[] }>;

const PRODUCT_COLUMNS = {
  slug: product.slug,
  name: product.name,
  price: product.priceCents,
  tagline: product.tagline,
  pixKey: product.pixKey,
  pixName: product.pixName,
  pixCity: product.pixCity,
  offerEndsAt: product.offerEndsAt,
  guaranteeDays: product.guaranteeDays,
  bumpProduct: product.bumpProduct,
  bumpPrice: product.bumpPriceCents,
  bumpHeadline: product.bumpHeadline,
  vslVideo: product.vslVideo,
  ctaSeconds: product.ctaSeconds,
  ctaText: product.ctaText,
  playerAutoplay: product.playerAutoplay,
  playerResume: product.playerResume,
  playerFastBar: product.playerFastBar,
  playerFloating: product.playerFloating,
  playerButton: product.playerButton,
  playerSpeed: product.playerSpeed,
  captions: product.captions,
  triggers: product.triggers,
  barText: product.barText,
  barColor: product.barColor,
  banner: product.banner,
  cover: product.cover,
  faq: product.faq,
  testimonials: product.testimonials,
  archivedAt: product.archivedAt,
};

// Two queries whatever the number of products: the products, then every module joined to its lessons.
async function load(filter: SQL | undefined, admin: boolean): Promise<Product[]> {
  const rows = await db().select(PRODUCT_COLUMNS).from(product).where(filter).orderBy(product.position, product.slug);

  const products = rows.map((row): Product => ({
    slug: row.slug,
    name: row.name,
    price: row.price,
    tagline: row.tagline ?? undefined,
    vsl: row.vslVideo
      ? {
          video: row.vslVideo,
          ctaSeconds: row.ctaSeconds,
          ctaText: row.ctaText ?? undefined,
          captions: row.captions ?? undefined,
        }
      : undefined,
    player: {
      autoplay: row.playerAutoplay,
      resume: row.playerResume,
      fastBar: row.playerFastBar,
      floating: row.playerFloating,
      button: row.playerButton,
      speed: row.playerSpeed,
    },
    triggers: row.triggers,
    bar: row.barText ? { text: row.barText, color: row.barColor ?? undefined } : undefined,
    pix: { key: row.pixKey, name: row.pixName, city: row.pixCity },
    banner: row.banner ?? undefined,
    cover: row.cover ?? undefined,
    offerEndsAt: row.offerEndsAt ?? undefined,
    guaranteeDays: row.guaranteeDays,
    orderBump: row.bumpProduct
      ? { product: row.bumpProduct, price: row.bumpPrice ?? undefined, headline: row.bumpHeadline ?? undefined }
      : undefined,
    modules: [],
    faq: row.faq,
    testimonials: row.testimonials,
    archived: row.archivedAt !== null,
  }));

  if (products.length === 0) return products;
  const bySlug = new Map(products.map((entry) => [entry.slug, entry]));

  const lessons = await db()
    .select({
      product: module.product,
      id: module.id,
      title: module.title,
      cover: module.cover,
      archivedAt: module.archivedAt,
      lesson: {
        id: lesson.slug,
        title: lesson.title,
        video: lesson.video,
        text: lesson.text,
        archivedAt: lesson.archivedAt,
      },
    })
    .from(module)
    .leftJoin(lesson, and(eq(lesson.moduleId, module.id), admin ? undefined : isNull(lesson.archivedAt)))
    .where(and(inArray(module.product, [...bySlug.keys()]), admin ? undefined : isNull(module.archivedAt)))
    .orderBy(module.position, module.id, lesson.position, lesson.id);

  for (const row of lessons) {
    const modules = bySlug.get(row.product)?.modules;
    if (!modules) continue;
    let current = modules.at(-1);
    if (current?.id !== row.id) {
      current = {
        id: row.id,
        title: row.title,
        cover: row.cover ?? undefined,
        lessons: [],
        archived: row.archivedAt !== null,
      };
      modules.push(current);
    }
    if (row.lesson) {
      const { archivedAt, ...entry } = row.lesson;
      current.lessons.push({ ...entry, archived: archivedAt !== null });
    }
  }
  return products;
}

// The admin sees archived products, modules and lessons; buyers see active products and only active lessons.
export function products(admin = false): Promise<Product[]> {
  return load(admin ? undefined : isNull(product.archivedAt), admin);
}

// Archived products still resolve here so old orders, Pix pages and member access keep working.
export const getProduct = cache(
  async (slug: string, admin = false): Promise<Product | undefined> => (await load(eq(product.slug, slug), admin))[0],
);

export function ownedProducts(slugs: string[]): Promise<Product[]> {
  return load(inArray(product.slug, slugs), false);
}

export async function productNames(executor: Database = db()): Promise<Map<string, string>> {
  const rows = await executor.select({ slug: product.slug, name: product.name }).from(product);
  return new Map(rows.map((row): [string, string] => [row.slug, row.name]));
}

export async function productStates() {
  const rows = await db()
    .select({ slug: product.slug, name: product.name, archivedAt: product.archivedAt })
    .from(product);

  return rows.map((row) => ({ slug: row.slug, name: row.name, archived: row.archivedAt !== null }));
}

export async function orderBump(offer: Product): Promise<OrderBump | undefined> {
  const bump = offer.orderBump;
  const extra = bump ? await getProduct(bump.product) : undefined;
  if (!bump || !extra || extra.archived) return undefined;
  return { ...extra, bumpPrice: bump.price ?? extra.price, headline: bump.headline };
}

// The store's own Pix key, set once in Conexões. Stores from before it existed have it only on their products.
export async function storePix(): Promise<Product["pix"] | undefined> {
  const stored = (await credentials("pix"))("pix");
  if (stored("key")) return { key: stored("key"), name: stored("name"), city: stored("city") };

  const [newest] = await db()
    .select({ key: product.pixKey, name: product.pixName, city: product.pixCity })
    .from(product)
    .orderBy(desc(product.position))
    .limit(1);

  return newest;
}

// Every product keeps a copy of the key, so the static BR Code and a previous version running alongside still work.
export async function saveStorePix(pix: Product["pix"]) {
  await db().transaction(async (tx) => {
    await tx.update(product).set({ pixKey: pix.key, pixName: pix.name, pixCity: pix.city });
    await saveCredentials("pix", { key: pix.key, name: pix.name, city: pix.city }, {}, tx);
  });
}

export async function createProduct(
  slug: string,
  fields: Pick<ProductFields, "name" | "price">,
  pix: Product["pix"],
): Promise<CatalogCode | null> {
  const inserted = await db()
    .insert(product)
    .values({
      slug,
      name: fields.name,
      priceCents: fields.price,
      pixKey: pix.key,
      pixName: pix.name,
      pixCity: pix.city,
      position: sql`(SELECT COALESCE(MAX(${product.position}), 0) + 1 FROM ${product})`,
    })
    .onConflictDoNothing({ target: product.slug })
    .returning({ slug: product.slug });

  return inserted.length === 1 ? null : "SLUG_TAKEN";
}

export function updateProduct(slug: string, fields: ProductFields): Promise<CatalogCode | null> {
  return db().transaction(async (tx) => {
    if (fields.bumpProduct !== null) {
      const [target] = await tx
        .select({ archivedAt: product.archivedAt })
        .from(product)
        .where(eq(product.slug, fields.bumpProduct))
        .for("share");

      if (fields.bumpProduct === slug || !target || target.archivedAt !== null) return "INVALID_BUMP";
    }

    const changed = await tx
      .update(product)
      .set({
        name: fields.name,
        priceCents: fields.price,
        tagline: fields.tagline,
        offerEndsAt: fields.offerEndsAt,
        guaranteeDays: fields.guaranteeDays,
        bumpProduct: fields.bumpProduct,
        bumpPriceCents: fields.bumpPrice,
        bumpHeadline: fields.bumpHeadline,
        vslVideo: fields.vslVideo,
        ctaSeconds: fields.ctaSeconds,
        ctaText: fields.ctaText,
        playerAutoplay: fields.player.autoplay,
        playerResume: fields.player.resume,
        playerFastBar: fields.player.fastBar,
        playerFloating: fields.player.floating,
        playerButton: fields.player.button,
        playerSpeed: fields.player.speed,
        captions: fields.captions,
        triggers: fields.triggers,
        barText: fields.barText,
        barColor: fields.barColor,
        banner: fields.banner,
        cover: fields.cover,
        faq: fields.faq,
        testimonials: fields.testimonials,
      })
      .where(eq(product.slug, slug))
      .returning({ slug: product.slug });

    return changed.length === 1 ? null : "INVALID_TRANSITION";
  });
}

export async function saveModule(
  target: { id: number } | { product: string },
  title: string,
  cover: string | null,
): Promise<boolean> {
  if ("id" in target) {
    const changed = await db()
      .update(module)
      .set({ title, cover })
      .where(eq(module.id, target.id))
      .returning({ id: module.id });

    return changed.length === 1;
  }

  const [owner] = await db().select({ slug: product.slug }).from(product).where(eq(product.slug, target.product));
  if (!owner) return false;
  await db()
    .insert(module)
    .values({
      product: owner.slug,
      title,
      cover,
      position: sql`(SELECT COALESCE(MAX(${module.position}), 0) + 1 FROM ${module} WHERE ${module.product} = ${owner.slug})`,
    });
  return true;
}

// Lesson slugs are random and never change, so progress rows survive renames and reordering.
export async function saveLesson(
  target: { slug: string } | { module: number },
  values: { title: string; video: string; text: string },
): Promise<boolean> {
  if ("slug" in target) {
    const changed = await db()
      .update(lesson)
      .set(values)
      .where(eq(lesson.slug, target.slug))
      .returning({ id: lesson.id });

    return changed.length === 1;
  }

  const [parent] = await db().select({ id: module.id }).from(module).where(eq(module.id, target.module));
  if (!parent) return false;
  await db()
    .insert(lesson)
    .values({
      moduleId: parent.id,
      slug: newId().slice(0, 10),
      ...values,
      position: sql`(SELECT COALESCE(MAX(${lesson.position}), 0) + 1 FROM ${lesson} WHERE ${lesson.moduleId} = ${parent.id})`,
    });
  return true;
}

export function move(kind: Kind, key: string | number, up: boolean): Promise<boolean> {
  const item = ITEMS[kind];
  const mine = sql`(SELECT ${item.position} FROM ${item.table} WHERE ${item.key} = ${key})`;
  return db().transaction(async (tx) => {
    const [neighbor] = await tx
      .select({
        key: sql<string | number>`${item.key}`,
        position: sql<number>`${item.position}`,
        mine: sql<number>`${mine}`,
      })
      .from(item.table)
      .where(
        and(
          item.parent
            ? sql`${item.parent} = (SELECT ${item.parent} FROM ${item.table} WHERE ${item.key} = ${key})`
            : undefined,
          up ? sql`${item.position} < ${mine}` : sql`${item.position} > ${mine}`,
        ),
      )
      .orderBy(up ? desc(item.position) : asc(item.position))
      .limit(1);

    if (!neighbor) return false;
    await tx
      .update(item.table)
      .set({
        position: sql`CASE WHEN ${item.key} = ${key} THEN ${neighbor.position}::integer ELSE ${neighbor.mine}::integer END`,
      })
      .where(inArray(item.key, [key, neighbor.key]));
    return true;
  });
}

export async function archive(kind: Kind, key: string | number, archived: boolean): Promise<boolean> {
  const item = ITEMS[kind];

  const changed = await db()
    .update(item.table)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(item.key, key), archived ? isNull(item.archivedAt) : isNotNull(item.archivedAt)))
    .returning({ key: item.key });

  return changed.length === 1;
}

// cache() lasts one request: the layout, the metadata and the page of one view share a single read.
export const settings = cache(async (executor: Database = db()): Promise<Settings> => {
  const rows = await executor.select({ key: setting.key, value: setting.value }).from(setting);
  const values = new Map(rows.map((row): [string, string] => [row.key, row.value]));
  return {
    brand: values.get("brand") || "LibreFunnel",
    ownerEmail: values.get("owner_email") || undefined,
    ownerWhatsapp: values.get("owner_whatsapp") || undefined,
    termsUrl: values.get("terms_url") || undefined,
    termsVersion: values.get("terms_version") ?? "",
    orderHours: Number(values.get("order_hours")) || 72,
    logo: values.get("logo") || undefined,
    icon: values.get("icon") || undefined,
    accent: values.get("accent") || undefined,
    supportEmail: values.get("support_email") || undefined,
    supportWhatsapp: values.get("support_whatsapp") || undefined,
    legalName: values.get("legal_name") || undefined,
    document: values.get("document") || undefined,
    privacyUrl: values.get("privacy_url") || undefined,
    poweredBy: values.get("powered_by") !== "0",
    description: values.get("description") || undefined,
    shareImage: values.get("share_image") || undefined,
    home: values.get("home") || undefined,
    checkoutPhone: CHECKOUT_PHONE.find((mode) => mode === values.get("checkout_phone")) ?? "optional",
    confirmEmail: values.get("confirm_email") !== "0",
    checkoutTheme: CHECKOUT_THEME.find((theme) => theme === values.get("checkout_theme")) ?? "light",
    checkoutButton: values.get("checkout_button") || CHECKOUT_LABELS.button,
    checkoutNotice: values.get("checkout_notice") || undefined,
    checkoutCountdown: values.get("checkout_countdown") !== "0",
    checkoutTrust: values.get("checkout_trust") !== "0",
    checkoutGuarantee: values.get("checkout_guarantee") !== "0",
    checkoutTestimonials: values.get("checkout_testimonials") !== "0",
    thanksUrl: values.get("thanks_url") || undefined,
    thanksLabel: values.get("thanks_label") || CHECKOUT_LABELS.thanks,
  };
});

// Only the keys given are written, so each settings screen saves its own fields without touching the rest.
export async function saveSettings(values: SettingValues) {
  const rows = Object.entries(values).flatMap(([key, value]) =>
    SETTING_KEYS.flatMap((known) => (known === key && value !== undefined ? [{ key: known, value }] : [])),
  );

  if (!rows.length) return;
  await db()
    .insert(setting)
    .values(rows)
    .onConflictDoUpdate({ target: setting.key, set: { value: sql`excluded.value` } });
}

// Read on every use, so a change saved in the panel applies to the next send without a restart.
export async function credentials<K extends IntegrationKind>(
  ...kinds: K[]
): Promise<<P extends K>(kind: P) => Credentials<P>> {
  const rows = await db()
    .select({ kind: integration.kind, fields: integration.fields, secrets: integration.secrets })
    .from(integration)
    .where(inArray(integration.kind, kinds));

  const byKind = new Map(rows.map((row) => [row.kind, row]));
  return (kind) => (name) => {
    const row = byKind.get(kind);
    const sealed = row?.secrets[name];
    return sealed === undefined ? (row?.fields[name] ?? "") : (unseal(sealed, `${kind}.${name}`) ?? "");
  };
}

// Fields are replaced; a blank secret keeps the stored one, so the panel never needs to send a secret back.
export async function saveCredentials<K extends IntegrationKind>(
  kind: K,
  fields: Partial<Record<FieldName<K>, string>>,
  secrets: Partial<Record<SecretName<K>, string>> = {},
  executor: Database = db(),
) {
  const plain: Record<string, string> = {};
  for (const [name, value] of Object.entries<string | undefined>(fields)) if (value !== undefined) plain[name] = value;
  const sealed: Record<string, string> = {};
  for (const [name, value] of Object.entries<string | undefined>(secrets))
    if (value) sealed[name] = seal(value, `${kind}.${name}`);

  await executor
    .insert(integration)
    .values({ kind, fields: plain, secrets: sealed, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: integration.kind,
      set: {
        fields: sql`${integration.fields} || excluded.fields`,
        secrets: sql`${integration.secrets} || excluded.secrets`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function removeCredentials(kind: IntegrationKind) {
  await db().delete(integration).where(eq(integration.kind, kind));
}

function cpfValid(digits: string): boolean {
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    return ((sum * 10) % 11) % 10 === Number(digits[length]);
  };

  return !/^(\d)\1{10}$/.test(digits) && check(9) && check(10);
}

// DICT key formats (BCB API-DICT): e-mail, EVP, +E.164 phone, CPF with check digits, alphanumeric CNPJ.
export function pixKey(raw: string): string | undefined {
  const value = raw.trim();
  if (value.includes("@")) {
    const email = cleanEmail(value);
    return email && email.length <= 77 ? email : undefined;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value.toLowerCase();
  if (value.startsWith("+")) {
    const phone = `+${value.replace(/\D/g, "")}`;
    return /^\+[1-9]\d{1,14}$/.test(phone) ? phone : undefined;
  }
  const document = value.replace(/[.\-/\s]/g, "").toUpperCase();
  if (/^\d{11}$/.test(document)) return cpfValid(document) ? document : undefined;
  return /^[A-Z0-9]{12}\d{2}$/.test(document) ? document : undefined;
}

// The BR Code only carries ASCII, 25 characters for the holder and 15 for the city.
export function pixText(value: string, max: number): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, max)
    .trim();
}
