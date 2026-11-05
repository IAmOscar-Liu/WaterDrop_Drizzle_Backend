CREATE TABLE "admin_chat_feed_events" (
	"scope" text NOT NULL,
	"sequence" bigint NOT NULL,
	"chat_room_id" uuid NOT NULL,
	"access_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "admin_chat_feed_events_scope_sequence_pk" PRIMARY KEY("scope","sequence"),
	CONSTRAINT "admin_chat_events_valid_ck" CHECK ("admin_chat_feed_events"."sequence" > 0 and "admin_chat_feed_events"."access_version" > 0 and "admin_chat_feed_events"."event_type" in ('message.created', 'messages.read', 'chatroom.updated', 'chatroom.removed', 'stream.reset'))
);
--> statement-breakpoint
CREATE TABLE "admin_chat_feeds" (
	"scope" text PRIMARY KEY NOT NULL,
	"head" bigint DEFAULT 0 NOT NULL,
	"retained_after" bigint DEFAULT 0 NOT NULL,
	"list_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "admin_chat_feeds_sequence_ck" CHECK ("admin_chat_feeds"."retained_after" >= 0 and "admin_chat_feeds"."head" >= "admin_chat_feeds"."retained_after" and "admin_chat_feeds"."head" < 9007199254740991 and "admin_chat_feeds"."list_version" > 0 and "admin_chat_feeds"."list_version" < 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "admin_chat_list_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"query_key" text NOT NULL,
	"page_size" integer NOT NULL,
	"rooms" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_chat_snapshots_page_size_ck" CHECK ("admin_chat_list_snapshots"."page_size" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "admin_chat_feed_events" ADD CONSTRAINT "admin_chat_feed_events_scope_admin_chat_feeds_scope_fk" FOREIGN KEY ("scope") REFERENCES "public"."admin_chat_feeds"("scope") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_chat_list_snapshots" ADD CONSTRAINT "admin_chat_list_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_chat_list_snapshots" ADD CONSTRAINT "admin_chat_list_snapshots_scope_admin_chat_feeds_scope_fk" FOREIGN KEY ("scope") REFERENCES "public"."admin_chat_feeds"("scope") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_chat_events_retention_idx" ON "admin_chat_feed_events" USING btree ("created_at","scope");--> statement-breakpoint
CREATE INDEX "admin_chat_snapshots_account_idx" ON "admin_chat_list_snapshots" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "admin_chat_snapshots_expiry_idx" ON "admin_chat_list_snapshots" USING btree ("expires_at");