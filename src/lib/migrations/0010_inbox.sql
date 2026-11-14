ALTER TABLE "message" DROP CONSTRAINT "message_kind";--> statement-breakpoint
CREATE INDEX "orders_phone" ON "orders" USING btree ("phone","created_at");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_kind" CHECK ("message"."kind" IN ('access', 'paid', 'recovery', 'login', 'reply', 'owner', 'inbound', 'manual'));