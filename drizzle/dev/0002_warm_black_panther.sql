DROP INDEX "users_timezone_idx";--> statement-breakpoint
CREATE INDEX "users_timezone_idx" ON "users" USING btree ("timezone");