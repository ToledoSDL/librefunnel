CREATE TABLE "contact" (
	"address" text PRIMARY KEY NOT NULL,
	"name" text,
	"photo" text,
	"photo_type" text,
	"photo_checked_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event" DROP CONSTRAINT "event_name";--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_name" CHECK ("event"."name" IN ('page_view', 'video_play', 'video_25', 'video_50', 'video_75', 'video_100', 'cta_view', 'cta_click', 'video_watch'));--> statement-breakpoint
INSERT INTO "contact" ("address", "opted_out_at") SELECT "address", "created_at" FROM "optout";--> statement-breakpoint
DROP TABLE "optout" CASCADE;
