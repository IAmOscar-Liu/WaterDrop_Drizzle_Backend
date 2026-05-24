CREATE TYPE "public"."idempotency_key_status" AS ENUM('started', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"request_path" text NOT NULL,
	"request_data" jsonb NOT NULL,
	"response_data" jsonb,
	"status" "idempotency_key_status" DEFAULT 'started' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_unique" UNIQUE("key")
);
