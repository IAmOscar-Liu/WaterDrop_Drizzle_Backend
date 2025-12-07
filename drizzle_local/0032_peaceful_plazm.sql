CREATE TYPE "public"."advertisement_status" AS ENUM('active', 'paused', 'depleted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('deposit');--> statement-breakpoint
CREATE TABLE "advertisement_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"balance" double precision DEFAULT 0 NOT NULL,
	"total_spent" double precision DEFAULT 0 NOT NULL,
	"status" "advertisement_status" DEFAULT 'paused' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisement_stats_advertisement_id_unique" UNIQUE("advertisement_id")
);
--> statement-breakpoint
CREATE TABLE "advertisement_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"amount" double precision NOT NULL,
	"type" "transaction_type" DEFAULT 'deposit' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertisement_stats" ADD CONSTRAINT "advertisement_stats_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD CONSTRAINT "advertisement_transactions_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertisement_transactions_ad_id_idx" ON "advertisement_transactions" USING btree ("advertisement_id");