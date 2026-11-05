ALTER TABLE "orders" DROP CONSTRAINT "orders_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "total_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "account_id";