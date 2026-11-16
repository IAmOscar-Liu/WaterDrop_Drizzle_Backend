-- Preserve every existing variant policy, including inactive variants and explicit NULL/0.
LOCK TABLE "products" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "refund_window_days" integer DEFAULT 8;--> statement-breakpoint
UPDATE "product_variants" AS variant
SET "refund_window_days" = product."refund_window_days"
FROM "products" AS product
WHERE variant."product_id" = product."id";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_refund_window_days_ck" CHECK ("product_variants"."refund_window_days" is null or "product_variants"."refund_window_days" between 0 and 3650000);