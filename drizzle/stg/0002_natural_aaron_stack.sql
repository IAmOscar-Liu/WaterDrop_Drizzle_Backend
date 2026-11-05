CREATE TABLE "user_daily_stat_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_daily_stat_id" uuid NOT NULL,
	"update" jsonb,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_daily_stat_logs" ADD CONSTRAINT "user_daily_stat_logs_user_daily_stat_id_user_daily_stats_id_fk" FOREIGN KEY ("user_daily_stat_id") REFERENCES "public"."user_daily_stats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_daily_stat_logs_stat_id_idx" ON "user_daily_stat_logs" USING btree ("user_daily_stat_id");