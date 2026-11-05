ALTER TYPE "public"."refund_status" ADD VALUE 'rejected' BEFORE 'pending';--> statement-breakpoint
CREATE TABLE "user_badge_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"claimable_unopened_boxes" integer DEFAULT 0 NOT NULL,
	"unread_notifications" integer DEFAULT 0 NOT NULL,
	"unread_chat_messages" integer DEFAULT 0 NOT NULL,
	"next_reconcile_at" timestamp with time zone,
	"last_sent_version" bigint DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_badge_counts_ck" CHECK ("user_badge_states"."claimable_unopened_boxes" >= 0 and "user_badge_states"."unread_notifications" >= 0 and "user_badge_states"."unread_chat_messages" >= 0),
	CONSTRAINT "user_badge_version_ck" CHECK ("user_badge_states"."version" >= 0 and "user_badge_states"."version" < 9007199254740991 and "user_badge_states"."last_sent_version" >= 0 and "user_badge_states"."last_sent_version" <= "user_badge_states"."version" and "user_badge_states"."failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_badge_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"force_delivery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "user_badge_states" ADD CONSTRAINT "user_badge_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge_work" ADD CONSTRAINT "user_badge_work_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_badge_due_idx" ON "user_badge_states" USING btree ("next_reconcile_at");--> statement-breakpoint
CREATE INDEX "user_badge_retry_idx" ON "user_badge_states" USING btree ("retry_at");--> statement-breakpoint
CREATE INDEX "user_badge_work_user_idx" ON "user_badge_work" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_rejected_by_accounts_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_logs" ADD CONSTRAINT "refund_logs_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_items_item_client_request_uk" ON "refund_items" USING btree ("order_item_id","client_request_id");--> statement-breakpoint
CREATE INDEX "treasure_boxes_badge_user_idx" ON "treasure_boxes" USING btree ("user_id") WHERE "treasure_boxes"."is_active" = true and "treasure_boxes"."is_opened" = false;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_window_ck" CHECK ((
      "order_items"."refund_window_starts_at" is null and "order_items"."original_refund_deadline_at" is null and "order_items"."refund_deadline_at" is null
    ) or (
      "order_items"."refund_window_starts_at" is not null and "order_items"."original_refund_deadline_at" is not null and "order_items"."refund_deadline_at" is not null
      and "order_items"."original_refund_deadline_at" > "order_items"."refund_window_starts_at" and "order_items"."refund_deadline_at" >= "order_items"."original_refund_deadline_at"
    ));