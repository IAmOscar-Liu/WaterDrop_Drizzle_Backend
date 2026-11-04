ALTER TABLE "order_items" DROP CONSTRAINT "order_items_refund_window_ck";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "refund_window_days_at_sale" integer DEFAULT 10;--> statement-breakpoint
-- Preserve legacy purchases, including those still awaiting receipt.
ALTER TABLE "order_items" ALTER COLUMN "refund_window_days_at_sale" SET DEFAULT 8;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "refund_window_days" integer DEFAULT 8;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_window_days_ck" CHECK ("order_items"."refund_window_days_at_sale" is null or "order_items"."refund_window_days_at_sale" between 0 and 3650000);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_window_ck" CHECK ((
      "order_items"."refund_window_starts_at" is null and "order_items"."original_refund_deadline_at" is null and "order_items"."refund_deadline_at" is null
    ) or (
      "order_items"."refund_window_starts_at" is not null and (
        (("order_items"."refund_window_days_at_sale" is null or "order_items"."refund_window_days_at_sale" = 0)
          and "order_items"."original_refund_deadline_at" is null and "order_items"."refund_deadline_at" is null)
        or ("order_items"."refund_window_days_at_sale" is not null and "order_items"."refund_window_days_at_sale" > 0 and "order_items"."original_refund_deadline_at" is not null and "order_items"."refund_deadline_at" is not null
          and "order_items"."original_refund_deadline_at" > "order_items"."refund_window_starts_at" and "order_items"."refund_deadline_at" >= "order_items"."original_refund_deadline_at")
      )
    ));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_refund_window_days_ck" CHECK ("products"."refund_window_days" is null or "products"."refund_window_days" between 0 and 3650000);