CREATE TABLE "ad_refill_events" (
	"advertisement_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_shipping_breakdowns" (
	"refund_id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid,
	"shipping_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_amount" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_shipment_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"order_item_ids" uuid[] NOT NULL,
	"buyer_paid_amount" numeric(18, 2),
	"standard_cost" numeric(18, 2),
	"subsidy" numeric(18, 2) DEFAULT '0' NOT NULL,
	"logistics_type" text NOT NULL,
	"claimed_by_refund_id" uuid,
	"claim_completed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "seller_shipment_snapshots_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" DROP CONSTRAINT "account_wallet_transactions_type_sign";--> statement-breakpoint
ALTER TABLE "ad_refill_events" ADD CONSTRAINT "ad_refill_events_advertisement_id_advertisements_id_fk" FOREIGN KEY ("advertisement_id") REFERENCES "public"."advertisements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_shipping_breakdowns" ADD CONSTRAINT "refund_shipping_breakdowns_refund_id_refund_items_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_shipping_breakdowns" ADD CONSTRAINT "refund_shipping_breakdowns_shipment_id_seller_shipment_snapshots_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."seller_shipment_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_shipment_snapshots" ADD CONSTRAINT "seller_shipment_snapshots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_shipment_snapshots" ADD CONSTRAINT "seller_shipment_snapshots_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_shipment_snapshots" ADD CONSTRAINT "seller_shipment_snapshots_claimed_by_refund_id_refund_items_id_fk" FOREIGN KEY ("claimed_by_refund_id") REFERENCES "public"."refund_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_wallet_transactions" ADD CONSTRAINT "account_wallet_transactions_type_sign" CHECK ((
        "account_wallet_transactions"."type"::text in ('legacy_opening_balance', 'admin_credit', 'advertisement_budget_return', 'seller_deposit')
        and "account_wallet_transactions"."amount" > 0
      ) or (
        "account_wallet_transactions"."type"::text in ('advertisement_funding_debit', 'seller_withdrawal')
        and "account_wallet_transactions"."amount" < 0
      ));