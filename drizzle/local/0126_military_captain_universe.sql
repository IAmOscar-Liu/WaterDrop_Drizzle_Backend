CREATE TABLE "seller_company_info" (
	"seller_id" uuid PRIMARY KEY NOT NULL,
	"company_name" text,
	"tax_id" text,
	"company_address" text,
	"contact_name" text,
	"contact_phone" text,
	"bank_name" text,
	"bank_code" text,
	"bank_account" text,
	"bank_account_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_company_info" ADD CONSTRAINT "seller_company_info_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;