CREATE TABLE "order_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_trade_no" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount" integer NOT NULL,
	"method" "order_payment" NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"provider_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payment_attempts_amount_ck" CHECK ("order_payment_attempts"."amount" > 0),
	CONSTRAINT "order_payment_attempts_state_ck" CHECK ("order_payment_attempts"."state" in ('prepared', 'succeeded', 'failed', 'settled'))
);
--> statement-breakpoint
ALTER TABLE "order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_payment_attempts_order_uk" ON "order_payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_payment_attempts_trade_uk" ON "order_payment_attempts" USING btree ("merchant_trade_no");--> statement-breakpoint
CREATE INDEX "order_payment_attempts_state_idx" ON "order_payment_attempts" USING btree ("state","updated_at");