ALTER TYPE "public"."account_role" ADD VALUE 'employee';--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "account_group_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_group_id_account_groups_id_fk" FOREIGN KEY ("account_group_id") REFERENCES "public"."account_groups"("id") ON DELETE no action ON UPDATE no action;