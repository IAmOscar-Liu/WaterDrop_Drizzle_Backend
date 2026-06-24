ALTER TABLE "refund_items" ADD COLUMN "coins" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "returnable_coins" double precision;