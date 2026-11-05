ALTER TYPE "public"."refund_status" ADD VALUE 'rejected' BEFORE 'pending';--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "receipt_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "refund_window_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "original_refund_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "refund_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "original_request" jsonb;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "rejection_deadline_before" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "rejection_deadline_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund_logs" ADD COLUMN "actor_account_id" uuid;--> statement-breakpoint
ALTER TABLE "refund_logs" ADD COLUMN "audit" jsonb;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_rejected_by_accounts_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_logs" ADD CONSTRAINT "refund_logs_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_items_item_client_request_uk" ON "refund_items" USING btree ("order_item_id","client_request_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_window_ck" CHECK ((
      "order_items"."refund_window_starts_at" is null and "order_items"."original_refund_deadline_at" is null and "order_items"."refund_deadline_at" is null
    ) or (
      "order_items"."refund_window_starts_at" is not null and "order_items"."original_refund_deadline_at" is not null and "order_items"."refund_deadline_at" is not null
      and "order_items"."original_refund_deadline_at" > "order_items"."refund_window_starts_at" and "order_items"."refund_deadline_at" >= "order_items"."original_refund_deadline_at"
    ));