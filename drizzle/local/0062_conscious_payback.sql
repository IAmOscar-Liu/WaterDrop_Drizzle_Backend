ALTER TABLE "deliveries" ADD COLUMN "tax_amount" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_cost" double precision DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_amount" double precision DEFAULT 0;