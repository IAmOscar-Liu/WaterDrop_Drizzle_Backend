CREATE TYPE "public"."account_role" AS ENUM('admin', 'seller');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text,
	"role" "account_role" DEFAULT 'seller' NOT NULL,
	"phone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seller_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;