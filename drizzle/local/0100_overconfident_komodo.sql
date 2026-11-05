DROP INDEX "chat_rooms_user_account_product_order_uk";--> statement-breakpoint
ALTER TABLE "merchant_trades" ALTER COLUMN "variant_ids" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "product_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_user_account_product_order_uk" ON "chat_rooms" USING btree ("user_id","account_id","product_id","product_variant_id","order_id");