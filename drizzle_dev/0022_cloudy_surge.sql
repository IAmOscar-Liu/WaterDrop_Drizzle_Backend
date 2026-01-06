DROP INDEX "chat_rooms_user_account_product_uk";--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_user_account_product_order_uk" ON "chat_rooms" USING btree ("user_id","account_id","product_id","order_id");