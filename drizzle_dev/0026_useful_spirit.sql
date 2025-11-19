DROP INDEX "users_oauth_provider_id_uk";--> statement-breakpoint
CREATE UNIQUE INDEX "users_oauth_provider_id_uk" ON "users" USING btree ("oauth_provider","oauth_id","email");