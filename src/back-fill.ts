import "./lib/env";

import { count, eq, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import db, { client } from "./lib/initDB";

async function getBackfillStats() {
  const [
    [variantCount],
    [missingImagesWithProductImageCount],
    [orphanVariantCount],
  ] = await Promise.all([
    db.select({ value: count() }).from(schema.productVariantTable),
    db
      .select({ value: count() })
      .from(schema.productVariantTable)
      .innerJoin(
        schema.productTable,
        eq(schema.productVariantTable.productId, schema.productTable.id),
      )
      .where(
        sql`${schema.productVariantTable.images} is null
          and ${schema.productTable.images}[1] is not null`,
      ),
    db
      .select({ value: count() })
      .from(schema.productVariantTable)
      .leftJoin(
        schema.productTable,
        eq(schema.productVariantTable.productId, schema.productTable.id),
      )
      .where(isNull(schema.productTable.id)),
  ]);

  return {
    variantCount: variantCount.value,
    missingImagesWithProductImageCount:
      missingImagesWithProductImageCount.value,
    orphanVariantCount: orphanVariantCount.value,
  };
}

async function backfillVariantImages() {
  const updatedVariants = await db.execute(sql`
    update ${schema.productVariantTable} as variant
    set
      images = array[product.images[1]],
      updated_at = now()
    from ${schema.productTable} as product
    where variant.product_id = product.id
      and variant.images is null
      and product.images[1] is not null
    returning variant.id
  `);

  return updatedVariants.length;
}

async function main() {
  console.log("Starting product variant image backfill...");

  const before = await getBackfillStats();
  console.log("Before:", before);

  if (before.orphanVariantCount > 0) {
    throw new Error(
      `Cannot backfill ${before.orphanVariantCount} variant(s) without a parent product.`,
    );
  }

  const updatedVariantImageCount = await backfillVariantImages();
  const after = await getBackfillStats();

  console.log("Updated variant images:", updatedVariantImageCount);
  console.log("After:", after);

  if (after.missingImagesWithProductImageCount > 0) {
    throw new Error(
      `Backfill finished with ${after.missingImagesWithProductImageCount} variant image array(s) still missing despite an available product image.`,
    );
  }

  console.log("Product variant image backfill completed.");
}

main()
  .catch((error) => {
    console.error("Product variant image backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
