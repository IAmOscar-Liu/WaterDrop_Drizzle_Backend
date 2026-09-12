ALTER TYPE "public"."user_coin_transaction_type" ADD VALUE 'cash_refund_conversion' BEFORE 'expiry';--> statement-breakpoint
CREATE TABLE "product_seller_coin_return_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_seller_id" uuid NOT NULL,
	"source_refund_id" uuid NOT NULL,
	"user_coin_lot_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"coin_amount" numeric(18, 2) NOT NULL,
	"coin_to_currency_rate" numeric(18, 6) DEFAULT '10' NOT NULL,
	"currency_equivalent" numeric(18, 2) NOT NULL,
	"destination_type" text DEFAULT 'product_seller_refund_credit' NOT NULL,
	"destination_reference_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_seller_coin_returns_amounts_positive_ck" CHECK ("product_seller_coin_return_transactions"."coin_amount" > 0 and
          "product_seller_coin_return_transactions"."coin_to_currency_rate" > 0 and
          "product_seller_coin_return_transactions"."currency_equivalent" > 0)
);
--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "cash_refund_amount" integer;--> statement-breakpoint
ALTER TABLE "refund_items" ADD COLUMN "cash_remainder_coins" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD COLUMN "source_refund_id" uuid;--> statement-breakpoint
ALTER TABLE "product_seller_coin_return_transactions" ADD CONSTRAINT "product_seller_coin_return_transactions_source_seller_id_accounts_id_fk" FOREIGN KEY ("source_seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_seller_coin_return_transactions" ADD CONSTRAINT "product_seller_coin_return_transactions_source_refund_id_refund_items_id_fk" FOREIGN KEY ("source_refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_seller_coin_return_transactions" ADD CONSTRAINT "product_seller_coin_return_transactions_user_coin_lot_id_user_coin_lots_id_fk" FOREIGN KEY ("user_coin_lot_id") REFERENCES "public"."user_coin_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_seller_coin_returns_idempotency_key_uk" ON "product_seller_coin_return_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "product_seller_coin_returns_seller_created_at_idx" ON "product_seller_coin_return_transactions" USING btree ("source_seller_id","created_at");--> statement-breakpoint
CREATE INDEX "product_seller_coin_returns_refund_id_idx" ON "product_seller_coin_return_transactions" USING btree ("source_refund_id");--> statement-breakpoint
ALTER TABLE "user_coin_lots" ADD CONSTRAINT "user_coin_lots_source_refund_id_refund_items_id_fk" FOREIGN KEY ("source_refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_coin_lots_source_refund_id_uk" ON "user_coin_lots" USING btree ("source_refund_id") WHERE "user_coin_lots"."source_refund_id" is not null;