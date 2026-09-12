CREATE INDEX "coin_ledger_job_runs_scheduled_for_idx" ON "coin_ledger_job_runs" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "device_tokens_last_used_at_idx" ON "device_tokens" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_updated_at_idx" ON "idempotency_keys" USING btree ("updated_at");