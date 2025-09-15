CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'apple', 'github', 'facebook', 'line', 'password', 'other');--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"oauth_provider" "oauth_provider" NOT NULL,
	"oauth_id" text NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"referral_code" text NOT NULL,
	"name" text,
	"phone" text,
	"address" text,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_oauth_provider_id_uk" ON "users" USING btree ("oauth_provider","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uk" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uk" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_group_id_idx" ON "users" USING btree ("group_id");