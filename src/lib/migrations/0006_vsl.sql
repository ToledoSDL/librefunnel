CREATE TABLE "retention" (
	"product" text NOT NULL,
	"second" integer NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "retention_product_second_pk" PRIMARY KEY("product","second"),
	CONSTRAINT "retention_second" CHECK ("retention"."second" BETWEEN 0 AND 7200)
);
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "player_speed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "captions" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "triggers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "bar_text" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "bar_color" text;--> statement-breakpoint
ALTER TABLE "retention" ADD CONSTRAINT "retention_product_product_slug_fk" FOREIGN KEY ("product") REFERENCES "public"."product"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_triggers" CHECK (jsonb_typeof("product"."triggers") = 'array');