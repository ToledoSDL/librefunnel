import "server-only";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Faq, Testimonial, Trigger } from "./catalog";

// The const type parameter keeps each value as a literal type, so enum columns stay typed without a cast.
function literals<const T extends readonly [string, ...string[]]>(...values: T): T {
  return values;
}

const ORDER_STATUSES = literals("pending", "paid", "expired", "canceled", "refunded");
const PAYMENT_SOURCES = literals("webhook", "admin");
const CLICK_KINDS = literals("", "fbclid", "gclid", "ttclid");

const EVENT_NAMES = literals(
  "page_view",
  "video_play",
  "video_25",
  "video_50",
  "video_75",
  "video_100",
  "cta_view",
  "cta_click",
  "video_watch",
  "checkout_view",
  "store_click",
  "video_unmute",
  "checkout_start",
  "bump_add",
  "pix_view",
  "pix_copy",
  "member_access",
);

const CHANNELS = literals("email", "whatsapp");
const MESSAGE_KINDS = literals("access", "paid", "recovery", "login", "reply", "owner", "inbound", "manual");
const MESSAGE_STATUSES = literals("queued", "sending", "sent", "delivered", "read", "failed", "skipped", "received");
const CONVERSION_NAMES = literals("InitiateCheckout", "AddPaymentInfo", "Purchase");
const SIGNAL_NAMES = literals("ViewContent", "InitiateCheckout");
const CONVERSION_STATUSES = literals("queued", "sent", "failed", "skipped");

const SETTING_KEYS = literals(
  "brand",
  "owner_email",
  "owner_whatsapp",
  "terms_url",
  "terms_version",
  "order_hours",
  "logo",
  "icon",
  "accent",
  "support_email",
  "support_whatsapp",
  "legal_name",
  "document",
  "privacy_url",
  "powered_by",
  "description",
  "share_image",
  "home",
  "checkout_phone",
  "confirm_email",
  "checkout_theme",
  "checkout_button",
  "checkout_notice",
  "checkout_countdown",
  "checkout_trust",
  "checkout_guarantee",
  "checkout_testimonials",
  "thanks_url",
  "thanks_label",
);

const INTEGRATION_KINDS = literals(
  "smtp",
  "meta",
  "pix",
  "mercadopago",
  "woovi",
  "abacatepay",
  "depix",
  "noxpay",
  "webhook",
  "evolution",
  "whatsapp",
  "storage",
);

function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true });
}

function oneOf(column: AnyPgColumn, values: readonly string[]) {
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

export const customer = pgTable("customer", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamptz("created_at").notNull(),
  // Signing out ends every session of this buyer started before it, on any device.
  sessionsAfter: timestamptz("sessions_after"),
});

export const order = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    product: text("product").notNull(),
    bump: text("bump"),
    productAmount: integer("product_amount").notNull(),
    bumpAmount: integer("bump_amount"),
    amount: integer("amount")
      .notNull()
      .generatedAlwaysAs(sql`product_amount + COALESCE(bump_amount, 0)`),
    name: text("name").notNull(),
    phone: text("phone"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    txid: text("txid").notNull().unique(),
    pixCode: text("pix_code").notNull(),
    psp: text("psp"),
    pspCheckAt: timestamptz("psp_check_at"),
    cryptoAt: timestamptz("crypto_at"),
    expiresAt: timestamptz("expires_at").notNull(),
    recoveryStep: integer("recovery_step").notNull().default(0),
    recoveryAt: timestamptz("recovery_at"),
    visitorId: text("visitor_id"),
    ip: text("ip").notNull(),
    userAgent: text("user_agent").notNull(),
    fbp: text("fbp"),
    fbc: text("fbc"),
    termsVersion: text("terms_version").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    check("orders_product_amount", sql`${table.productAmount} > 0`),
    check("orders_bump_amount", sql`${table.bumpAmount} > 0`),
    check("orders_status", oneOf(table.status, ORDER_STATUSES)),
    check("orders_bump_pair", sql`(${table.bump} IS NULL) = (${table.bumpAmount} IS NULL)`),
    uniqueIndex("orders_one_pending")
      .on(table.customerId, table.product)
      .where(sql`${table.status} = 'pending'`),
    index("orders_recovery")
      .on(table.recoveryAt)
      .where(sql`${table.status} = 'pending'`),
    index("orders_expiry")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
    index("orders_customer").on(table.customerId, table.status),
    index("orders_created").on(table.createdAt),
    index("orders_phone").on(table.phone, table.createdAt),
    index("orders_psp_check")
      .on(table.pspCheckAt)
      .where(sql`${table.pspCheckAt} IS NOT NULL`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id),
    amount: integer("amount").notNull(),
    source: text("source", { enum: PAYMENT_SOURCES }).notNull(),
    externalId: text("external_id").unique(),
    payload: text("payload"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    check("payment_amount", sql`${table.amount} <> 0`),
    check("payment_source", oneOf(table.source, PAYMENT_SOURCES)),
    index("payment_order").on(table.orderId),
    index("payment_created").on(table.createdAt),
  ],
);

