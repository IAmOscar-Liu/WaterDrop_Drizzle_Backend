CREATE TABLE "account_email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email_snapshot" text NOT NULL,
	"target_email" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"credential_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "account_email_verification_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "account_email_verification_expiry_ck" CHECK ("account_email_verification_tokens"."expires_at" > "account_email_verification_tokens"."created_at"),
	CONSTRAINT "account_email_verification_version_ck" CHECK ("account_email_verification_tokens"."credential_version" >= 0),
	CONSTRAINT "account_email_verification_purpose_ck" CHECK ("account_email_verification_tokens"."purpose" in ('verify', 'change') and ("account_email_verification_tokens"."purpose" <> 'verify' or "account_email_verification_tokens"."target_email" = "account_email_verification_tokens"."email_snapshot"))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_email_verification_tokens" ADD CONSTRAINT "account_email_verification_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_email_verification_account_idx" ON "account_email_verification_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_email_verification_expiry_idx" ON "account_email_verification_tokens" USING btree ("expires_at");