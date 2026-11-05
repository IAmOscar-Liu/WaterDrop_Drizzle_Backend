CREATE TABLE "chat_feed_events" (
	"user_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"chat_room_id" uuid NOT NULL,
	"access_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "chat_feed_events_user_id_sequence_pk" PRIMARY KEY("user_id","sequence"),
	CONSTRAINT "chat_feed_events_valid_ck" CHECK ("chat_feed_events"."sequence" > 0 and "chat_feed_events"."access_version" > 0 and "chat_feed_events"."event_type" in ('message.created', 'messages.read', 'chatroom.updated', 'chatroom.removed', 'stream.reset'))
);
--> statement-breakpoint
CREATE TABLE "chat_user_feeds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"head" bigint DEFAULT 0 NOT NULL,
	"retained_after" bigint DEFAULT 0 NOT NULL,
	"list_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "chat_user_feeds_sequence_ck" CHECK ("chat_user_feeds"."retained_after" >= 0 and "chat_user_feeds"."head" >= "chat_user_feeds"."retained_after" and "chat_user_feeds"."head" < 9007199254740991 and "chat_user_feeds"."list_version" > 0 and "chat_user_feeds"."list_version" < 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "chat_list_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_size" integer NOT NULL,
	"rooms" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_list_snapshots_page_size_ck" CHECK ("chat_list_snapshots"."page_size" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "client_message_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sender_identity" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_feed_events" ADD CONSTRAINT "chat_feed_events_user_id_chat_user_feeds_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."chat_user_feeds"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_user_feeds" ADD CONSTRAINT "chat_user_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_list_snapshots" ADD CONSTRAINT "chat_list_snapshots_user_id_chat_user_feeds_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."chat_user_feeds"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_feed_events_retention_idx" ON "chat_feed_events" USING btree ("created_at","user_id");--> statement-breakpoint
CREATE INDEX "chat_list_snapshots_user_idx" ON "chat_list_snapshots" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_list_snapshots_expiry_idx" ON "chat_list_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "chat_messages_unread_room_idx" ON "chat_messages" USING btree ("chat_room_id","sender_type") WHERE "chat_messages"."is_read" = false;--> statement-breakpoint
CREATE INDEX "chat_messages_room_history_idx" ON "chat_messages" USING btree ("chat_room_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_client_retry_uk" ON "chat_messages" USING btree ("chat_room_id","sender_identity","client_message_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_version_ck" CHECK ("chat_messages"."version" > 0);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_retry_identity_ck" CHECK ("chat_messages"."client_message_id" is null or ("chat_messages"."sender_identity" is not null and "chat_messages"."request_fingerprint" is not null));--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_version_ck" CHECK ("chat_rooms"."version" > 0 and "chat_rooms"."access_version" > 0);