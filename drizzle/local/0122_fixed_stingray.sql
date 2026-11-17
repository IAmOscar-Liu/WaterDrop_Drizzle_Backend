ALTER TYPE "public"."account_wallet_transaction_type" ADD VALUE 'seller_deposit';--> statement-breakpoint
ALTER TYPE "public"."account_wallet_transaction_type" ADD VALUE 'seller_withdrawal';--> statement-breakpoint
CREATE TABLE "ad_auto_refills" (
	"advertisement_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"amount" numeric(18, 2) DEFAULT '500' NOT NULL,
	"waiting_since" timestamp with time zone,
	"last_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_auto_refill_amount_check" CHECK ("ad_auto_refills"."amount" >= 100)
);
--> statement-breakpoint
CREATE TABLE "ad_funding_batches" (
	"key" text PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"input" text NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_revenue_accounts" (
	"seller_id" uuid PRIMARY KEY NOT NULL,
	"debt" numeric(24, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "seller_revenue_debt_nonnegative" CHECK ("seller_revenue_accounts"."debt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seller_revenue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"type" text NOT NULL,
	"cash" numeric(24, 6) DEFAULT '0' NOT NULL,
	"coin_value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"gross_cash" numeric(24, 6) DEFAULT '0' NOT NULL,
	"gross_coin_value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"debt_after" numeric(24, 6) NOT NULL,
	"actor_account_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_revenue_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "seller_revenue_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"order_item_id" uuid,
	"cash" numeric(24, 6) DEFAULT '0' NOT NULL,
	"coin_value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"released" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_revenue_lots_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "seller_revenue_lot_balances" CHECK ("seller_revenue_lots"."cash" >= 0 and "seller_revenue_lots"."coin_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seller_sale_snapshots" (
	"order_item_id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"gross_cash" numeric(24, 6) NOT NULL,
	"gross_coin_value" numeric(24, 6) NOT NULL,
	"product_value" numeric(24, 6) NOT NULL,
	"refunded_value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"commission_rate" numeric(6, 4) DEFAULT '0.1' NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_wallet_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_cash" numeric(24, 6) NOT NULL,
	"requested_coins" numeric(24, 6) NOT NULL,
	"cash" numeric(24, 6) NOT NULL,
	"coins" numeric(24, 6) NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"actor_account_id" uuid,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_wallet_requests_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "seller_wallet_request_amounts" CHECK ("seller_wallet_requests"."cash" >= 0 and "seller_wallet_requests"."coins" >= 0 and "seller_wallet_requests"."cash" <= "seller_wallet_requests"."requested_cash" and "seller_wallet_requests"."coins" <= "seller_wallet_requests"."requested_coins")
);
--> statement-breakpoint
ALTER TABLE "ad_auto_refills" ADD CONSTRAINT "ad_auto_refills_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_funding_batches" ADD CONSTRAINT "ad_funding_batches_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_revenue_accounts" ADD CONSTRAINT "seller_revenue_accounts_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_revenue_events" ADD CONSTRAINT "seller_revenue_events_seller_id_seller_revenue_accounts_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_revenue_accounts"("seller_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_revenue_events" ADD CONSTRAINT "seller_revenue_events_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_revenue_lots" ADD CONSTRAINT "seller_revenue_lots_seller_id_seller_revenue_accounts_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_revenue_accounts"("seller_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_revenue_lots" ADD CONSTRAINT "seller_revenue_lots_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_sale_snapshots" ADD CONSTRAINT "seller_sale_snapshots_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_sale_snapshots" ADD CONSTRAINT "seller_sale_snapshots_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_wallet_requests" ADD CONSTRAINT "seller_wallet_requests_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_wallet_requests" ADD CONSTRAINT "seller_wallet_requests_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_revenue_event_history_idx" ON "seller_revenue_events" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "seller_revenue_lot_due_idx" ON "seller_revenue_lots" USING btree ("released","release_at");--> statement-breakpoint
CREATE INDEX "seller_wallet_request_seller_idx" ON "seller_wallet_requests" USING btree ("seller_id","status");