import "./lib/env";

import { asc, count, isNull, SQL, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import db, { client } from "./lib/initDB";

const BATCH_SIZE = 500;

async function getCount(
  table:
    | typeof schema.productTable
    | typeof schema.productVariantTable
    | typeof schema.cartItemTable
    | typeof schema.orderItemTable
    | typeof schema.chatRoomTable
    | typeof schema.merchantTradeTable,
  where?: SQL,
) {
  const [result] = await db
    .select({ value: count() })
    .from(table as any)
    .where(where);

  return result.value;
}

async function getBackfillStats() {
  const [
    productCount,
    variantCount,
    cartItemsMissingVariant,
    orderItemsMissingVariant,
    productChatRoomsMissingVariant,
    merchantTradesMissingVariants,
  ] = await Promise.all([
    getCount(schema.productTable),
    getCount(schema.productVariantTable),
    getCount(
      schema.cartItemTable,
      isNull(schema.cartItemTable.productVariantId),
    ),
    getCount(
      schema.orderItemTable,
      isNull(schema.orderItemTable.productVariantId),
    ),
    getCount(
      schema.chatRoomTable,
      sql`${schema.chatRoomTable.productId} is not null and ${schema.chatRoomTable.productVariantId} is null`,
    ),
    getCount(
      schema.merchantTradeTable,
      sql`cardinality(${schema.merchantTradeTable.variantIds}) = 0`,
    ),
  ]);

  return {
    productCount,
    variantCount,
    cartItemsMissingVariant,
    orderItemsMissingVariant,
    productChatRoomsMissingVariant,
    merchantTradesMissingVariants,
  };
}

async function createDefaultVariantsForProductsWithoutVariants() {
  const products = await db
    .select({
      id: schema.productTable.id,
      sku: schema.productTable.sku,
      stock: schema.productTable.stock,
      reserve: schema.productTable.reserve,
      status: schema.productTable.status,
      createdAt: schema.productTable.createdAt,
      updatedAt: schema.productTable.updatedAt,
    })
    .from(schema.productTable)
    .orderBy(asc(schema.productTable.id));

  const existingVariants = await db
    .select({ productId: schema.productVariantTable.productId })
    .from(schema.productVariantTable);

  const productIdsWithVariant = new Set(
    existingVariants.map((variant) => variant.productId),
  );
  const productsWithoutVariant = products.filter(
    (product) => !productIdsWithVariant.has(product.id),
  );

  for (let i = 0; i < productsWithoutVariant.length; i += BATCH_SIZE) {
    const batch = productsWithoutVariant.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;

    await db.insert(schema.productVariantTable).values(
      batch.map((product) => ({
        productId: product.id,
        name: null,
        sku: product.sku,
        optionValues: {},
        stock: product.stock,
        reserve: product.reserve,
        sortOrder: 0,
        status: product.status,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      })),
    );
  }

  return productsWithoutVariant.length;
}

async function backfillCartItems() {
  await db.execute(sql`
    update ${schema.cartItemTable} cart_item
    set
      product_variant_id = default_variant.id,
      updated_at = now()
    from (
      select distinct on (product_id)
        id,
        product_id
      from ${schema.productVariantTable}
      order by product_id, sort_order asc, created_at asc
    ) default_variant
    where cart_item.product_variant_id is null
      and cart_item.product_id = default_variant.product_id
  `);
}

async function backfillOrderItems() {
  await db.execute(sql`
    update ${schema.orderItemTable} order_item
    set
      product_variant_id = default_variant.id,
      variant_name_at_sale = coalesce(
        order_item.variant_name_at_sale,
        default_variant.name
      ),
      variant_sku_at_sale = coalesce(
        order_item.variant_sku_at_sale,
        default_variant.sku
      ),
      variant_option_values_at_sale = coalesce(
        order_item.variant_option_values_at_sale,
        default_variant.option_values
      ),
      updated_at = now()
    from (
      select distinct on (product_id)
        id,
        product_id,
        name,
        sku,
        option_values
      from ${schema.productVariantTable}
      order by product_id, sort_order asc, created_at asc
    ) default_variant
    where order_item.product_variant_id is null
      and order_item.product_id = default_variant.product_id
  `);
}

async function backfillMerchantTrades() {
  await db.execute(sql`
    update ${schema.merchantTradeTable} merchant_trade
    set variant_ids = backfilled.variant_ids
    from (
      select
        product_variant_pairs.merchant_trade_id,
        array_agg(product_variant_pairs.variant_id order by product_variant_pairs.ordinality) as variant_ids
      from (
        select
          merchant_trade.id as merchant_trade_id,
          product_id_values.ordinality,
          default_variant.id as variant_id
        from ${schema.merchantTradeTable} merchant_trade
        cross join lateral unnest(merchant_trade.product_ids) with ordinality as product_id_values(product_id, ordinality)
        join (
          select distinct on (product_id)
            id,
            product_id
          from ${schema.productVariantTable}
          order by product_id, sort_order asc, created_at asc
        ) default_variant
          on default_variant.product_id = product_id_values.product_id
        where cardinality(merchant_trade.variant_ids) = 0
      ) product_variant_pairs
      group by product_variant_pairs.merchant_trade_id
    ) backfilled
    where merchant_trade.id = backfilled.merchant_trade_id
      and cardinality(merchant_trade.variant_ids) = 0
  `);
}

async function backfillChatRooms() {
  await db.execute(sql`
    update ${schema.chatRoomTable} chat_room
    set
      product_variant_id = coalesce(
        (
          select order_item.product_variant_id
          from ${schema.orderItemTable} order_item
          where order_item.order_id = chat_room.order_id
            and order_item.product_id = chat_room.product_id
            and order_item.product_variant_id is not null
          order by order_item.created_at asc
          limit 1
        ),
        (
          select default_variant.id
          from ${schema.productVariantTable} default_variant
          where default_variant.product_id = chat_room.product_id
          order by default_variant.sort_order asc, default_variant.created_at asc
          limit 1
        )
      ),
      updated_at = now()
    where chat_room.product_id is not null
      and chat_room.product_variant_id is null
      and coalesce(
        (
          select order_item.product_variant_id
          from ${schema.orderItemTable} order_item
          where order_item.order_id = chat_room.order_id
            and order_item.product_id = chat_room.product_id
            and order_item.product_variant_id is not null
          order by order_item.created_at asc
          limit 1
        ),
        (
          select default_variant.id
          from ${schema.productVariantTable} default_variant
          where default_variant.product_id = chat_room.product_id
          order by default_variant.sort_order asc, default_variant.created_at asc
          limit 1
        )
      ) is not null
  `);
}

async function main() {
  console.log("Starting product variant backfill...");
  console.log("Before:", await getBackfillStats());

  const createdDefaultVariantCount =
    await createDefaultVariantsForProductsWithoutVariants();
  await backfillCartItems();
  await backfillOrderItems();
  await backfillChatRooms();
  await backfillMerchantTrades();

  const afterStats = await getBackfillStats();
  console.log("Created default variants:", createdDefaultVariantCount);
  console.log("After:", afterStats);

  if (
    afterStats.cartItemsMissingVariant > 0 ||
    afterStats.orderItemsMissingVariant > 0 ||
    afterStats.productChatRoomsMissingVariant > 0 ||
    afterStats.merchantTradesMissingVariants > 0
  ) {
    throw new Error(
      "Backfill finished with cart/order items, product chat rooms, or merchant trades still missing variant ids.",
    );
  }

  console.log("Product variant backfill completed.");
}

main()
  .catch((error) => {
    console.error("Product variant backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
