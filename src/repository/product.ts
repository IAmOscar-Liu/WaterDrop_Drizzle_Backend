import {
  and,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  SQL,
} from "drizzle-orm";

import * as schema from "../db/schema";
import { getEcpayLength, hasSpecialChars } from "../lib/ecpayValidation";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import { recordAdminActivityWithTx } from "./adminActivity";
import { getActiveAdminAccount, resolveAdminSellerScope } from "./adminScope";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";
import {
  minimumVariantPrice,
  withProductVariantAggregates,
} from "./utils/product";

export type ProductVariantWriteInput = {
  id?: string;
  name?: string | null;
  sku?: string | null;
  price?: number;
  images?: string[] | null;
  optionValues?: Record<string, unknown>;
  stock?: number;
  sortOrder?: number;
  status?: schema.NewProductVariant["status"];
  metadata?: Record<string, unknown> | null;
};

function activeVariantAvailabilityCondition(
  productIdColumn: typeof schema.productTable.id,
) {
  return sql<boolean>`exists (
    select 1
    from product_variants active_variant
    where active_variant.product_id = ${productIdColumn}
      and active_variant.status = 'active'
      and active_variant.stock > active_variant.reserve
  )`;
}

function buildCreateVariantValues(
  productId: string,
  variant: ProductVariantWriteInput,
): schema.NewProductVariant {
  if (variant.stock === undefined) {
    throw new CustomError("Variant stock is required", 400);
  }
  if (variant.price === undefined) {
    throw new CustomError("Variant price is required", 400);
  }

  return {
    productId,
    name: variant.name ?? null,
    sku: variant.sku ?? null,
    price: variant.price,
    images: variant.images ?? null,
    optionValues: variant.optionValues ?? {},
    stock: variant.stock,
    reserve: 0,
    sortOrder: variant.sortOrder ?? 0,
    status: variant.status ?? "active",
    metadata: variant.metadata ?? null,
  };
}

function hasVariantName(variant: Pick<ProductVariantWriteInput, "name">) {
  return typeof variant.name === "string" && variant.name.trim().length > 0;
}

function validateProductVariantMode(
  variants: Pick<ProductVariantWriteInput, "name" | "status">[],
) {
  const unnamedVariants = variants.filter((variant) => !hasVariantName(variant));
  if (unnamedVariants.length > 1) {
    throw new CustomError(
      "A product can have only one unnamed default variant",
      400,
    );
  }

  const activeVariants = variants.filter(
    (variant) => (variant.status ?? "active") === "active",
  );
  const isSimpleMode =
    activeVariants.length === 1 && !hasVariantName(activeVariants[0]);
  const isVariantMode =
    activeVariants.length >= 2 && activeVariants.every(hasVariantName);

  if (!isSimpleMode && !isVariantMode) {
    throw new CustomError(
      "Product must have exactly one active unnamed default variant, or at least two active named variants",
      400,
    );
  }
}

function isUniqueViolation(error: any) {
  return error?.code === "23505" || error?.cause?.code === "23505";
}

// --- Category Functions ---

/**
 * Creates a new category.
 * @param categoryData The data for the new category.
 * @returns The newly created category.
 */
export async function createCategory(categoryData: schema.NewCategory) {
  try {
    const [newCategory] = await db
      .insert(schema.categoryTable)
      .values({ ...categoryData, name: categoryData.name.trim() })
      .returning();
    return newCategory;
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      throw new CustomError("A category with this name already exists", 409);
    }
    throw error;
  }
}

export async function updateCategory(
  categoryId: string,
  name: string,
  actorAccountId: string,
) {
  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.categoryTable)
        .set({ name: name.trim(), updatedAt: new Date() })
        .where(eq(schema.categoryTable.id, categoryId))
        .returning();
      if (!updated) throw new CustomError("Category not found", 404);
      await recordAdminActivityWithTx(tx, {
        actorAccountId,
        eventType: "category.renamed",
        entityType: "category",
        entityId: categoryId,
        metadata: { name: updated.name },
      });
      return updated;
    });
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      throw new CustomError("A category with this name already exists", 409);
    }
    throw error;
  }
}

