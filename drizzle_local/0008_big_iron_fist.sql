ALTER TABLE "collections" DROP CONSTRAINT "collections_user_id_product_id_pk";--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_product_uk" ON "collections" USING btree ("user_id","product_id");