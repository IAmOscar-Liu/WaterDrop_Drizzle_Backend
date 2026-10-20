CREATE TABLE "account_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "account_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "account_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"credential_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	CONSTRAINT "account_sessions_expiry_check" CHECK ("account_sessions"."expires_at" > "account_sessions"."created_at"),
	CONSTRAINT "account_sessions_version_check" CHECK ("account_sessions"."credential_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_refresh_tokens" ADD CONSTRAINT "account_refresh_tokens_session_id_account_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."account_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_refresh_tokens_session_idx" ON "account_refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_refresh_tokens_one_current_idx" ON "account_refresh_tokens" USING btree ("session_id") WHERE "account_refresh_tokens"."used_at" IS NULL;--> statement-breakpoint
CREATE INDEX "account_sessions_account_idx" ON "account_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_sessions_expiry_idx" ON "account_sessions" USING btree ("expires_at");