CREATE TABLE "refund_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_item_id" uuid NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund_logs" ADD CONSTRAINT "refund_logs_refund_item_id_refund_items_id_fk" FOREIGN KEY ("refund_item_id") REFERENCES "public"."refund_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_logs_refund_item_id_created_at_idx" ON "refund_logs" USING btree ("refund_item_id","created_at");