CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "refund_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"refund_amount" double precision,
	"metadata" jsonb,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_items_order_item_id_idx" ON "refund_items" USING btree ("order_item_id");