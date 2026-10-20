CREATE TABLE "account_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"credential_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "account_password_reset_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "account_password_reset_expiry_check" CHECK ("account_password_reset_tokens"."expires_at" > "account_password_reset_tokens"."created_at"),
	CONSTRAINT "account_password_reset_version_check" CHECK ("account_password_reset_tokens"."credential_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account_recovery_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"last_accepted_at" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "account_recovery_rate_attempts_check" CHECK ("account_recovery_rate_limits"."attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "real_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "credential_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_password_reset_tokens" ADD CONSTRAINT "account_password_reset_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_password_reset_account_idx" ON "account_password_reset_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_password_reset_expiry_idx" ON "account_password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "account_recovery_rate_window_idx" ON "account_recovery_rate_limits" USING btree ("window_started_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_credential_version_nonnegative" CHECK ("accounts"."credential_version" >= 0);