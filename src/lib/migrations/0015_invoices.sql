CREATE TABLE "invoice" (
	"order_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"number" text,
	"key" text,
	"error" text,
	"rejection" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone,
	CONSTRAINT "invoice_number_unique" UNIQUE("number"),
	CONSTRAINT "invoice_key_unique" UNIQUE("key"),
	CONSTRAINT "invoice_status" CHECK ("invoice"."status" IN ('queued', 'issued', 'failed', 'canceled', 'cancel_failed'))
);
--> statement-breakpoint
ALTER TABLE "integration" DROP CONSTRAINT "integration_kind";--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_kind";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "document" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_due" ON "invoice" USING btree ("next_at") WHERE "invoice"."next_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_kind" CHECK ("integration"."kind" IN ('smtp', 'meta', 'pix', 'mercadopago', 'woovi', 'abacatepay', 'depix', 'noxpay', 'webhook', 'evolution', 'whatsapp', 'storage', 'nfse'));--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_kind" CHECK ("message"."kind" IN ('access', 'paid', 'recovery', 'login', 'reply', 'owner', 'inbound', 'manual', 'invoice'));