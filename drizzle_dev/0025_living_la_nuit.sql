CREATE TYPE "public"."product_type" AS ENUM('normal', 'refrigeration', 'virtual');--> statement-breakpoint
CREATE TABLE "merchant_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_trade_no" text NOT NULL,
	"product_ids" uuid[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_order_id_unique";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "merchant_trade_no" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "logistics_sub_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "home_delivery_data" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "type" "product_type" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "allow_home_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_trades" ADD CONSTRAINT "merchant_trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;