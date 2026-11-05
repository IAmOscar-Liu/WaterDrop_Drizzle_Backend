CREATE TYPE "public"."advertisement_assignment_status" AS ENUM('issued', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."coin_funder_type" AS ENUM('seller', 'platform');--> statement-breakpoint
CREATE TYPE "public"."coin_funding_account_status" AS ENUM('active', 'closing', 'closed', 'exception');--> statement-breakpoint
CREATE TYPE "public"."coin_funding_transaction_type" AS ENUM('view_funded', 'reward_acquired_seller_funded', 'platform_advance_created', 'platform_advance_repaid', 'funding_source_reclassified', 'platform_advance_cancelled_expiry', 'platform_advance_written_off_archive', 'coin_consumed', 'coin_consumption_reversed', 'seller_surplus_returned', 'seller_unused_returned', 'seller_refund_after_expiry_returned', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."coin_ledger_run_status" AS ENUM('started', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."coin_settlement_cohort_status" AS ENUM('open', 'settling', 'settled', 'exception');--> statement-breakpoint
CREATE TYPE "public"."coin_transaction_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."seller_coin_return_reason" AS ENUM('unacquired_surplus', 'expired_unused', 'refund_after_expiry', 'manual');--> statement-breakpoint
CREATE TYPE "public"."treasure_box_accounting_status" AS ENUM('claimable', 'acquired', 'unacquired', 'zero_reward');--> statement-breakpoint
CREATE TYPE "public"."treasure_box_reward_allocation_status" AS ENUM('demand', 'acquired', 'unacquired');--> statement-breakpoint
CREATE TYPE "public"."treasure_box_reward_cycle_status" AS ENUM('collecting', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_coin_lot_status" AS ENUM('active', 'consumed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_coin_transaction_type" AS ENUM('acquire', 'reserve', 'spend', 'reversal', 'refund', 'cash_refund_conversion', 'expiry', 'manual');--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'view_debit';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'seller_return_credit';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'balance_transfer_out';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'balance_transfer_in';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'manual_adjustment';--> statement-breakpoint
CREATE TABLE "advertisement_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"source_seller_id" uuid NOT NULL,
	"assignment_batch_id" uuid NOT NULL,
	"user_local_date" date NOT NULL,
	"timezone_snapshot" text NOT NULL,
	"assignment_token_hash" text,
	"status" "advertisement_assignment_status" DEFAULT 'issued' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_idempotency_key" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertisement_balance_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_advertisement_id" uuid NOT NULL,
	"destination_advertisement_id" uuid NOT NULL,
	"source_seller_id" uuid NOT NULL,
	"coin_amount" numeric(18, 2) NOT NULL,
	"coin_to_currency_rate" numeric(18, 6) NOT NULL,
	"currency_amount" numeric(18, 2) NOT NULL,
	"source_balance_before" numeric(18, 2) NOT NULL,
	"source_balance_after" numeric(18, 2) NOT NULL,
	"destination_balance_before" numeric(18, 2) NOT NULL,
	"destination_balance_after" numeric(18, 2) NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisement_balance_transfers_different_ads_ck" CHECK ("advertisement_balance_transfers"."source_advertisement_id" <> "advertisement_balance_transfers"."destination_advertisement_id"),
	CONSTRAINT "advertisement_balance_transfers_amounts_positive_ck" CHECK ("advertisement_balance_transfers"."coin_amount" > 0 and
          "advertisement_balance_transfers"."coin_to_currency_rate" > 0 and
          "advertisement_balance_transfers"."currency_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "advertisement_coin_funding_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"source_seller_id" uuid NOT NULL,
	"coin_to_currency_rate" numeric(18, 6) DEFAULT '10' NOT NULL,
	"seller_funding_available_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"platform_advance_outstanding_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"platform_funded_consumed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"platform_promotional_expense_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "coin_funding_account_status" DEFAULT 'active' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisement_coin_funding_accounts_amounts_non_negative_ck" CHECK ("advertisement_coin_funding_accounts"."platform_advance_outstanding_amount" >= 0 and
          "advertisement_coin_funding_accounts"."seller_funding_available_amount" >= 0 and
          "advertisement_coin_funding_accounts"."platform_funded_consumed_amount" >= 0 and
          "advertisement_coin_funding_accounts"."platform_promotional_expense_amount" >= 0 and
          "advertisement_coin_funding_accounts"."coin_to_currency_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "advertisement_coin_funding_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"settlement_cohort_id" uuid,
	"type" "coin_funding_transaction_type" NOT NULL,
	"coin_amount" numeric(18, 2) NOT NULL,
	"currency_equivalent" numeric(18, 2),
	"coin_to_currency_rate" numeric(18, 6) NOT NULL,
	"ad_view_count_id" uuid,
	"treasure_box_reward_allocation_id" uuid,
	"user_coin_lot_id" uuid,
	"seller_return_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisement_coin_funding_transactions_amount_positive_ck" CHECK ("advertisement_coin_funding_transactions"."coin_amount" > 0 and "advertisement_coin_funding_transactions"."coin_to_currency_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "advertisement_coin_settlement_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"claim_settlement_at" timestamp with time zone,
	"opening_platform_advance_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"seller_funded_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"acquired_reward_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"advance_created_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"advance_repaid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"advance_cancelled_at_expiry_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"seller_surplus_returned_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"closing_platform_advance_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "coin_settlement_cohort_status" DEFAULT 'open' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisement_coin_settlement_cohorts_amounts_non_negative_ck" CHECK ("advertisement_coin_settlement_cohorts"."opening_platform_advance_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."seller_funded_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."acquired_reward_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."advance_created_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."advance_repaid_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."advance_cancelled_at_expiry_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."seller_surplus_returned_amount" >= 0 and
          "advertisement_coin_settlement_cohorts"."closing_platform_advance_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coin_ledger_backfill_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"checkpoint" text,
	"status" "coin_ledger_run_status" DEFAULT 'started' NOT NULL,
	"metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_ledger_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"scope_key" text NOT NULL,
	"status" "coin_ledger_run_status" DEFAULT 'started' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_coin_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"allocated_amount" numeric(18, 2) NOT NULL,
	"reserved_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"consumed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reversed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_coin_allocations_amounts_ck" CHECK ("order_coin_allocations"."allocated_amount" >= 0 and
          "order_coin_allocations"."reserved_amount" >= 0 and
          "order_coin_allocations"."consumed_amount" >= 0 and
          "order_coin_allocations"."reversed_amount" >= 0 and
          "order_coin_allocations"."reserved_amount" + "order_coin_allocations"."consumed_amount" <= "order_coin_allocations"."allocated_amount" and
          "order_coin_allocations"."reversed_amount" <= "order_coin_allocations"."consumed_amount")
);
--> statement-breakpoint
CREATE TABLE "product_seller_coin_return_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_seller_id" uuid NOT NULL,
	"source_refund_id" uuid NOT NULL,
	"user_coin_lot_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"coin_amount" numeric(18, 2) NOT NULL,
	"coin_to_currency_rate" numeric(18, 6) DEFAULT '10' NOT NULL,
	"currency_equivalent" numeric(18, 2) NOT NULL,
	"destination_type" text DEFAULT 'product_seller_refund_credit' NOT NULL,
	"destination_reference_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_seller_coin_returns_amounts_positive_ck" CHECK ("product_seller_coin_return_transactions"."coin_amount" > 0 and
          "product_seller_coin_return_transactions"."coin_to_currency_rate" > 0 and
          "product_seller_coin_return_transactions"."currency_equivalent" > 0)
);
--> statement-breakpoint
CREATE TABLE "seller_coin_return_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_seller_id" uuid NOT NULL,
	"advertisement_id" uuid NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"settlement_cohort_id" uuid,
	"reward_allocation_id" uuid,
	"user_coin_lot_id" uuid,
	"reason" "seller_coin_return_reason" NOT NULL,
	"coin_amount" numeric(18, 2) NOT NULL,
	"coin_to_currency_rate" numeric(18, 6) NOT NULL,
	"currency_equivalent" numeric(18, 2) NOT NULL,
	"destination_type" text DEFAULT 'advertisement_balance' NOT NULL,
	"destination_reference_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_coin_return_transactions_amounts_positive_ck" CHECK ("seller_coin_return_transactions"."coin_amount" > 0 and
          "seller_coin_return_transactions"."coin_to_currency_rate" > 0 and
          "seller_coin_return_transactions"."currency_equivalent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treasure_box_reward_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treasure_box_id" uuid NOT NULL,
	"funding_account_id" uuid,
	"settlement_cohort_id" uuid,
	"advertisement_id" uuid,
	"source_seller_id" uuid,
	"legacy_source" text,
	"attributed_coin_amount" numeric(18, 2) NOT NULL,
	"acquired_coin_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"seller_funded_coin_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"platform_advanced_coin_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"platform_repaid_coin_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "treasure_box_reward_allocation_status" DEFAULT 'demand' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acquired_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasure_box_reward_allocations_amounts_non_negative_ck" CHECK ("treasure_box_reward_allocations"."attributed_coin_amount" >= 0 and
          "treasure_box_reward_allocations"."acquired_coin_amount" >= 0 and
          "treasure_box_reward_allocations"."seller_funded_coin_amount" >= 0 and
          "treasure_box_reward_allocations"."platform_advanced_coin_amount" >= 0 and
          "treasure_box_reward_allocations"."platform_repaid_coin_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treasure_box_reward_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "treasure_box_reward_cycle_status" DEFAULT 'collecting' NOT NULL,
	"required_view_count" integer DEFAULT 2 NOT NULL,
	"completed_view_count" integer DEFAULT 0 NOT NULL,
	"accounting_business_date" date NOT NULL,
	"user_local_date" date NOT NULL,
	"timezone_snapshot" text NOT NULL,
	"claim_deadline_at" timestamp with time zone,
	"treasure_box_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasure_box_reward_cycles_view_counts_ck" CHECK ("treasure_box_reward_cycles"."required_view_count" > 0 and
          "treasure_box_reward_cycles"."completed_view_count" >= 0 and
          "treasure_box_reward_cycles"."completed_view_count" <= "treasure_box_reward_cycles"."required_view_count")
);
--> statement-breakpoint
CREATE TABLE "user_coin_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reward_allocation_id" uuid,
	"funding_account_id" uuid,
	"advertisement_id" uuid,
	"source_seller_id" uuid,
	"source_refund_id" uuid,
	"legacy_source" text,
	"current_funder_type" "coin_funder_type" NOT NULL,
	"original_amount" numeric(18, 2) NOT NULL,
	"available_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reserved_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"consumed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"expired_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"returned_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"timezone_snapshot" text NOT NULL,
	"earning_local_month" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "user_coin_lot_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_coin_lots_amounts_non_negative_ck" CHECK ("user_coin_lots"."original_amount" >= 0 and
          "user_coin_lots"."available_amount" >= 0 and
          "user_coin_lots"."reserved_amount" >= 0 and
          "user_coin_lots"."consumed_amount" >= 0 and
          "user_coin_lots"."expired_amount" >= 0 and
          "user_coin_lots"."returned_amount" >= 0),
	CONSTRAINT "user_coin_lots_amount_control_ck" CHECK ("user_coin_lots"."original_amount" = "user_coin_lots"."available_amount" + "user_coin_lots"."reserved_amount" +
          "user_coin_lots"."consumed_amount" + "user_coin_lots"."expired_amount" + "user_coin_lots"."returned_amount")
);
--> statement-breakpoint
CREATE TABLE "user_coin_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lot_id" uuid,
	"type" "user_coin_transaction_type" NOT NULL,
	"direction" "coin_transaction_direction" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"order_id" uuid,
	"refund_id" uuid,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_coin_transactions_amount_positive_ck" CHECK ("user_coin_transactions"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "advertisements" DROP CONSTRAINT "advertisements_product_id_unique";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_coin" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "reward_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "funding_account_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "settlement_cohort_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "advertisement_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "view_charge_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "funded_coin_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "coin_to_currency_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "ad_view_counts" ADD COLUMN "completion_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "advertisement_stats" ADD COLUMN "seller_returned_currency_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisement_stats" ADD COLUMN "returned_coin_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisement_stats" ADD COLUMN "net_settled_spent_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisements" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "advertisements" ADD COLUMN "archive_grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "advertisements" ADD COLUMN "financially_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "advertisements" ADD COLUMN "replacement_of_advertisement_id" uuid;--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "coin_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "coin_to_currency_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "source_seller_id" uuid;--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "ad_view_count_id" uuid;--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "balance_before" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "balance_after" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "cash_refund_amount" integer;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "cash_remainder_coins" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "reward_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "accounting_status" "treasure_box_accounting_status";--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "timezone_snapshot" text;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "user_local_date" date;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "local_claim_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "archive_grace_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "claim_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "acquired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "reward_rule_version" text;--> statement-breakpoint
ALTER TABLE "treasure_boxes" ADD COLUMN "reward_input_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "advertisement_assignments" ADD CONSTRAINT "advertisement_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_assignments" ADD CONSTRAINT "advertisement_assignments_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_assignments" ADD CONSTRAINT "advertisement_assignments_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_balance_transfers" ADD CONSTRAINT "advertisement_balance_transfers_source_advertisement_id_advertisements_id_fk" FOREIGN KEY ("source_advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_balance_transfers" ADD CONSTRAINT "advertisement_balance_transfers_destination_advertisement_id_advertisements_id_fk" FOREIGN KEY ("destination_advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_balance_transfers" ADD CONSTRAINT "advertisement_balance_transfers_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_accounts" ADD CONSTRAINT "advertisement_coin_funding_accounts_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_accounts" ADD CONSTRAINT "advertisement_coin_funding_accounts_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_transactions" ADD CONSTRAINT "advertisement_coin_funding_transactions_funding_account_id_advertisement_coin_funding_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."advertisement_coin_funding_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_transactions" ADD CONSTRAINT "advertisement_coin_funding_transactions_settlement_cohort_id_advertisement_coin_settlement_cohorts_id_fk" FOREIGN KEY ("settlement_cohort_id") REFERENCES "public"."advertisement_coin_settlement_cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_transactions" ADD CONSTRAINT "advertisement_coin_funding_transactions_ad_view_count_id_ad_view_counts_id_fk" FOREIGN KEY ("ad_view_count_id") REFERENCES "public"."ad_view_counts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_transactions" ADD CONSTRAINT "advertisement_coin_funding_transactions_treasure_box_reward_allocation_id_treasure_box_reward_allocations_id_fk" FOREIGN KEY ("treasure_box_reward_allocation_id") REFERENCES "public"."treasure_box_reward_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_transactions" ADD CONSTRAINT "advertisement_coin_funding_transactions_user_coin_lot_id_user_coin_lots_id_fk" FOREIGN KEY ("user_coin_lot_id") REFERENCES "public"."user_coin_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_funding_transactions" ADD CONSTRAINT "advertisement_coin_funding_transactions_seller_return_transaction_id_seller_coin_return_transactions_id_fk" FOREIGN KEY ("seller_return_transaction_id") REFERENCES "public"."seller_coin_return_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisement_coin_settlement_cohorts" ADD CONSTRAINT "advertisement_coin_settlement_cohorts_funding_account_id_advertisement_coin_funding_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."advertisement_coin_funding_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_coin_allocations" ADD CONSTRAINT "order_coin_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_coin_allocations" ADD CONSTRAINT "order_coin_allocations_lot_id_user_coin_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."user_coin_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_seller_coin_return_transactions" ADD CONSTRAINT "product_seller_coin_return_transactions_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_seller_coin_return_transactions" ADD CONSTRAINT "product_seller_coin_return_transactions_source_refund_id_refund_items_id_fk" FOREIGN KEY ("source_refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_seller_coin_return_transactions" ADD CONSTRAINT "product_seller_coin_return_transactions_user_coin_lot_id_user_coin_lots_id_fk" FOREIGN KEY ("user_coin_lot_id") REFERENCES "public"."user_coin_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_coin_return_transactions" ADD CONSTRAINT "seller_coin_return_transactions_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_coin_return_transactions" ADD CONSTRAINT "seller_coin_return_transactions_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_coin_return_transactions" ADD CONSTRAINT "seller_coin_return_transactions_funding_account_id_advertisement_coin_funding_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."advertisement_coin_funding_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_coin_return_transactions" ADD CONSTRAINT "seller_coin_return_transactions_settlement_cohort_id_advertisement_coin_settlement_cohorts_id_fk" FOREIGN KEY ("settlement_cohort_id") REFERENCES "public"."advertisement_coin_settlement_cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_coin_return_transactions" ADD CONSTRAINT "seller_coin_return_transactions_reward_allocation_id_treasure_box_reward_allocations_id_fk" FOREIGN KEY ("reward_allocation_id") REFERENCES "public"."treasure_box_reward_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_coin_return_transactions" ADD CONSTRAINT "seller_coin_return_transactions_user_coin_lot_id_user_coin_lots_id_fk" FOREIGN KEY ("user_coin_lot_id") REFERENCES "public"."user_coin_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ADD CONSTRAINT "treasure_box_reward_allocations_treasure_box_id_treasure_boxes_id_fk" FOREIGN KEY ("treasure_box_id") REFERENCES "public"."treasure_boxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ADD CONSTRAINT "treasure_box_reward_allocations_funding_account_id_advertisement_coin_funding_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."advertisement_coin_funding_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ADD CONSTRAINT "treasure_box_reward_allocations_settlement_cohort_id_advertisement_coin_settlement_cohorts_id_fk" FOREIGN KEY ("settlement_cohort_id") REFERENCES "public"."advertisement_coin_settlement_cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ADD CONSTRAINT "treasure_box_reward_allocations_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_allocations" ADD CONSTRAINT "treasure_box_reward_allocations_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_cycles" ADD CONSTRAINT "treasure_box_reward_cycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasure_box_reward_cycles" ADD CONSTRAINT "treasure_box_reward_cycles_treasure_box_id_treasure_boxes_id_fk" FOREIGN KEY ("treasure_box_id") REFERENCES "public"."treasure_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_reward_allocation_id_treasure_box_reward_allocations_id_fk" FOREIGN KEY ("reward_allocation_id") REFERENCES "public"."treasure_box_reward_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_funding_account_id_advertisement_coin_funding_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."advertisement_coin_funding_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_source_refund_id_refund_items_id_fk" FOREIGN KEY ("source_refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_transactions" ADD CONSTRAINT "user_coin_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_transactions" ADD CONSTRAINT "user_coin_transactions_lot_id_user_coin_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."user_coin_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_transactions" ADD CONSTRAINT "user_coin_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_coin_transactions" ADD CONSTRAINT "user_coin_transactions_refund_id_refund_items_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_assignments_batch_user_advertisement_uk" ON "advertisement_assignments" USING btree ("assignment_batch_id","user_id","advertisement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_assignments_user_advertisement_local_date_uk" ON "advertisement_assignments" USING btree ("user_id","advertisement_id","user_local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_assignments_completion_idempotency_uk" ON "advertisement_assignments" USING btree ("completion_idempotency_key") WHERE "advertisement_assignments"."completion_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "advertisement_assignments_user_advertisement_status_idx" ON "advertisement_assignments" USING btree ("user_id","advertisement_id","status","assigned_at");--> statement-breakpoint
CREATE INDEX "advertisement_assignments_status_local_date_idx" ON "advertisement_assignments" USING btree ("status","user_local_date");--> statement-breakpoint
CREATE INDEX "advertisement_assignments_status_completed_at_idx" ON "advertisement_assignments" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "advertisement_assignments_status_updated_at_idx" ON "advertisement_assignments" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_balance_transfers_idempotency_key_uk" ON "advertisement_balance_transfers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "advertisement_balance_transfers_source_created_at_idx" ON "advertisement_balance_transfers" USING btree ("source_advertisement_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_coin_funding_accounts_advertisement_id_uk" ON "advertisement_coin_funding_accounts" USING btree ("advertisement_id");--> statement-breakpoint
CREATE INDEX "advertisement_coin_funding_accounts_outstanding_advance_idx" ON "advertisement_coin_funding_accounts" USING btree ("status","platform_advance_outstanding_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_coin_funding_transactions_idempotency_key_uk" ON "advertisement_coin_funding_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "advertisement_coin_funding_transactions_account_created_at_idx" ON "advertisement_coin_funding_transactions" USING btree ("funding_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_coin_settlement_cohorts_account_date_uk" ON "advertisement_coin_settlement_cohorts" USING btree ("funding_account_id","business_date");--> statement-breakpoint
CREATE INDEX "advertisement_coin_settlement_cohorts_status_claim_at_idx" ON "advertisement_coin_settlement_cohorts" USING btree ("status","claim_settlement_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_ledger_backfill_checkpoints_name_uk" ON "coin_ledger_backfill_checkpoints" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_ledger_job_runs_job_scope_uk" ON "coin_ledger_job_runs" USING btree ("job_name","scope_key");--> statement-breakpoint
CREATE INDEX "coin_ledger_job_runs_status_scheduled_for_idx" ON "coin_ledger_job_runs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "coin_ledger_job_runs_scheduled_for_idx" ON "coin_ledger_job_runs" USING btree ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "order_coin_allocations_order_lot_uk" ON "order_coin_allocations" USING btree ("order_id","lot_id");--> statement-breakpoint
CREATE INDEX "order_coin_allocations_lot_idx" ON "order_coin_allocations" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_seller_coin_returns_idempotency_key_uk" ON "product_seller_coin_return_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "product_seller_coin_returns_seller_created_at_idx" ON "product_seller_coin_return_transactions" USING btree ("source_seller_id","created_at");--> statement-breakpoint
CREATE INDEX "product_seller_coin_returns_refund_id_idx" ON "product_seller_coin_return_transactions" USING btree ("source_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_coin_return_transactions_idempotency_key_uk" ON "seller_coin_return_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "seller_coin_return_transactions_seller_created_at_idx" ON "seller_coin_return_transactions" USING btree ("source_seller_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treasure_box_reward_allocations_box_advertisement_uk" ON "treasure_box_reward_allocations" USING btree ("treasure_box_id","advertisement_id");--> statement-breakpoint
CREATE INDEX "treasure_box_reward_allocations_account_status_idx" ON "treasure_box_reward_allocations" USING btree ("funding_account_id","status");--> statement-breakpoint
CREATE INDEX "treasure_box_reward_cycles_user_status_local_date_idx" ON "treasure_box_reward_cycles" USING btree ("user_id","status","user_local_date");--> statement-breakpoint
CREATE INDEX "user_coin_lots_user_spend_order_idx" ON "user_coin_lots" USING btree ("user_id","status","expires_at","created_at");--> statement-breakpoint
CREATE INDEX "user_coin_lots_source_advertisement_idx" ON "user_coin_lots" USING btree ("advertisement_id","current_funder_type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_coin_lots_source_refund_id_uk" ON "user_coin_lots" USING btree ("source_refund_id") WHERE "user_coin_lots"."source_refund_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_coin_transactions_idempotency_key_uk" ON "user_coin_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "user_coin_transactions_user_created_at_idx" ON "user_coin_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD CONSTRAINT "advertisement_transactions_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_view_counts_completion_idempotency_key_uk" ON "ad_view_counts" USING btree ("completion_idempotency_key") WHERE "ad_view_counts"."completion_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_transactions_idempotency_key_uk" ON "advertisement_transactions" USING btree ("idempotency_key") WHERE "advertisement_transactions"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "device_tokens_last_used_at_idx" ON "device_tokens" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_updated_at_idx" ON "idempotency_keys" USING btree ("updated_at");