export const touch = pgTable(
  "touch",
  {
    visitorId: text("visitor_id").notNull(),
    source: text("source").notNull().default(""),
    medium: text("medium").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    content: text("content").notNull().default(""),
    term: text("term").notNull().default(""),
    clickKind: text("click_kind", { enum: CLICK_KINDS }).notNull().default(""),
    clickId: text("click_id").notNull().default(""),
    referrerHost: text("referrer_host").notNull().default(""),
    landing: text("landing").notNull(),
    firstSeenAt: timestamptz("first_seen_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.visitorId,
        table.source,
        table.medium,
        table.campaign,
        table.content,
        table.term,
        table.clickId,
        table.referrerHost,
      ],
    }),
    check("touch_click_kind", oneOf(table.clickKind, CLICK_KINDS)),
  ],
);

export const event = pgTable(
  "event",
  {
    visitorId: text("visitor_id").notNull(),
    product: text("product").notNull(),
    name: text("name", { enum: EVENT_NAMES }).notNull(),
    // Only video_watch uses it: seconds of the sales video played, replays included.
    value: integer("value").notNull().default(0),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.visitorId, table.product, table.name] }),
    check("event_name", oneOf(table.name, EVENT_NAMES)),
    index("event_report").on(table.createdAt, table.product, table.name),
  ],
);

export const message = pgTable(
  "message",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    address: text("address").notNull(),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull(),
    step: integer("step").notNull().default(0),
    orderId: text("order_id").references(() => order.id),
    customerId: text("customer_id").references(() => customer.id),
    body: text("body").notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    error: text("error"),
    externalId: text("external_id"),
    attempts: integer("attempts").notNull().default(0),
    nextAt: timestamptz("next_at"),
    createdAt: timestamptz("created_at").notNull(),
    sentAt: timestamptz("sent_at"),
  },
  (table) => [
    check("message_channel", oneOf(table.channel, CHANNELS)),
    check("message_kind", oneOf(table.kind, MESSAGE_KINDS)),
    check("message_status", oneOf(table.status, MESSAGE_STATUSES)),
    uniqueIndex("message_once")
      .on(table.orderId, table.kind, table.step, table.channel)
      .where(sql`${table.orderId} IS NOT NULL`),
    uniqueIndex("message_inbound_once")
      .on(table.externalId)
      .where(sql`${table.kind} = 'inbound'`),
    index("message_due")
      .on(table.nextAt)
      .where(sql`${table.status} = 'queued'`),
    index("message_address").on(table.address, table.createdAt),
    index("message_customer").on(table.customerId, table.kind, table.createdAt),
    index("message_external")
      .on(table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
    index("message_inbox")
      .on(table.createdAt)
      .where(sql`${table.kind} = 'inbound' OR ${table.status} = 'failed'`),
  ],
);

export const conversion = pgTable(
  "conversion",
  {
    orderId: text("order_id")
      .notNull()
      .references(() => order.id),
    name: text("name", { enum: CONVERSION_NAMES }).notNull(),
    status: text("status", { enum: CONVERSION_STATUSES }).notNull().default("queued"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    nextAt: timestamptz("next_at").notNull(),
    sentAt: timestamptz("sent_at"),
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.name] }),
    check("conversion_name", oneOf(table.name, CONVERSION_NAMES)),
    check("conversion_status", oneOf(table.status, CONVERSION_STATUSES)),
    index("conversion_due")
      .on(table.nextAt)
      .where(sql`${table.status} = 'queued'`),
  ],
);

// Meta events from before an order exists, one per visitor, product and name, sent by the background loop.
export const signal = pgTable(
  "signal",
  {
    visitorId: text("visitor_id").notNull(),
    product: text("product").notNull(),
    name: text("name", { enum: SIGNAL_NAMES }).notNull(),
    ip: text("ip").notNull(),
    userAgent: text("user_agent").notNull(),
    fbp: text("fbp"),
    fbc: text("fbc"),
    status: text("status", { enum: CONVERSION_STATUSES }).notNull().default("queued"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    nextAt: timestamptz("next_at").notNull(),
    sentAt: timestamptz("sent_at"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.visitorId, table.product, table.name] }),
    check("signal_name", oneOf(table.name, SIGNAL_NAMES)),
    check("signal_status", oneOf(table.status, CONVERSION_STATUSES)),
    index("signal_due")
      .on(table.nextAt)
      .where(sql`${table.status} = 'queued'`),
  ],
);

