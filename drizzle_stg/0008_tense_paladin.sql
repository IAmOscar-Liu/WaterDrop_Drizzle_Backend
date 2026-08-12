DROP INDEX "chat_rooms_user_account_product_order_uk";--> statement-breakpoint
DROP INDEX "order_items_order_product_uk";--> statement-breakpoint
ALTER TABLE "cart_items" ALTER COLUMN "product_variant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "product_variant_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_user_account_product_variant_order_uk" ON "chat_rooms" USING btree ("user_id",coalesce("account_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("product_variant_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("order_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "chat_rooms_product_variant_id_idx" ON "chat_rooms" USING btree ("product_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_variant_uk" ON "order_items" USING btree ("order_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "order_items_product_variant_id_idx" ON "order_items" USING btree ("product_variant_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("product_id","status");--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_product_variant_pair_ck" CHECK (("chat_rooms"."product_id" is null and "chat_rooms"."product_variant_id" is null) or ("chat_rooms"."product_id" is not null and "chat_rooms"."product_variant_id" is not null));--> statement-breakpoint
ALTER TABLE "merchant_trades" ADD CONSTRAINT "merchant_trades_product_variant_length_ck" CHECK (cardinality("merchant_trades"."product_ids") = cardinality("merchant_trades"."variant_ids"));--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_non_negative_ck" CHECK ("product_variants"."stock" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_reserve_non_negative_ck" CHECK ("product_variants"."reserve" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_reserve_not_exceed_stock_ck" CHECK ("product_variants"."reserve" <= "product_variants"."stock");