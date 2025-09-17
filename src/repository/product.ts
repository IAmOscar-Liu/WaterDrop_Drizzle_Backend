import {
  and,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  SQL,
} from "drizzle-orm";

import * as schema from "../db/schema";
import db from "../lib/initDB";

// --- Category Functions ---

/**
 * Creates a new category.
 * @param categoryData The data for the new category.
 * @returns The newly created category.
 */
export async function createCategory(categoryData: schema.NewCategory) {
  const [newCategory] = await db
    .insert(schema.categoryTable)
    .values(categoryData)
    .returning();
  console.log("New category created:", newCategory.id);
  return newCategory;
}

/**
 * Retrieves a list of all categories, sorted by name.
 * @returns An array of all categories.
 */
export async function listCategory() {
  const categories = await db.query.categoryTable.findMany({
    orderBy: (categories, { asc }) => [asc(categories.name)],
  });
  console.log("No. of categories:", categories.length);
  return categories;
}

// --- Product Functions ---

export async function getProductById(productId: string) {
  return db.query.productTable.findFirst({
    where: eq(schema.productTable.id, productId),
    with: {
      advertisement: true,
      productsToCategories: {
        with: {
          category: true,
        },
      },
    },
  });
}

/**
 * Creates a new product and associates it with given categories.
 * @param productData The data for the new product.
 * @param categoryIds An optional array of category IDs to associate with the product.
 * @returns The newly created product with its category relations.
 */
export async function createProduct(
  productData: schema.NewProduct,
  categoryIds?: string[]
) {
  return db.transaction(async (tx) => {
    // 1. Create the product
    const [newProduct] = await tx
      .insert(schema.productTable)
      .values(productData)
      .returning();

    // 2. If category IDs are provided, create the associations
    if (categoryIds && categoryIds.length > 0) {
      const productToCategoryValues = categoryIds.map((categoryId) => ({
        productId: newProduct.id,
        categoryId: categoryId,
      }));

      await tx
        .insert(schema.productsToCategoriesTable)
        .values(productToCategoryValues);
    }

    console.log("New product created:", newProduct.id);

    // 3. Return the full product with relations for confirmation
    return tx.query.productTable.findFirst({
      where: eq(schema.productTable.id, newProduct.id),
      with: {
        productsToCategories: {
          with: {
            category: true,
          },
        },
      },
    });
  });
}

export interface ListProductsParams {
  page?: number;
  limit?: number;
  categoryId?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Lists products with pagination, filtering, and searching.
 * @param params The pagination and filter parameters.
 * @returns An object containing the product array, total count, and pagination details.
 */
export async function listProducts({
  page = 1,
  limit = 10,
  categoryId,
  search,
  minPrice,
  maxPrice,
}: ListProductsParams) {
  const offset = (page - 1) * limit;
  const conditions: (SQL | undefined)[] = [];

  // Only return products that have an associated seller.
  conditions.push(isNotNull(schema.productTable.sellerId));

  // Add conditions based on filters
  if (categoryId) {
    const productIdsWithCategory = db
      .select({ productId: schema.productsToCategoriesTable.productId })
      .from(schema.productsToCategoriesTable)
      .where(eq(schema.productsToCategoriesTable.categoryId, categoryId));
    conditions.push(inArray(schema.productTable.id, productIdsWithCategory));
  }

  if (search) {
    const searchTerm = `%${search}%`;
    conditions.push(
      or(
        ilike(schema.productTable.name, searchTerm),
        ilike(schema.productTable.description, searchTerm)
      )
    );
  }

  if (minPrice !== undefined) {
    conditions.push(gte(schema.productTable.price, minPrice));
  }

  if (maxPrice !== undefined) {
    conditions.push(lte(schema.productTable.price, maxPrice));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.productTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated products with their relations
  const products = await db.query.productTable.findMany({
    where: whereClause,
    with: {
      advertisement: true,
      productsToCategories: {
        with: {
          category: true,
        },
      },
    },
    limit: limit,
    offset: offset,
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });

  return {
    products,
    total,
    page,
    limit,
    totalPages,
  };
}
