ALTER TYPE "public"."account_wallet_transaction_type" ADD VALUE 'advertisement_budget_return';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'budget_withdrawal' BEFORE 'view_debit';--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" DROP CONSTRAINT "account_wallet_transactions_type_sign";--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" DROP CONSTRAINT "account_wallet_transactions_funding_ad_required";--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" DROP CONSTRAINT "account_wallet_transactions_admin_actor_required";--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_type_sign" CHECK ((
        "account_wallet_transactions"."type"::text in ('legacy_opening_balance', 'admin_credit', 'advertisement_budget_return')
        and "account_wallet_transactions"."amount" > 0
      ) or (
        "account_wallet_transactions"."type"::text = 'advertisement_funding_debit'
        and "account_wallet_transactions"."amount" < 0
      ));--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_funding_ad_required" CHECK ("account_wallet_transactions"."type"::text not in ('advertisement_funding_debit', 'advertisement_budget_return') or "account_wallet_transactions"."advertisement_id" is not null);--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_admin_actor_required" CHECK ("account_wallet_transactions"."type"::text not in ('admin_credit', 'advertisement_budget_return') or "account_wallet_transactions"."actor_account_id" is not null);