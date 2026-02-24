CREATE TABLE "shipping_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"home_delivery" double precision DEFAULT 60,
	"home_delivery_refrigeration" double precision DEFAULT 160,
	"okmart_low_temperature_c2c" double precision DEFAULT 160,
	"fami_c2c" double precision DEFAULT 69,
	"unimart_c2c" double precision DEFAULT 69,
	"hilife_c2c" double precision DEFAULT 58,
	"okmart_c2c" double precision DEFAULT 58
);
--> statement-breakpoint
ALTER TABLE "shipping_fees" ADD CONSTRAINT "shipping_fees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;