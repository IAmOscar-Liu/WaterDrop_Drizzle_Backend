ALTER TABLE "treasure_boxes" ALTER COLUMN "coins_awarded" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "coins" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "user_daily_stats" ADD COLUMN "group_treasure_boxes" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "group_treasure_boxes";