ALTER TABLE "__drizzle_migrations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "__drizzle_migrations" CASCADE;--> statement-breakpoint
DROP INDEX "cart_items_user_product_uk";--> statement-breakpoint
DROP INDEX "users_oauth_provider_id_uk";--> statement-breakpoint
DROP INDEX "users_referral_code_uk";--> statement-breakpoint
DROP INDEX "chat_rooms_user_account_product_uk";--> statement-breakpoint
CREATE INDEX "users_timezone_idx" ON "users" USING btree ("timezone");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_product_uk" ON "cart_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oauth_provider_id_uk" ON "users" USING btree ("oauth_provider","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uk" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_user_account_product_uk" ON "chat_rooms" USING btree ("user_id","account_id","product_id");