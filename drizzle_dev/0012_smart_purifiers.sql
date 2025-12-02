CREATE TYPE "public"."account_status" AS ENUM('active', 'inactive', 'banned');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."account_status";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "status" SET DATA TYPE "public"."account_status" USING "status"::"public"."account_status";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."product_status";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "status" SET DATA TYPE "public"."product_status" USING "status"::"public"."product_status";