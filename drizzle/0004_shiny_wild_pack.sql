CREATE TABLE "user_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total_views" integer DEFAULT 0 NOT NULL,
	"treasure_boxes_earned" integer DEFAULT 0 NOT NULL,
	"can_watch_more" boolean DEFAULT true NOT NULL,
	"remaining_views" integer DEFAULT 20 NOT NULL,
	"next_treasure_box_in" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_daily_stats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user_daily_stats" ADD CONSTRAINT "user_daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;