CREATE TABLE "conversion" (
	"order_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "conversion_order_id_name_pk" PRIMARY KEY("order_id","name"),
	CONSTRAINT "conversion_name" CHECK ("conversion"."name" IN ('InitiateCheckout', 'Purchase')),
	CONSTRAINT "conversion_status" CHECK ("conversion"."status" IN ('queued', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customer_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"visitor_id" text NOT NULL,
	"product" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_visitor_id_product_name_pk" PRIMARY KEY("visitor_id","product","name"),
	CONSTRAINT "event_name" CHECK ("event"."name" IN ('page_view', 'video_play', 'video_25', 'video_50', 'video_75', 'video_100', 'cta_view', 'cta_click'))
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lesson_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"module_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"video" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "lesson_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "login" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "message_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"kind" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"order_id" text,
	"customer_id" text,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"external_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "message_channel" CHECK ("message"."channel" IN ('email', 'whatsapp')),
	CONSTRAINT "message_kind" CHECK ("message"."kind" IN ('access', 'paid', 'recovery', 'login', 'reply', 'owner', 'inbound')),
	CONSTRAINT "message_status" CHECK ("message"."status" IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'received'))
);
--> statement-breakpoint
CREATE TABLE "module" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "module_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product" text NOT NULL,
	"title" text NOT NULL,
	"cover" text,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "optout" (
	"address" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"product" text NOT NULL,
	"bump" text,
	"product_amount" integer NOT NULL,
	"bump_amount" integer,
	"amount" integer GENERATED ALWAYS AS (product_amount + COALESCE(bump_amount, 0)) STORED NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"txid" text NOT NULL,
	"pix_code" text NOT NULL,
	"psp" text,
	"psp_check_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"recovery_step" integer DEFAULT 0 NOT NULL,
	"recovery_at" timestamp with time zone,
	"visitor_id" text,
	"ip" text NOT NULL,
	"user_agent" text NOT NULL,
	"fbp" text,
	"fbc" text,
	"terms_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_txid_unique" UNIQUE("txid"),
	CONSTRAINT "orders_product_amount" CHECK ("orders"."product_amount" > 0),
	CONSTRAINT "orders_bump_amount" CHECK ("orders"."bump_amount" > 0),
	CONSTRAINT "orders_status" CHECK ("orders"."status" IN ('pending', 'paid', 'expired', 'canceled', 'refunded')),
	CONSTRAINT "orders_bump_pair" CHECK (("orders"."bump" IS NULL) = ("orders"."bump_amount" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" text NOT NULL,
	"amount" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"payload" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "payment_amount" CHECK ("payment"."amount" <> 0),
	CONSTRAINT "payment_source" CHECK ("payment"."source" IN ('webhook', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "product" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"tagline" text,
	"pix_key" text NOT NULL,
	"pix_name" text NOT NULL,
	"pix_city" text NOT NULL,
	"offer_ends_at" timestamp with time zone,
	"guarantee_days" integer DEFAULT 7 NOT NULL,
	"bump_product" text,
	"bump_price_cents" integer,
	"bump_headline" text,
	"vsl_video" text,
	"cta_seconds" integer DEFAULT 0 NOT NULL,
	"cta_text" text,
	"banner" text,
	"cover" text,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"testimonials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "product_price" CHECK ("product"."price_cents" > 0),
	CONSTRAINT "product_guarantee" CHECK ("product"."guarantee_days" BETWEEN 7 AND 365),
	CONSTRAINT "product_bump_price" CHECK ("product"."bump_price_cents" > 0),
	CONSTRAINT "product_cta_seconds" CHECK ("product"."cta_seconds" BETWEEN 0 AND 7200),
	CONSTRAINT "product_faq" CHECK (jsonb_typeof("product"."faq") = 'array'),
	CONSTRAINT "product_testimonials" CHECK (jsonb_typeof("product"."testimonials") = 'array'),
	CONSTRAINT "product_bump_self" CHECK ("product"."bump_product" IS DISTINCT FROM "product"."slug")
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"customer_id" text NOT NULL,
	"product" text NOT NULL,
	"lesson" text NOT NULL,
	"done_at" timestamp with time zone NOT NULL,
	CONSTRAINT "progress_customer_id_product_lesson_pk" PRIMARY KEY("customer_id","product","lesson")
);
--> statement-breakpoint
CREATE TABLE "recovery_step" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recovery_step_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"after_minutes" integer NOT NULL,
	"channel" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "recovery_step_after" CHECK ("recovery_step"."after_minutes" > 0),
	CONSTRAINT "recovery_step_channel" CHECK ("recovery_step"."channel" IN ('email', 'whatsapp'))
);
--> statement-breakpoint
CREATE TABLE "reply" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reply_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"keywords" text[] NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "reply_keywords" CHECK (cardinality("reply"."keywords") > 0)
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "setting_key" CHECK ("setting"."key" IN ('brand', 'owner_email', 'owner_whatsapp', 'terms_url', 'terms_version', 'order_hours'))
);
--> statement-breakpoint
CREATE TABLE "touch" (
	"visitor_id" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"medium" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"term" text DEFAULT '' NOT NULL,
	"click_kind" text DEFAULT '' NOT NULL,
	"click_id" text DEFAULT '' NOT NULL,
	"referrer_host" text DEFAULT '' NOT NULL,
	"landing" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "touch_visitor_id_source_medium_campaign_content_term_click_id_referrer_host_pk" PRIMARY KEY("visitor_id","source","medium","campaign","content","term","click_id","referrer_host"),
	CONSTRAINT "touch_click_kind" CHECK ("touch"."click_kind" IN ('', 'fbclid', 'gclid', 'ttclid'))
);
--> statement-breakpoint
ALTER TABLE "conversion" ADD CONSTRAINT "conversion_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login" ADD CONSTRAINT "login_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_product_product_slug_fk" FOREIGN KEY ("product") REFERENCES "public"."product"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_bump_product_product_slug_fk" FOREIGN KEY ("bump_product") REFERENCES "public"."product"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversion_due" ON "conversion" USING btree ("next_at") WHERE "conversion"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "event_report" ON "event" USING btree ("created_at","product","name");--> statement-breakpoint
CREATE INDEX "lesson_module" ON "lesson" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "login_customer" ON "login" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_once" ON "message" USING btree ("order_id","kind","step","channel") WHERE "message"."order_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "message_inbound_once" ON "message" USING btree ("external_id") WHERE "message"."kind" = 'inbound';--> statement-breakpoint
CREATE INDEX "message_due" ON "message" USING btree ("next_at") WHERE "message"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "message_address" ON "message" USING btree ("address","created_at");--> statement-breakpoint
CREATE INDEX "message_customer" ON "message" USING btree ("customer_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "message_external" ON "message" USING btree ("external_id") WHERE "message"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_inbox" ON "message" USING btree ("created_at") WHERE "message"."kind" = 'inbound' OR "message"."status" = 'failed';--> statement-breakpoint
CREATE INDEX "module_product" ON "module" USING btree ("product","position");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_pending" ON "orders" USING btree ("customer_id","product") WHERE "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "orders_recovery" ON "orders" USING btree ("recovery_at") WHERE "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "orders_expiry" ON "orders" USING btree ("expires_at") WHERE "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "orders_customer" ON "orders" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "orders_created" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_psp_check" ON "orders" USING btree ("psp_check_at") WHERE "orders"."psp_check_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_order" ON "payment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_created" ON "payment" USING btree ("created_at");