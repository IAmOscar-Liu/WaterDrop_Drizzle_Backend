ALTER TABLE "accounts" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "cvs_store_info" jsonb;--> statement-breakpoint
ALTER TABLE "merchant_trades" ADD COLUMN "cvs_store_info" jsonb;--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "receiver_store_id";