export const login = pgTable(
  "login",
  {
    tokenHash: text("token_hash").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    createdAt: timestamptz("created_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
  },
  (table) => [index("login_customer").on(table.customerId, table.createdAt)],
);

export const progress = pgTable(
  "progress",
  {
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    product: text("product").notNull(),
    lesson: text("lesson").notNull(),
    doneAt: timestamptz("done_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.customerId, table.product, table.lesson] })],
);

// One row per e-mail or WhatsApp number: whether it opted out, and what WhatsApp tells about it
// (the profile name from its messages, the profile photo in base64 and when that photo was last looked up).
export const contact = pgTable("contact", {
  address: text("address").primaryKey(),
  name: text("name"),
  photo: text("photo"),
  photoType: text("photo_type"),
  photoCheckedAt: timestamptz("photo_checked_at"),
  optedOutAt: timestamptz("opted_out_at"),
});

export const product = pgTable(
  "product",
  {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    tagline: text("tagline"),
    pixKey: text("pix_key").notNull(),
    pixName: text("pix_name").notNull(),
    pixCity: text("pix_city").notNull(),
    offerEndsAt: timestamptz("offer_ends_at"),
    guaranteeDays: integer("guarantee_days").notNull().default(7),
    bumpProduct: text("bump_product").references((): AnyPgColumn => product.slug),
    bumpPriceCents: integer("bump_price_cents"),
    bumpHeadline: text("bump_headline"),
    vslVideo: text("vsl_video"),
    ctaSeconds: integer("cta_seconds").notNull().default(0),
    ctaText: text("cta_text"),
    playerAutoplay: boolean("player_autoplay").notNull().default(true),
    playerResume: boolean("player_resume").notNull().default(true),
    playerFastBar: boolean("player_fast_bar").notNull().default(false),
    playerFloating: boolean("player_floating").notNull().default(true),
    playerButton: boolean("player_button").notNull().default(true),
    playerSpeed: boolean("player_speed").notNull().default(false),
    captions: text("captions"),
    triggers: jsonb("triggers").$type<Trigger[]>().notNull().default([]),
    barText: text("bar_text"),
    barColor: text("bar_color"),
    banner: text("banner"),
    cover: text("cover"),
    faq: jsonb("faq").$type<Faq[]>().notNull().default([]),
    testimonials: jsonb("testimonials").$type<Testimonial[]>().notNull().default([]),
    position: integer("position").notNull(),
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [
    check("product_price", sql`${table.priceCents} > 0`),
    check("product_guarantee", sql`${table.guaranteeDays} BETWEEN 7 AND 365`),
    check("product_bump_price", sql`${table.bumpPriceCents} > 0`),
    check("product_cta_seconds", sql`${table.ctaSeconds} BETWEEN 0 AND 7200`),
    check("product_faq", sql`jsonb_typeof(${table.faq}) = 'array'`),
    check("product_testimonials", sql`jsonb_typeof(${table.testimonials}) = 'array'`),
    check("product_triggers", sql`jsonb_typeof(${table.triggers}) = 'array'`),
    check("product_bump_self", sql`${table.bumpProduct} IS DISTINCT FROM ${table.slug}`),
  ],
);

export const module = pgTable(
  "module",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    product: text("product")
      .notNull()
      .references(() => product.slug),
    title: text("title").notNull(),
    cover: text("cover"),
    position: integer("position").notNull(),
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [index("module_product").on(table.product, table.position)],
);

export const lesson = pgTable(
  "lesson",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    moduleId: integer("module_id")
      .notNull()
      .references(() => module.id),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    video: text("video").notNull().default(""),
    text: text("text").notNull().default(""),
    position: integer("position").notNull(),
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [index("lesson_module").on(table.moduleId, table.position)],
);

export const recoveryStep = pgTable(
  "recovery_step",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    afterMinutes: integer("after_minutes").notNull(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    check("recovery_step_after", sql`${table.afterMinutes} > 0`),
    check("recovery_step_channel", oneOf(table.channel, CHANNELS)),
  ],
);

export const reply = pgTable(
  "reply",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    keywords: text("keywords").array().notNull(),
    text: text("text").notNull(),
  },
  (table) => [check("reply_keywords", sql`cardinality(${table.keywords}) > 0`)],
);

export const setting = pgTable(
  "setting",
  {
    key: text("key", { enum: SETTING_KEYS }).primaryKey(),
    value: text("value").notNull(),
  },
  (table) => [check("setting_key", oneOf(table.key, SETTING_KEYS))],
);

// fields holds plain values; secrets holds values sealed with AES-256-GCM (guard.seal), keyed by field name.
export const integration = pgTable(
  "integration",
  {
    kind: text("kind", { enum: INTEGRATION_KINDS }).primaryKey(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
    secrets: jsonb("secrets").$type<Record<string, string>>().notNull().default({}),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("integration_kind", oneOf(table.kind, INTEGRATION_KINDS)),
    check("integration_fields", sql`jsonb_typeof(${table.fields}) = 'object'`),
    check("integration_secrets", sql`jsonb_typeof(${table.secrets}) = 'object'`),
  ],
);

// One row per second of a product's sales video: how many plays reached it, for the retention curve.
export const retention = pgTable(
  "retention",
  {
    product: text("product")
      .notNull()
      .references(() => product.slug),
    second: integer("second").notNull(),
    views: integer("views").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.product, table.second] }),
    check("retention_second", sql`${table.second} BETWEEN 0 AND 7200`),
  ],
);
