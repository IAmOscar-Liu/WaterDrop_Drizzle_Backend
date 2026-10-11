CREATE TABLE "notification_feed_events" (
	"user_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"notification_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "notification_feed_events_user_id_sequence_pk" PRIMARY KEY("user_id","sequence"),
	CONSTRAINT "notification_feed_events_valid_ck" CHECK ("notification_feed_events"."sequence" > 0 and "notification_feed_events"."event_type" in ('notification.created', 'notification.updated', 'notification.deleted', 'stream.reset'))
);
--> statement-breakpoint
CREATE TABLE "notification_user_feeds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"head" bigint DEFAULT 0 NOT NULL,
	"retained_after" bigint DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_user_feeds_sequence_ck" CHECK ("notification_user_feeds"."retained_after" >= 0 and "notification_user_feeds"."head" >= "notification_user_feeds"."retained_after" and "notification_user_feeds"."head" < 9007199254740991 and "notification_user_feeds"."version" > 0 and "notification_user_feeds"."version" < 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "notification_list_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query_key" text NOT NULL,
	"page_size" integer NOT NULL,
	"notification_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_snapshots_page_size_ck" CHECK ("notification_list_snapshots"."page_size" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "user_notifications" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_feed_events" ADD CONSTRAINT "notification_feed_events_user_id_notification_user_feeds_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."notification_user_feeds"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_user_feeds" ADD CONSTRAINT "notification_user_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_list_snapshots" ADD CONSTRAINT "notification_list_snapshots_user_id_notification_user_feeds_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."notification_user_feeds"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_feed_events_retention_idx" ON "notification_feed_events" USING btree ("created_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_snapshots_user_query_uk" ON "notification_list_snapshots" USING btree ("user_id","query_key");--> statement-breakpoint
CREATE INDEX "notification_snapshots_expiry_idx" ON "notification_list_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_notifications_user_history_idx" ON "user_notifications" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "user_notifications"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_version_ck" CHECK ("user_notifications"."version" > 0);