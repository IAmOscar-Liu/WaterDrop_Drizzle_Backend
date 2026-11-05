ALTER TABLE "chat_rooms" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;