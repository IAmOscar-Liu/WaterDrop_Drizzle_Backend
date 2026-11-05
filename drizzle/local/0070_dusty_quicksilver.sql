ALTER TABLE "orders" RENAME COLUMN "tax_amount" TO "transaction_fee";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "tax_rate_at_sale" TO "transaction_fee_rate_at_sale";