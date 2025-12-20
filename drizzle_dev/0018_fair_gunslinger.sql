ALTER TYPE "public"."order_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'canceled';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reserve" integer DEFAULT 0 NOT NULL;