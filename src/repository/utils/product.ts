import { sql } from "drizzle-orm";

import * as schema from "../../db/schema";

export function minimumVariantPrice(
  productIdColumn: typeof schema.productTable.id,
  activeOnly = false,
) {
  return sql<number>`(
    select min(price)
    from ${schema.productVariantTable} price_variant
    where price_variant.product_id = ${productIdColumn}
      ${activeOnly ? sql`and price_variant.status = 'active'` : sql``}
  )`;
}

export function withProductVariantAggregates<
  T extends schema.Product & {
    variants?: schema.ProductVariant[];
    price?: number;
  },
>(product: T, priceScope: "active" | "all" = "active") {
  const activeVariants = product.variants?.filter(
    (variant) => variant.status === "active",
  );
  const variantsForAggregate = activeVariants?.length
    ? activeVariants
    : (product.variants ?? []);
  const stock = variantsForAggregate.reduce(
    (total, variant) => total + variant.stock,
    0,
  );
  const reserve = variantsForAggregate.reduce(
    (total, variant) => total + variant.reserve,
    0,
  );
  const variantsForPrice =
    priceScope === "all" ? (product.variants ?? []) : variantsForAggregate;
  const price =
    variantsForPrice.length > 0
      ? Math.min(...variantsForPrice.map((variant) => variant.price))
      : null;

  return {
    ...product,
    price,
    availableStock: stock - reserve,
    variants: product.variants?.map((variant) => ({
      ...variant,
      availableStock: variant.stock - variant.reserve,
    })),
  };
}
