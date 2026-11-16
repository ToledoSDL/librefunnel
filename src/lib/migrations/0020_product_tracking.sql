CREATE TABLE "product_tracking" (
	"product" text NOT NULL,
	"platform" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_tracking_product_platform_pk" PRIMARY KEY("product","platform"),
	CONSTRAINT "product_tracking_platform" CHECK ("product_tracking"."platform" IN ('meta', 'tiktok', 'analytics', 'googleads'))
);
--> statement-breakpoint
ALTER TABLE "product_tracking" ADD CONSTRAINT "product_tracking_product_product_slug_fk" FOREIGN KEY ("product") REFERENCES "public"."product"("slug") ON DELETE no action ON UPDATE no action;