export async function deleteCategory(
  categoryId: string,
  actorAccountId: string,
) {
  return db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(schema.categoryTable)
      .where(eq(schema.categoryTable.id, categoryId))
      .for("update");
    if (!category) throw new CustomError("Category not found", 404);

    const detachedProducts = await tx
      .delete(schema.productsToCategoriesTable)
      .where(eq(schema.productsToCategoriesTable.categoryId, categoryId))
      .returning({ productId: schema.productsToCategoriesTable.productId });
    const detachedProductIds = [
      ...new Set(detachedProducts.map(({ productId }) => productId)),
    ];

    if (detachedProductIds.length > 0) {
      await tx
        .update(schema.productTable)
        .set({ updatedAt: new Date() })
        .where(inArray(schema.productTable.id, detachedProductIds));
    }

    await tx
      .delete(schema.categoryTable)
      .where(eq(schema.categoryTable.id, categoryId));
    await recordAdminActivityWithTx(tx, {
      actorAccountId,
      eventType: "category.deleted",
      entityType: "category",
      entityId: categoryId,
      metadata: {
        name: category.name,
        detachedProductCount: detachedProductIds.length,
      },
    });
    return {
      id: categoryId,
      deleted: true,
      detachedProductCount: detachedProductIds.length,
    };
  });
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

export async function getProductById(productId: string, requesterId?: string) {
  const product = await db.query.productTable.findFirst({
    where: eq(schema.productTable.id, productId),
    with: {
      advertisement: true,
      variants: {
        orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
      },
      productsToCategories: {
        with: {
          category: true,
        },
      },
    },
  });

  if (product && requesterId) {
    const scope = await resolveAdminSellerScope(requesterId);
    if (scope.sellerId && scope.sellerId !== product.sellerId) {
      throw new CustomError("You cannot view another seller's product", 403);
    }
  }
  return product ? withProductVariantAggregates(product, "all") : product;
}

export async function softDeleteProduct(
  productId: string,
  actorAccountId: string,
) {
  const actor = await getActiveAdminAccount(actorAccountId);
  if (actor.role === "employee") {
    throw new CustomError("Employees cannot delete products", 403);
  }
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(schema.productTable)
      .where(eq(schema.productTable.id, productId))
      .for("update");
    if (!product) throw new CustomError("Product not found", 404);
    if (actor.role !== "admin" && product.sellerId !== actor.id) {
      throw new CustomError("You cannot delete another seller's product", 403);
    }
    if (!product.deletedAt) {
      await tx
        .update(schema.productTable)
        .set({
          status: "inactive",
          deletedAt: new Date(),
          deletedByAccountId: actorAccountId,
          updatedAt: new Date(),
        })
        .where(eq(schema.productTable.id, productId));
      await tx
        .update(schema.productVariantTable)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(schema.productVariantTable.productId, productId));
      const advertisements = await tx
        .select({ id: schema.advertisementTable.id })
        .from(schema.advertisementTable)
        .where(eq(schema.advertisementTable.productId, productId));
      if (advertisements.length) {
        await tx
          .update(schema.advertisementStatsTable)
          .set({ status: "paused", updatedAt: new Date() })
          .where(
            and(
              inArray(
                schema.advertisementStatsTable.advertisementId,
                advertisements.map(({ id }) => id),
              ),
              ne(schema.advertisementStatsTable.status, "archived"),
            ),
          );
      }
      await recordAdminActivityWithTx(tx, {
        actorAccountId,
        sellerId: product.sellerId,
        eventType: "product.soft_deleted",
        entityType: "product",
        entityId: productId,
      });
    }
    // Keep cart availability consistent with the product lifecycle. This also
    // makes a repeated soft-delete repair any stale cart rows left by older
    // application versions.
    await tx
      .delete(schema.cartItemTable)
      .where(eq(schema.cartItemTable.productId, productId));
    await tx
      .delete(schema.collectionTable)
      .where(eq(schema.collectionTable.productId, productId));

    return tx.query.productTable.findFirst({
      where: eq(schema.productTable.id, productId),
      with: { variants: true, advertisement: { with: { stats: true } } },
    });
  });
}

