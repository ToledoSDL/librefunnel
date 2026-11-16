ALTER TABLE "product" ADD COLUMN "domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "product_domain" ON "product" USING btree ("domain");