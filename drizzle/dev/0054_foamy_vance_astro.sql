CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text,
	"sku" text,
	"option_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stock" integer NOT NULL,
	"reserve" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "cart_items_user_product_uk";--> statement-breakpoint
DROP INDEX "chat_rooms_user_account_product_order_uk";--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "product_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "product_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_trades" ADD COLUMN "variant_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_name_at_sale" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_sku_at_sale" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_option_values_at_sale" jsonb;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_variants_product_id_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_sku_uk" ON "product_variants" USING btree ("product_id","sku");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_product_variant_uk" ON "cart_items" USING btree ("user_id","product_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_user_account_product_order_uk" ON "chat_rooms" USING btree ("user_id","account_id","product_id","product_variant_id","order_id");