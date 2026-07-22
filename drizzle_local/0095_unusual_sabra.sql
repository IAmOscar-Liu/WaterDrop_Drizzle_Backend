ALTER TABLE "refund_items" ADD COLUMN "paid_refund_amount" double precision;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "extra_refund_amount" double precision DEFAULT 0 NOT NULL;