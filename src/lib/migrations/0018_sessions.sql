CREATE TABLE "session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"customer_id" text,
	"order_id" text,
	"tag" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_kind" CHECK ("session"."kind" IN ('admin', 'member', 'order'))
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_customer" ON "session" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "session_order" ON "session" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "session_expires" ON "session" USING btree ("expires_at");