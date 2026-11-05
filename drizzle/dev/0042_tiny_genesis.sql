ALTER TABLE "device_tokens" ADD COLUMN "device_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_user_device_uk" ON "device_tokens" USING btree ("user_id","device_id");