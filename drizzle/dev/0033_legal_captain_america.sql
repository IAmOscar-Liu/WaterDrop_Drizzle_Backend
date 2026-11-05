ALTER TABLE "deliveries" ADD COLUMN "fee" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "merchant_trades" ADD COLUMN "shipping_cost" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_cost" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transaction_fee" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transaction_fee_rate_at_sale" double precision;