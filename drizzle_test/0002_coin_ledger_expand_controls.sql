ALTER TABLE "advertisement_coin_funding_accounts" DROP CONSTRAINT "advertisement_coin_funding_accounts_amounts_non_negative_ck";--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ALTER COLUMN "funding_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ALTER COLUMN "advertisement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ALTER COLUMN "source_seller_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisement_assignments" ADD COLUMN "user_local_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisement_assignments" ADD COLUMN "timezone_snapshot" text NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_accounts" ADD COLUMN "seller_funding_available_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ADD COLUMN "legacy_source" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_view_counts_completion_idempotency_key_uk" ON "ad_view_counts" USING btree ("completion_idempotency_key") WHERE "ad_view_counts"."completion_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_assignments_user_advertisement_local_date_uk" ON "advertisement_assignments" USING btree ("user_id","advertisement_id","user_local_date");--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_accounts" ADD CONSTRAINT "advertisement_coin_funding_accounts_amounts_non_negative_ck" CHECK ("advertisement_coin_funding_accounts"."platform_advance_outstanding_amount" >= 0 and
          "advertisement_coin_funding_accounts"."seller_funding_available_amount" >= 0 and
          "advertisement_coin_funding_accounts"."platform_funded_consumed_amount" >= 0 and
          "advertisement_coin_funding_accounts"."platform_promotional_expense_amount" >= 0 and
          "advertisement_coin_funding_accounts"."coin_to_currency_rate" > 0);