export async function permanentlyDeleteProduct(
  productId: string,
  actorAccountId: string,
) {
  if (!(await isAccountAdmin(actorAccountId))) {
    throw new CustomError("Only a platform admin can permanently delete products", 403);
  }
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(schema.productTable)
      .where(eq(schema.productTable.id, productId))
      .for("update");
    if (!product) throw new CustomError("Product not found", 404);

    const [[orders], [advertisements], [cartItems], [collections], [chatrooms]] =
      await Promise.all([
        tx.select({ total: count() }).from(schema.orderItemTable).where(eq(schema.orderItemTable.productId, productId)),
        tx.select({ total: count() }).from(schema.advertisementTable).where(eq(schema.advertisementTable.productId, productId)),
        tx.select({ total: count() }).from(schema.cartItemTable).where(eq(schema.cartItemTable.productId, productId)),
        tx.select({ total: count() }).from(schema.collectionTable).where(eq(schema.collectionTable.productId, productId)),
        tx.select({ total: count() }).from(schema.chatRoomTable).where(eq(schema.chatRoomTable.productId, productId)),
      ]);
    const blockers = {
      orderItems: orders.total,
      advertisements: advertisements.total,
      cartItems: cartItems.total,
      collections: collections.total,
      chatrooms: chatrooms.total,
    };
    if (Object.values(blockers).some((value) => value > 0)) {
      throw new CustomError(
        `Product has business references: ${JSON.stringify(blockers)}`,
        409,
      );
    }
    await tx
      .delete(schema.productsToCategoriesTable)
      .where(eq(schema.productsToCategoriesTable.productId, productId));
    await tx
      .delete(schema.productVariantTable)
      .where(eq(schema.productVariantTable.productId, productId));
    await tx.delete(schema.productTable).where(eq(schema.productTable.id, productId));
    await recordAdminActivityWithTx(tx, {
      actorAccountId,
      sellerId: product.sellerId,
      eventType: "product.permanently_deleted",
      entityType: "product",
      entityId: productId,
    });
    return { id: productId, deleted: true, permanent: true };
  });
}

export async function getProductWithSellerById(productId: string) {
  const product = await db.query.productTable.findFirst({
    where: eq(schema.productTable.id, productId),
    with: {
      advertisement: true,
      variants: {
        where: eq(schema.productVariantTable.status, "active"),
        orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
      },
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

  return product ? withProductVariantAggregates(product) : product;
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
  variants?: ProductVariantWriteInput[],
  requesterId?: string,
) {
  if (requesterId) {
    const actor = await getActiveAdminAccount(requesterId);
    if (actor.role === "employee") {
      throw new CustomError("Employees cannot create products", 403);
    }
    if (actor.role === "seller" && productData.sellerId !== actor.id) {
      throw new CustomError("A seller may create products only for itself", 403);
    }
    const seller = await getActiveAdminAccount(productData.sellerId);
    if (seller.role !== "seller") {
      throw new CustomError("sellerId must identify an active seller", 400);
    }
  }
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
    const variantInputs = variants ?? [];
    validateProductVariantMode(variantInputs);
    const variantValues = variantInputs.map((variant) =>
      buildCreateVariantValues("", variant),
    );
    // 1. Create the product
    const [newProduct] = await tx
      .insert(schema.productTable)
      .values(productData)
      .returning();

    await tx
      .insert(schema.productVariantTable)
      .values(
        variantValues.map((variant) => ({
          ...variant,
          productId: newProduct.id,
        })),
      );

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
        variants: {
          orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
        },
      },
    }).then((product) =>
      product ? withProductVariantAggregates(product, "all") : product,
    );
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
  variants?: ProductVariantWriteInput[],
  requesterId?: string,
) {
  const actor = requesterId ? await getActiveAdminAccount(requesterId) : undefined;
  if (actor?.role === "employee") {
    throw new CustomError("Employees cannot update products", 403);
  }
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
    const [existingProduct] = await tx
      .select({
        deletedAt: schema.productTable.deletedAt,
        sellerId: schema.productTable.sellerId,
      })
      .from(schema.productTable)
      .where(eq(schema.productTable.id, productId))
      .for("update");
    if (!existingProduct) throw new CustomError("Product not found", 404);
    if (existingProduct.deletedAt) {
      throw new CustomError("A deleted product cannot be updated", 409);
    }
    if (actor?.role === "seller" && existingProduct.sellerId !== actor.id) {
      throw new CustomError("You cannot update another seller's product", 403);
    }
    if (
      actor?.role === "seller" &&
      productData.sellerId &&
      productData.sellerId !== actor.id
    ) {
      throw new CustomError("A seller cannot transfer product ownership", 403);
    }
    // 1. Update the product itself
    const [updatedProduct] = await tx
      .update(schema.productTable)
      .set({ ...productData, updatedAt: new Date() })
      .where(eq(schema.productTable.id, productId))
      .returning();

    if (!updatedProduct) {
      throw new CustomError("Product not found", 404);
    }

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

    let persistedVariants: schema.ProductVariant[] | undefined;
    if (variants) {
      const existingVariants = await tx
        .select()
        .from(schema.productVariantTable)
        .where(eq(schema.productVariantTable.productId, productId))
        .orderBy(schema.productVariantTable.id)
        .for("update");
      const existingVariantById = new Map(
        existingVariants.map((variant) => [variant.id, variant]),
      );

      for (const variant of variants) {
        if (variant.id) {
          const existingVariant = existingVariantById.get(variant.id);

          if (!existingVariant || existingVariant.productId !== productId) {
            throw new CustomError("Product variant not found", 404);
          }

          if (
            variant.stock !== undefined &&
            variant.stock < existingVariant.reserve
          ) {
            throw new CustomError(
              "Variant stock cannot be lower than reserved quantity",
              400,
            );
          }

          await tx
            .update(schema.productVariantTable)
            .set({
              ...(variant.name !== undefined ? { name: variant.name } : {}),
              ...(variant.sku !== undefined ? { sku: variant.sku } : {}),
              ...(variant.price !== undefined ? { price: variant.price } : {}),
              ...(variant.images !== undefined ? { images: variant.images } : {}),
              ...(variant.optionValues !== undefined
                ? { optionValues: variant.optionValues }
                : {}),
              ...(variant.stock !== undefined ? { stock: variant.stock } : {}),
              ...(variant.sortOrder !== undefined
                ? { sortOrder: variant.sortOrder }
                : {}),
              ...(variant.status !== undefined ? { status: variant.status } : {}),
              ...(variant.metadata !== undefined
                ? { metadata: variant.metadata }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.productVariantTable.id, variant.id));
        } else {
          await tx
            .insert(schema.productVariantTable)
            .values(buildCreateVariantValues(productId, variant));
        }
      }

      persistedVariants = await tx.query.productVariantTable.findMany({
        where: eq(schema.productVariantTable.productId, productId),
      });
      validateProductVariantMode(persistedVariants);
    }

    if (updatedProduct.status === "inactive") {
      await tx
        .delete(schema.cartItemTable)
        .where(eq(schema.cartItemTable.productId, productId));
    } else if (persistedVariants) {
      const inactiveVariantIds = persistedVariants
        .filter((variant) => variant.status === "inactive")
        .map((variant) => variant.id);

      if (inactiveVariantIds.length > 0) {
        await tx
          .delete(schema.cartItemTable)
          .where(
            inArray(
              schema.cartItemTable.productVariantId,
              inactiveVariantIds,
            ),
          );
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
        variants: {
          orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
        },
      },
    }).then((product) =>
      product ? withProductVariantAggregates(product, "all") : product,
    );
  });
}

