ALTER TABLE "order_items" RENAME COLUMN "refund_window_days_at_sale" TO "refund_window_hours_at_sale";--> statement-breakpoint
ALTER TABLE "product_variants" RENAME COLUMN "refund_window_days" TO "refund_window_hours";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_refund_window_days_ck";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_refund_window_ck";--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_refund_window_days_ck";--> statement-breakpoint
-- Renaming a column does not convert its unit or guarantee a generated default change.
ALTER TABLE "order_items" ALTER COLUMN "refund_window_hours_at_sale" SET DEFAULT 192;--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "refund_window_hours" SET DEFAULT 192;--> statement-breakpoint
UPDATE "order_items" SET "refund_window_hours_at_sale" = "refund_window_hours_at_sale" * 24;--> statement-breakpoint
UPDATE "product_variants" SET "refund_window_hours" = "refund_window_hours" * 24;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_window_hours_ck" CHECK ("order_items"."refund_window_hours_at_sale" is null or "order_items"."refund_window_hours_at_sale" between 0 and 87600000);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_window_ck" CHECK ((
      "order_items"."refund_window_starts_at" is null and "order_items"."original_refund_deadline_at" is null and "order_items"."refund_deadline_at" is null
    ) or (
      "order_items"."refund_window_starts_at" is not null and (
        (("order_items"."refund_window_hours_at_sale" is null or "order_items"."refund_window_hours_at_sale" = 0)
          and "order_items"."original_refund_deadline_at" is null and "order_items"."refund_deadline_at" is null)
        or ("order_items"."refund_window_hours_at_sale" is not null and "order_items"."refund_window_hours_at_sale" > 0 and "order_items"."original_refund_deadline_at" is not null and "order_items"."refund_deadline_at" is not null
          and "order_items"."original_refund_deadline_at" > "order_items"."refund_window_starts_at" and "order_items"."refund_deadline_at" >= "order_items"."original_refund_deadline_at")
      )
    ));--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_refund_window_hours_ck" CHECK ("product_variants"."refund_window_hours" is null or "product_variants"."refund_window_hours" between 0 and 87600000);