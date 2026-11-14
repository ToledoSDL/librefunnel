CREATE TABLE "integration" (
	"kind" text PRIMARY KEY NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "integration_kind" CHECK ("integration"."kind" IN ('smtp', 'meta', 'pix', 'mercadopago', 'woovi', 'abacatepay', 'webhook', 'evolution')),
	CONSTRAINT "integration_fields" CHECK (jsonb_typeof("integration"."fields") = 'object'),
	CONSTRAINT "integration_secrets" CHECK (jsonb_typeof("integration"."secrets") = 'object')
);
