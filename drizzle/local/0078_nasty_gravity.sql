ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."delivery_status";--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'shipped', 'delivered', 'returned', 'cancelled', 'exception', 'unknown');--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_status" USING "status"::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."delivery_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_status" USING "status"::"public"."delivery_status";