ALTER TABLE "product_variants" ALTER COLUMN "price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "price";