export interface ListAdminProductsParams extends PaginationParams {
  categoryId?: string;
  search?: string;
  status?: schema.NewProduct["status"];
  minPrice?: number;
  maxPrice?: number;
  sellerId?: string;
  requesterId: string;
  includeDeleted?: boolean;
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
  requesterId,
  includeDeleted,
  minPrice,
  maxPrice,
}: ListAdminProductsParams) {
  const pagination = getPagination(page, limit);
  const conditions: (SQL | undefined)[] = [];

  // Only return products that have an associated seller.
  conditions.push(isNotNull(schema.productTable.sellerId));
  const scope = await resolveAdminSellerScope(requesterId, sellerId);
  if (!includeDeleted || !scope.isPlatformAdmin) {
    conditions.push(isNull(schema.productTable.deletedAt));
  }

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

  if (scope.sellerId) {
    conditions.push(eq(schema.productTable.sellerId, scope.sellerId));
  }

  if (minPrice !== undefined) {
    conditions.push(
      gte(minimumVariantPrice(schema.productTable.id, false), minPrice),
    );
  }

  if (maxPrice !== undefined) {
    conditions.push(
      lte(minimumVariantPrice(schema.productTable.id, false), maxPrice),
    );
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
      variants: {
        orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
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
    products: products.map((product) =>
      withProductVariantAggregates(product, "all"),
    ),
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
  conditions.push(isNull(schema.productTable.deletedAt));

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
    conditions.push(
      gte(minimumVariantPrice(schema.productTable.id, true), minPrice),
    );
  }

  if (maxPrice !== undefined) {
    conditions.push(
      lte(minimumVariantPrice(schema.productTable.id, true), maxPrice),
    );
  }

  conditions.push(activeVariantAvailabilityCondition(schema.productTable.id));

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
      variants: {
        where: eq(schema.productVariantTable.status, "active"),
        orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
      },
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
    products: products.map((product) => withProductVariantAggregates(product)),
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
  requesterId,
}: {
  productId: string;
  startAt?: Date;
  endAt?: Date;
  requesterId?: string;
}) {
  const product = await db.query.productTable.findFirst({
    where: eq(schema.productTable.id, productId),
  });
  if (!product) throw new CustomError("Product not found", 404);
  if (requesterId) {
    const scope = await resolveAdminSellerScope(requesterId);
    if (scope.sellerId && scope.sellerId !== product.sellerId) {
      throw new CustomError("You cannot view another seller's product", 403);
    }
  }

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
