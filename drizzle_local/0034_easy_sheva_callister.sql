CREATE TABLE "account_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet_balance" double precision DEFAULT 0 NOT NULL,
	"total_revenue_cash" double precision DEFAULT 0 NOT NULL,
	"total_revenue_coin" double precision DEFAULT 0 NOT NULL,
	"locked_balance" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_wallets_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_wallets" ADD CONSTRAINT "account_wallets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;