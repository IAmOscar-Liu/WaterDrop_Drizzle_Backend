import {
  and,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  SQL,
} from "drizzle-orm";

import * as schema from "../db/schema";
import { getEcpayLength, hasSpecialChars } from "../lib/ecpayValidation";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

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
  return newCategory;
}

/**
 * Retrieves a list of all categories, sorted by name.
 * @returns An array of all categories.
 */
export async function listCategory() {
  return db.query.categoryTable.findMany({
    orderBy: (categories, { asc }) => [asc(categories.name)],
  });
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

export async function getProductWithSellerById(productId: string) {
  return db.query.productTable.findFirst({
    where: eq(schema.productTable.id, productId),
    with: {
      advertisement: true,
      seller: {
        columns: {
          role: true,
          name: true,
          realName: true,
          email: true,
          phone: true,
          avatar_url: true,
        },
      },
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
  categoryIds?: string[],
) {
  // 0. Check product name before creating the product
  if (hasSpecialChars(productData.name)) {
    throw new CustomError(
      `商品名稱「${productData.name}」不得包含 ^ ‘ \` ! @ # % & * + \\ ” < > | _ [ ] 等特殊符號`,
      400,
    );
  }
  const productNameLength = getEcpayLength(productData.name);
  if (productNameLength > 50) {
    throw new CustomError(
      `商品名稱「${productData.name}」總長度超過 50 字元 (目前長度: ${productNameLength})`,
      400,
    );
  }

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

/**
 * Updates an existing product and its category associations.
 * @param productId The ID of the product to update.
 * @param productData The product data to update.
 * @param categoryIds An optional array of category IDs. If provided, it will replace all existing category associations for the product.
 * @returns The updated product with its category relations.
 */
export async function updateProduct(
  productId: string,
  productData: Partial<Omit<schema.NewProduct, "id">>,
  categoryIds?: string[],
) {
  // 0. Check product name before updating the product
  if (productData.name) {
    if (hasSpecialChars(productData.name)) {
      throw new CustomError(
        `商品名稱「${productData.name}」不得包含 ^ ‘ \` ! @ # % & * + \\ ” < > | _ [ ] 等特殊符號`,
        400,
      );
    }
    const productNameLength = getEcpayLength(productData.name);
    if (productNameLength > 50) {
      throw new CustomError(
        `商品名稱「${productData.name}」總長度超過 50 字元 (目前長度: ${productNameLength})`,
        400,
      );
    }
  }

  return db.transaction(async (tx) => {
    // 1. Update the product itself
    const [updatedProduct] = await tx
      .update(schema.productTable)
      .set({ ...productData, updatedAt: new Date() })
      .where(eq(schema.productTable.id, productId))
      .returning();

    // 2. If category IDs are provided, update the associations
    if (categoryIds) {
      // First, remove all existing category associations for this product
      await tx
        .delete(schema.productsToCategoriesTable)
        .where(eq(schema.productsToCategoriesTable.productId, productId));

      // Then, insert the new associations if there are any
      if (categoryIds.length > 0) {
        const productToCategoryValues = categoryIds.map((categoryId) => ({
          productId: productId,
          categoryId: categoryId,
        }));
        await tx
          .insert(schema.productsToCategoriesTable)
          .values(productToCategoryValues);
      }
    }

    // 3. Return the fully updated product with its relations
    // We re-fetch it to get the latest state including the new category relations.
    return tx.query.productTable.findFirst({
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
  });
}

export async function decreaseProductStock(
  productId: string,
  quantity: number,
) {
  if (quantity <= 0) {
    throw new CustomError("Quantity must be positive", 400);
  }

  const [updatedProduct] = await db
    .update(schema.productTable)
    .set({
      stock: sql`${schema.productTable.stock} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productTable.id, productId),
        gte(schema.productTable.stock, quantity),
      ),
    )
    .returning();

  if (!updatedProduct) {
    throw new CustomError("Insufficient stock or product not found", 400);
  }

  return updatedProduct;
}

export interface ListAdminProductsParams extends PaginationParams {
  categoryId?: string;
  search?: string;
  status?: schema.NewProduct["status"];
  minPrice?: number;
  maxPrice?: number;
  sellerId?: string;
}

/**
 * Lists admin products with pagination, filtering, and searching.
 * @param params The pagination and filter parameters.
 * @returns An object containing the product array, total count, and pagination details.
 */
export async function listAdminProducts({
  page = 1,
  limit = 10,
  categoryId,
  search,
  status,
  sellerId,
  minPrice,
  maxPrice,
}: ListAdminProductsParams) {
  const pagination = getPagination(page, limit);
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
        ilike(schema.productTable.description, searchTerm),
      ),
    );
  }

  if (status) {
    conditions.push(eq(schema.productTable.status, status));
  }

  if (sellerId) {
    const isAdmin = await isAccountAdmin(sellerId);
    if (!isAdmin) {
      conditions.push(eq(schema.productTable.sellerId, sellerId));
    }
  }

  if (minPrice !== undefined) {
    conditions.push(gte(schema.productTable.price, minPrice));
  }

  if (maxPrice !== undefined) {
    conditions.push(lte(schema.productTable.price, maxPrice));
  }

  const whereClause = compactConditions(conditions);

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.productTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

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
    limit: pagination.limit,
    offset: pagination.offset,
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });

  return {
    products,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export interface ListProductsParams extends PaginationParams {
  categoryId?: string;
  search?: string;
  status?: schema.NewProduct["status"];
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
  status,
  minPrice,
  maxPrice,
}: ListProductsParams) {
  const pagination = getPagination(page, limit);
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
        ilike(schema.productTable.description, searchTerm),
      ),
    );
  }

  if (status) {
    conditions.push(eq(schema.productTable.status, status));
  }

  if (minPrice !== undefined) {
    conditions.push(gte(schema.productTable.price, minPrice));
  }

  if (maxPrice !== undefined) {
    conditions.push(lte(schema.productTable.price, maxPrice));
  }

  conditions.push(gt(schema.productTable.stock, schema.productTable.reserve));

  const whereClause = compactConditions(conditions);

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.productTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  // Query for the paginated products with their relations
  const products = await db.query.productTable.findMany({
    where: whereClause,
    with: {
      advertisement: true,
      seller: {
        columns: {
          role: true,
          name: true,
          realName: true,
          email: true,
          phone: true,
          avatar_url: true,
        },
      },
      productsToCategories: {
        with: {
          category: true,
        },
      },
    },
    limit: pagination.limit,
    offset: pagination.offset,
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });

  return {
    products,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

/**
 * Calculates the sales summary (total quantity sold and total revenue) for a specific product.
 * It only considers order items from orders with a 'paid' status.
 * @param params The product ID and optional start and end dates for filtering orders.
 * @returns An object containing the total quantity sold and total revenue.
 */
// from /Users/oscar/Desktop/my_code/drizzle/drizzle_test/src/repository/product.ts

export async function getProductSalesSummary({
  productId,
  startAt,
  endAt,
}: {
  productId: string;
  startAt?: Date;
  endAt?: Date;
}) {
  const product = await db.query.productTable.findFirst({
    where: eq(schema.productTable.id, productId),
  });
  if (!product) throw new CustomError("Product not found", 404);

  const conditions: (SQL | undefined)[] = [
    // Filter for the specific product in the order items
    eq(schema.orderItemTable.productId, productId),
    // Filter for orders that have a 'paid' status from the joined orderTable
    eq(schema.orderTable.orderStatus, "paid"),
  ];

  if (startAt) {
    // Filter by date on the orderTable
    conditions.push(gte(schema.orderTable.createdAt, startAt));
  }
  if (endAt) {
    conditions.push(lte(schema.orderTable.createdAt, endAt));
  }

  const [result] = await db
    .select({
      totalQuantity:
        sql<number>`sum(${schema.orderItemTable.quantity})`.mapWith(Number),
      totalRevenue:
        sql<number>`sum(${schema.orderItemTable.unitPriceAtSale} * ${schema.orderItemTable.quantity})`.mapWith(
          Number,
        ),
    })
    .from(schema.orderItemTable)
    // Here we join orderItemTable with orderTable on the order ID
    .innerJoin(
      schema.orderTable,
      eq(schema.orderItemTable.orderId, schema.orderTable.id),
    )
    // The 'where' clause applies all conditions, including the one for order status
    .where(and(...conditions));

  return {
    product,
    stats: {
      startAt: startAt ? startAt.toISOString() : null,
      endAt: endAt ? endAt.toISOString() : null,
      totalQuantity: result.totalQuantity || 0,
      totalRevenue: result.totalRevenue || 0,
    },
  };
}
