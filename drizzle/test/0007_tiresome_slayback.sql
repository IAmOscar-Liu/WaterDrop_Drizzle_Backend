CREATE TYPE "public"."account_wallet_transaction_type" AS ENUM('legacy_opening_balance', 'admin_credit', 'advertisement_funding_debit');--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'wallet_funding' BEFORE 'view_debit';--> statement-breakpoint
CREATE TABLE "account_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"wallet_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_account_id" uuid,
	"advertisement_id" uuid,
	"type" "account_wallet_transaction_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"external_reference" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_wallet_transactions_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "account_wallet_transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "account_wallet_transactions_amount_nonzero" CHECK ("account_wallet_transactions"."amount" <> 0),
	CONSTRAINT "account_wallet_transactions_before_nonnegative" CHECK ("account_wallet_transactions"."balance_before" >= 0),
	CONSTRAINT "account_wallet_transactions_after_nonnegative" CHECK ("account_wallet_transactions"."balance_after" >= 0),
	CONSTRAINT "account_wallet_transactions_balance_math" CHECK ("account_wallet_transactions"."balance_after" = "account_wallet_transactions"."balance_before" + "account_wallet_transactions"."amount"),
	CONSTRAINT "account_wallet_transactions_type_sign" CHECK ((
        "account_wallet_transactions"."type" in ('legacy_opening_balance', 'admin_credit')
        and "account_wallet_transactions"."amount" > 0
      ) or (
        "account_wallet_transactions"."type" = 'advertisement_funding_debit'
        and "account_wallet_transactions"."amount" < 0
      )),
	CONSTRAINT "account_wallet_transactions_funding_ad_required" CHECK ("account_wallet_transactions"."type" <> 'advertisement_funding_debit' or "account_wallet_transactions"."advertisement_id" is not null),
	CONSTRAINT "account_wallet_transactions_admin_actor_required" CHECK ("account_wallet_transactions"."type" <> 'admin_credit' or "account_wallet_transactions"."actor_account_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "wallet_balance" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "wallet_balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "total_revenue_cash" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "total_revenue_cash" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "total_revenue_coin" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "total_revenue_coin" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "locked_balance" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "account_wallets" ALTER COLUMN "locked_balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD COLUMN "account_wallet_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_wallet_id_account_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."account_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_wallet_transactions_wallet_sequence_idx" ON "account_wallet_transactions" USING btree ("wallet_id","sequence");--> statement-breakpoint
CREATE INDEX "account_wallet_transactions_account_created_idx" ON "account_wallet_transactions" USING btree ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "advertisement_transactions" ADD CONSTRAINT "advertisement_transactions_account_wallet_transaction_id_account_wallet_transactions_id_fk" FOREIGN KEY ("account_wallet_transaction_id") REFERENCES "public"."account_wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisement_transactions_wallet_transaction_uk" ON "advertisement_transactions" USING btree ("account_wallet_transaction_id") WHERE "advertisement_transactions"."account_wallet_transaction_id" is not null;--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_balance_nonnegative" CHECK ("account_wallets"."wallet_balance" >= 0);--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_revenue_cash_nonnegative" CHECK ("account_wallets"."total_revenue_cash" >= 0);--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_revenue_coin_nonnegative" CHECK ("account_wallets"."total_revenue_coin" >= 0);--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_locked_nonnegative" CHECK ("account_wallets"."locked_balance" >= 0);--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_locked_not_above_balance" CHECK ("account_wallets"."locked_balance" <= "account_wallets"."wallet_balance");