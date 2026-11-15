ALTER TABLE "integration" DROP CONSTRAINT "integration_kind";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "crypto_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_kind" CHECK ("integration"."kind" IN ('smtp', 'meta', 'pix', 'mercadopago', 'woovi', 'abacatepay', 'depix', 'noxpay', 'webhook', 'evolution', 'whatsapp', 'storage'));