ALTER TABLE "advertisements" DROP CONSTRAINT "advertisements_product_id_unique";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_coin" SET DATA TYPE double precision;