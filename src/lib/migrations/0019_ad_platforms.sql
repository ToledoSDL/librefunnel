ALTER TABLE "conversion" DROP CONSTRAINT "conversion_name";--> statement-breakpoint
ALTER TABLE "integration" DROP CONSTRAINT "integration_kind";--> statement-breakpoint
ALTER TABLE "setting" DROP CONSTRAINT "setting_key";--> statement-breakpoint
ALTER TABLE "touch" DROP CONSTRAINT "touch_click_kind";--> statement-breakpoint
ALTER TABLE "conversion" ADD COLUMN "platform" text DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ttp" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ga_client" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ga_session" text;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "platform" text DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "ttp" text;--> statement-breakpoint
ALTER TABLE "conversion" DROP CONSTRAINT "conversion_order_id_name_pk";--> statement-breakpoint
ALTER TABLE "signal" DROP CONSTRAINT "signal_visitor_id_product_name_pk";--> statement-breakpoint
ALTER TABLE "conversion" ADD CONSTRAINT "conversion_order_id_name_platform_pk" PRIMARY KEY("order_id","name","platform");--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_visitor_id_product_name_platform_pk" PRIMARY KEY("visitor_id","product","name","platform");--> statement-breakpoint
ALTER TABLE "conversion" ADD CONSTRAINT "conversion_platform" CHECK ("conversion"."platform" IN ('meta', 'tiktok', 'analytics', 'googleads'));--> statement-breakpoint
ALTER TABLE "conversion" ADD CONSTRAINT "conversion_name" CHECK ("conversion"."name" IN ('InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Refund'));--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_kind" CHECK ("integration"."kind" IN ('smtp', 'meta', 'tiktok', 'analytics', 'googleads', 'pix', 'mercadopago', 'woovi', 'abacatepay', 'depix', 'noxpay', 'webhook', 'evolution', 'whatsapp', 'storage', 'nfse'));--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_key" CHECK ("setting"."key" IN ('brand', 'owner_email', 'owner_whatsapp', 'terms_url', 'terms_version', 'order_hours', 'logo', 'icon', 'accent', 'support_email', 'support_whatsapp', 'legal_name', 'document', 'privacy_url', 'powered_by', 'description', 'share_image', 'home', 'checkout_phone', 'confirm_email', 'checkout_theme', 'checkout_button', 'checkout_notice', 'checkout_countdown', 'checkout_trust', 'checkout_guarantee', 'checkout_testimonials', 'thanks_url', 'thanks_label', 'google_verification', 'meta_verification'));--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_platform" CHECK ("signal"."platform" IN ('meta', 'tiktok', 'analytics', 'googleads'));--> statement-breakpoint
ALTER TABLE "touch" ADD CONSTRAINT "touch_click_kind" CHECK ("touch"."click_kind" IN ('', 'fbclid', 'gclid', 'ttclid', 'gbraid', 'wbraid'));
