ALTER TABLE "treasure_boxes" ALTER COLUMN "coins_awarded" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "coins" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_daily_stats" ADD COLUMN "group_ad_views_count_yesterday" integer DEFAULT 20;