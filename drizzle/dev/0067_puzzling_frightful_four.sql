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
ALTER TABLE "user_badge_states" ADD CONSTRAINT "user_badge_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge_work" ADD CONSTRAINT "user_badge_work_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_badge_due_idx" ON "user_badge_states" USING btree ("next_reconcile_at");--> statement-breakpoint
CREATE INDEX "user_badge_retry_idx" ON "user_badge_states" USING btree ("retry_at");--> statement-breakpoint
CREATE INDEX "user_badge_work_user_idx" ON "user_badge_work" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "treasure_boxes_badge_user_idx" ON "treasure_boxes" USING btree ("user_id") WHERE "treasure_boxes"."is_active" = true and "treasure_boxes"."is_opened" = false;