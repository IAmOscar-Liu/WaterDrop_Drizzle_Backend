CREATE TYPE "public"."delivery_logistics_type" AS ENUM('CVS', 'home_delivery', 'virtual');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "logistics_type" SET DATA TYPE "public"."delivery_logistics_type" USING "logistics_type"::"public"."delivery_logistics_type";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sub_total" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "user_level_at_sale" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "user_max_discount_at_sale" integer;