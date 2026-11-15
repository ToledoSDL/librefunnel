CREATE TABLE "coupon" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"products" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"once_per_email" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "coupon_kind" CHECK ("coupon"."kind" IN ('percent', 'fixed')),
	CONSTRAINT "coupon_value" CHECK ("coupon"."value" > 0 AND ("coupon"."kind" = 'fixed' OR "coupon"."value" < 100)),
	CONSTRAINT "coupon_max_uses" CHECK ("coupon"."max_uses" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount" integer;--> statement-breakpoint
CREATE INDEX "orders_coupon" ON "orders" USING btree ("coupon","customer_id") WHERE "orders"."coupon" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount" CHECK ("orders"."discount" > 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_pair" CHECK (("orders"."coupon" IS NULL) = ("orders"."discount" IS NULL));