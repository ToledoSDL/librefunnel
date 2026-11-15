CREATE TABLE "signal" (
	"visitor_id" text NOT NULL,
	"product" text NOT NULL,
	"name" text NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text NOT NULL,
	"fbp" text,
	"fbc" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "signal_visitor_id_product_name_pk" PRIMARY KEY("visitor_id","product","name"),
	CONSTRAINT "signal_name" CHECK ("signal"."name" IN ('ViewContent', 'InitiateCheckout')),
	CONSTRAINT "signal_status" CHECK ("signal"."status" IN ('queued', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "conversion" DROP CONSTRAINT "conversion_name";--> statement-breakpoint
ALTER TABLE "event" DROP CONSTRAINT "event_name";--> statement-breakpoint
CREATE INDEX "signal_due" ON "signal" USING btree ("next_at") WHERE "signal"."status" = 'queued';--> statement-breakpoint
ALTER TABLE "conversion" ADD CONSTRAINT "conversion_name" CHECK ("conversion"."name" IN ('InitiateCheckout', 'AddPaymentInfo', 'Purchase'));--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_name" CHECK ("event"."name" IN ('page_view', 'video_play', 'video_25', 'video_50', 'video_75', 'video_100', 'cta_view', 'cta_click', 'video_watch', 'checkout_view', 'store_click', 'video_unmute', 'checkout_start', 'bump_add', 'pix_view', 'pix_copy', 'member_access'));