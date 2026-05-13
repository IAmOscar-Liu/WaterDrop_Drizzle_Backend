ALTER TABLE "user_daily_stat_logs" RENAME COLUMN "user_id" TO "user_daily_stat_id";--> statement-breakpoint
ALTER TABLE "user_daily_stat_logs" DROP CONSTRAINT "user_daily_stat_logs_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "user_daily_stat_logs_stat_id_idx";--> statement-breakpoint
ALTER TABLE "user_daily_stat_logs" ADD CONSTRAINT "user_daily_stat_logs_user_daily_stat_id_user_daily_stats_id_fk" FOREIGN KEY ("user_daily_stat_id") REFERENCES "public"."user_daily_stats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_daily_stat_logs_stat_id_idx" ON "user_daily_stat_logs" USING btree ("user_daily_stat_id");