CREATE TYPE "public"."order_payment" AS ENUM('Credit', 'ATM');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'payment-processing' BEFORE 'paid';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_payment" "order_payment" DEFAULT 'Credit' NOT NULL;