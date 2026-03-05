ALTER TABLE "deliveries" ADD COLUMN "fee_deduction" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_cost_deduction" double precision DEFAULT 0;