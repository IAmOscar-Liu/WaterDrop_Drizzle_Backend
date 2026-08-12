import {
  and,
  count,
  eq,
  gte,
  inArray,
  like,
  lt,
  lte,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import { isPlainObject } from "../lib/general";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

type OrderItemWithProductVariant = {
  product?: schema.Product | null;
  variant?: schema.ProductVariant | null;
  variantNameAtSale?: string | null;
  variantSkuAtSale?: string | null;
  variantOptionValuesAtSale?: unknown;
};

function withVariantAtSaleDisplay<T extends OrderItemWithProductVariant>(item: T) {
  const {
    product,
    variant: _variant,
    variantNameAtSale,
    variantSkuAtSale,
    variantOptionValuesAtSale,
    ...rest
  } = item;
  const productWithoutVariant = product
    ? (() => {
        const {
          variant: _productVariant,
          ...productRest
        } = product as typeof product & { variant?: unknown };
        return productRest;
      })()
    : product;

  return {
    ...rest,
    product: productWithoutVariant,
    variantAtSale: {
      name: variantNameAtSale ?? null,
      sku: variantSkuAtSale ?? null,
      optionValues: variantOptionValuesAtSale ?? null,
    },
  };
}

/**
 * Creates a new order, inserts order items, and updates product reserves.
 * @param orderData The data for the new order.
 * @param items The items to be included in the order.
 * @returns The newly created order with its items and product relations.
 */
export async function createOrder({
  orderData,
  items,
  idempotencyKey,
}: {
  orderData: schema.NewOrder;
  items: Array<Omit<schema.NewOrderItem, "orderId" | "lineTotal">>;
  idempotencyKey: string;
}) {
  const existingIdempotencyKey = await db.query.idempotencyKeyTable.findFirst({
    where: eq(schema.idempotencyKeyTable.key, idempotencyKey),
  });

  if (existingIdempotencyKey) {
    throw new CustomError("Duplicate order request", 409);
  }

  return db.transaction(async (tx) => {
    const variantIds = items.map((item) => item.productVariantId);

    if (variantIds.some((variantId) => !variantId)) {
      throw new CustomError("productVariantId is required for every item", 400);
    }

    const requestedQuantityByVariantId = new Map<string, number>();
    for (const item of items) {
      requestedQuantityByVariantId.set(
        item.productVariantId!,
        (requestedQuantityByVariantId.get(item.productVariantId!) ?? 0) +
          item.quantity,
      );
    }

    const variantMap = new Map<string, schema.ProductVariant>();

    if (items.length > 0) {
      const sortedVariantIds = [
        ...new Set(items.map((item) => item.productVariantId!)),
      ].sort();

      const variants = await tx
        .select()
        .from(schema.productVariantTable)
        .where(inArray(schema.productVariantTable.id, sortedVariantIds))
        .for("update");

      variants.forEach((variant) => {
        variantMap.set(variant.id, variant);
      });

      const errors = [];
      for (const item of items) {
        const variant = variantMap.get(item.productVariantId!);
        if (!variant || variant.productId !== item.productId) {
          errors.push({
            productId: item.productId,
            productVariantId: item.productVariantId,
            productName: item.productNameAtSale,
            reason: "Variant not found",
          });
          continue;
        }

        if (variant.status !== "active") {
          errors.push({
            productId: item.productId,
            productVariantId: item.productVariantId,
            productName: item.productNameAtSale,
            reason: "Variant inactive",
          });
          continue;
        }

        const requestedQuantity = requestedQuantityByVariantId.get(
          item.productVariantId!,
        )!;
        const remaining = variant.stock - variant.reserve;
        if (requestedQuantity > remaining) {
          errors.push({
            productId: item.productId,
            productVariantId: item.productVariantId,
            productName: item.productNameAtSale,
            reason: "Insufficient stock",
            quantity: requestedQuantity,
            remaining,
          });
        }
      }

      if (errors.length > 0) {
        throw new CustomError(JSON.stringify({ error: errors }), 400);
      }
    }

    const [newOrder] = await tx
      .insert(schema.orderTable)
      .values(orderData)
      .returning();

    await Promise.all([
      tx.insert(schema.orderItemTable).values(
        items.map((item) => ({
          ...item,
          variantNameAtSale:
            item.variantNameAtSale ?? variantMap.get(item.productVariantId!)?.name,
          variantSkuAtSale:
            item.variantSkuAtSale ?? variantMap.get(item.productVariantId!)?.sku,
          variantOptionValuesAtSale:
            item.variantOptionValuesAtSale ??
            variantMap.get(item.productVariantId!)?.optionValues,
          pendingQuantity: item.quantity,
          orderId: newOrder.id,
          lineTotal: item.unitPriceAtSale * item.quantity,
        })),
      ),

      // Update each variant's reserve; product reserve is kept in sync during
      // the transition while product-level stock fields still exist.
      ...items.map((item) =>
        tx
          .update(schema.productVariantTable)
          .set({
            reserve: sql`COALESCE(${schema.productVariantTable.reserve}, 0) + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.productVariantTable.id, item.productVariantId!)),
      ),

      ...items.map((item) =>
        tx
          .update(schema.productTable)
          .set({
            reserve: sql`COALESCE(${schema.productTable.reserve}, 0) + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.productTable.id, item.productId)),
      ),

      // Insert the idempotency key after successfully creating the order and related items to prevent duplicate processing
      tx.insert(schema.idempotencyKeyTable).values({
        key: idempotencyKey,
        requestPath: "/orders", // You can adjust this to be more specific if needed
        requestData: {
          orderData,
          items,
        },
      }),
    ]);

    return tx.query.orderTable.findFirst({
      where: eq(schema.orderTable.id, newOrder.id),
      with: {
        items: {
          with: {
            product: true,
            variant: true,
          },
        },
      },
    }).then((order) =>
      order
        ? {
            ...order,
            items: order.items.map(withVariantAtSaleDisplay),
          }
        : order,
    );
  });
}

export async function updateCompleteEmailSent({
  orderId,
  completeEmailSent,
}: {
  orderId: string;
  completeEmailSent: boolean;
}) {
  const [updatedOrder] = await db
    .update(schema.orderTable)
    .set({ completeEmailSent, updatedAt: new Date() })
    .where(eq(schema.orderTable.id, orderId))
    .returning();

  return updatedOrder;
}

export async function updateIdempotencyKey({
  idempotencyKey,
  status,
  responseData,
}: {
  idempotencyKey: string;
  status: "started" | "completed" | "failed";
  responseData?: unknown;
}) {
  const [updatedIdempotencyKey] = await db
    .update(schema.idempotencyKeyTable)
    .set({
      status,
      ...(responseData !== undefined ? { responseData } : {}),
    })
    .where(eq(schema.idempotencyKeyTable.key, idempotencyKey))
    .returning();

  return updatedIdempotencyKey;
}

export async function updateOrderStatus({
  orderId,
  status,
  metadata,
  paymentInfo,
}: {
  orderId: string;
  status: Exclude<schema.NewOrder["orderStatus"], undefined>;
  metadata?: schema.NewOrder["metadata"];
  paymentInfo?: schema.NewOrder["paymentInfo"];
}) {
  return db.transaction(async (tx) => {
    // First, get the order to access its items and user ID
    const order = await tx.query.orderTable.findFirst({
      where: eq(schema.orderTable.id, orderId),
      with: {
        items: {
          with: {
            product: true,
          },
        },
      },
    });

    if (!order) throw new CustomError("Order not found", 404);

    const coinInfo: Record<string, number> = {};

    // If the new status is "paid", remove the corresponding items from the cart
    if (status === "paid") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
          if (!item.productVariantId) {
            throw new CustomError("Order item productVariantId is required", 400);
          }

          if (order.orderStatus === "pending") {
            promises.push(
              tx
                .delete(schema.cartItemTable)
                .where(
                  and(
                    eq(schema.cartItemTable.userId, order.userId),
                    eq(
                      schema.cartItemTable.productVariantId,
                      item.productVariantId,
                    ),
                  ),
                ),
            );
          }
          promises.push(
            tx
              .update(schema.productVariantTable)
              .set({
                reserve: sql`COALESCE(${schema.productVariantTable.reserve}, 0) - ${item.pendingQuantity}`,
                stock: sql`COALESCE(${schema.productVariantTable.stock}, 0) - ${item.pendingQuantity}`,
                updatedAt: new Date(),
              })
              .where(eq(schema.productVariantTable.id, item.productVariantId)),
          );
          promises.push(
            tx
              .update(schema.productTable)
              .set({
                reserve: sql`COALESCE(${schema.productTable.reserve}, 0) - ${item.pendingQuantity}`,
                stock: sql`COALESCE(${schema.productTable.stock}, 0) - ${item.pendingQuantity}`,
                updatedAt: new Date(),
              })
              .where(eq(schema.productTable.id, item.productId)),
          );
          promises.push(
            tx
              .update(schema.orderItemTable)
              .set({
                pendingQuantity: 0,
                updatedAt: new Date(),
              })
              .where(eq(schema.orderItemTable.id, item.id)),
          );
        }
      }
      if (
        order.orderStatus === "pending" &&
        order.discountCoin &&
        order.discountCoin > 0
      ) {
        // Deduct the used discount coins from the user's balance
        promises.push(
          tx
            .update(schema.userTable)
            .set({
              coins: sql`${schema.userTable.coins} - ${order.discountCoin}`,
            })
            .where(eq(schema.userTable.id, order.userId)),
        );

        // Update coinsSpent in userMonthlyCoinStatTable
        let remainingDiscountCoins = order.discountCoin;

        // 1. Find rows where expired is false, ordered by month (fartherest first)
        const monthlyStats = await tx.query.userMonthlyCoinStatTable.findMany({
          where: and(
            eq(schema.userMonthlyCoinStatTable.userId, order.userId),
            eq(schema.userMonthlyCoinStatTable.expired, false),
          ),
          orderBy: (stats, { asc }) => [asc(stats.month)],
        });

        for (const stat of monthlyStats) {
          if (remainingDiscountCoins <= 0) break; // No more discount coins to apply

          const availableCoinsToSpend = stat.coinsEarned - stat.coinsSpent;

          if (availableCoinsToSpend > 0) {
            const amountToSpendInThisMonth = Math.min(
              remainingDiscountCoins,
              availableCoinsToSpend,
            );

            promises.push(
              tx
                .update(schema.userMonthlyCoinStatTable)
                .set({
                  coinsSpent: sql`${schema.userMonthlyCoinStatTable.coinsSpent} + ${amountToSpendInThisMonth}`,
                })
                .where(
                  and(
                    eq(schema.userMonthlyCoinStatTable.userId, order.userId),
                    eq(schema.userMonthlyCoinStatTable.month, stat.month),
                  ),
                ),
            );
            remainingDiscountCoins -= amountToSpendInThisMonth;
            coinInfo[stat.month] = amountToSpendInThisMonth;
          }
        }
      }
      await Promise.all(promises);
    } else if (status === "payment-processing") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
          if (!item.productVariantId) {
            throw new CustomError("Order item productVariantId is required", 400);
          }

          promises.push(
            tx
              .delete(schema.cartItemTable)
              .where(
                and(
                  eq(schema.cartItemTable.userId, order.userId),
                  eq(
                    schema.cartItemTable.productVariantId,
                    item.productVariantId,
                  ),
                ),
              ),
          );
        }
      }
      if (
        order.orderStatus === "pending" &&
        order.discountCoin &&
        order.discountCoin > 0
      ) {
        // Deduct the used discount coins from the user's balance
        promises.push(
          tx
            .update(schema.userTable)
            .set({
              coins: sql`${schema.userTable.coins} - ${order.discountCoin}`,
            })
            .where(eq(schema.userTable.id, order.userId)),
        );

        // Update coinsSpent in userMonthlyCoinStatTable
        let remainingDiscountCoins = order.discountCoin;

        // 1. Find rows where expired is false, ordered by month (fartherest first)
        const monthlyStats = await tx.query.userMonthlyCoinStatTable.findMany({
          where: and(
            eq(schema.userMonthlyCoinStatTable.userId, order.userId),
            eq(schema.userMonthlyCoinStatTable.expired, false),
          ),
          orderBy: (stats, { asc }) => [asc(stats.month)],
        });

        for (const stat of monthlyStats) {
          if (remainingDiscountCoins <= 0) break; // No more discount coins to apply

          const availableCoinsToSpend = stat.coinsEarned - stat.coinsSpent;

          if (availableCoinsToSpend > 0) {
            const amountToSpendInThisMonth = Math.min(
              remainingDiscountCoins,
              availableCoinsToSpend,
            );

            promises.push(
              tx
                .update(schema.userMonthlyCoinStatTable)
                .set({
                  coinsSpent: sql`${schema.userMonthlyCoinStatTable.coinsSpent} + ${amountToSpendInThisMonth}`,
                })
                .where(
                  and(
                    eq(schema.userMonthlyCoinStatTable.userId, order.userId),
                    eq(schema.userMonthlyCoinStatTable.month, stat.month),
                  ),
                ),
            );
            remainingDiscountCoins -= amountToSpendInThisMonth;
            coinInfo[stat.month] = amountToSpendInThisMonth;
          }
        }
      }
      await Promise.all(promises);
    } else if (status !== "pending") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
          if (!item.productVariantId) {
            throw new CustomError("Order item productVariantId is required", 400);
          }

          promises.push(
            tx
              .update(schema.productVariantTable)
              .set({
                reserve: sql`COALESCE(${schema.productVariantTable.reserve}, 0) - ${item.pendingQuantity}`,
                updatedAt: new Date(),
              })
              .where(eq(schema.productVariantTable.id, item.productVariantId)),
          );
          promises.push(
            tx
              .update(schema.productTable)
              .set({
                reserve: sql`COALESCE(${schema.productTable.reserve}, 0) - ${item.pendingQuantity}`,
                updatedAt: new Date(),
              })
              .where(eq(schema.productTable.id, item.productId)),
          );
          promises.push(
            tx
              .update(schema.orderItemTable)
              .set({
                pendingQuantity: 0,
                updatedAt: new Date(),
              })
              .where(eq(schema.orderItemTable.id, item.id)),
          );
        }
      }
      if (
        order.orderStatus === "payment-processing" &&
        isPlainObject(order.coinInfo) &&
        Object.keys(order.coinInfo as Record<string, number>).length > 0
      ) {
        let coinSum = 0;
        for (const [month, coins] of Object.entries(
          order.coinInfo as Record<string, number>,
        )) {
          coinSum += coins;
          promises.push(
            tx
              .update(schema.userMonthlyCoinStatTable)
              .set({
                coinsSpent: sql`${schema.userMonthlyCoinStatTable.coinsSpent} - ${coins}`,
              })
              .where(
                and(
                  eq(schema.userMonthlyCoinStatTable.userId, order.userId),
                  eq(schema.userMonthlyCoinStatTable.month, month),
                ),
              ),
          );
        }
        promises.push(
          tx
            .update(schema.userTable)
            .set({
              coins: sql`${schema.userTable.coins} + ${coinSum}`,
            })
            .where(eq(schema.userTable.id, order.userId)),
        );
      }
      await Promise.all(promises);
    }

    // Update the order status
    await tx
      .update(schema.orderTable)
      .set({
        orderStatus: status,
        updatedAt: new Date(),
        completedAt: status === "paid" ? new Date() : null,
        ...(paymentInfo ? { paymentInfo } : {}),
        ...(Object.keys(coinInfo).length > 0 ? { coinInfo } : {}),
        ...(metadata
          ? {
              metadata,
              merchantTradeNo: (metadata as any).MerchantTradeNo ?? null,
            }
          : {}),
      })
      .where(eq(schema.orderTable.id, orderId));

    return tx.query.orderTable.findFirst({
      where: eq(schema.orderTable.id, orderId),
      with: {
        items: {
          with: {
            product: true,
            variant: true,
          },
        },
        deliveries: true,
      },
    }).then((order) =>
      order
        ? {
            ...order,
            items: order.items.map(withVariantAtSaleDisplay),
          }
        : order,
    );
  });
}

export async function deleteIdempotencyKeys(expireInMs: number) {
  const cutoffTime = new Date(Date.now() - expireInMs);

  return db
    .delete(schema.idempotencyKeyTable)
    .where(lt(schema.idempotencyKeyTable.updatedAt, cutoffTime));
}

export async function expirePendingOrders(expireInMs: number) {
  const cutoffTime = new Date(Date.now() - expireInMs);

  const expiredOrders = await db
    .select({ id: schema.orderTable.id })
    .from(schema.orderTable)
    .where(
      and(
        eq(schema.orderTable.orderStatus, "pending"),
        lt(schema.orderTable.createdAt, cutoffTime),
      ),
    );

  const results = await Promise.all(
    expiredOrders.map((order) =>
      updateOrderStatus({ orderId: order.id, status: "expired" }),
    ),
  );
  return results;
}

export async function expirePaymentProcessingOrders(expireInMs: number) {
  const cutoffTime = new Date(Date.now() - expireInMs);

  const expiredOrders = await db
    .select({ id: schema.orderTable.id })
    .from(schema.orderTable)
    .where(
      and(
        eq(schema.orderTable.orderStatus, "payment-processing"),
        lt(schema.orderTable.createdAt, cutoffTime),
      ),
    );

  const results = await Promise.all(
    expiredOrders.map((order) =>
      updateOrderStatus({ orderId: order.id, status: "expired" }),
    ),
  );
  return results;
}

export interface ListOrdersParams extends PaginationParams {
  userId: string;
  statusIn: Exclude<schema.NewOrder["orderStatus"], undefined>[];
  order?: "asc" | "desc";
}

export async function listOrders({
  page = 1,
  limit = 10,
  userId,
  statusIn,
  order = "desc",
}: ListOrdersParams) {
  const pagination = getPagination(page, limit);
  const whereClause = compactConditions([
    inArray(schema.orderTable.orderStatus, statusIn),
    eq(schema.orderTable.userId, userId),
  ]);

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.orderTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  // Query for the paginated orders with their related items and products
  const orders = await db.query.orderTable.findMany({
    limit: pagination.limit,
    offset: pagination.offset,
    where: whereClause,
    with: {
      items: {
        columns: {
          id: true,
          productId: true,
          productVariantId: true,
          productNameAtSale: true,
          variantNameAtSale: true,
          variantSkuAtSale: true,
          variantOptionValuesAtSale: true,
        },
      },
      deliveries: {
        columns: {
          id: true,
          merchantTradeNo: true,
          status: true,
          LogisticsType: true,
          LogisticsSubType: true,
          RtnCode: true,
          RtnMsg: true,
        },
      },
    },
    orderBy: (orders, { desc, asc }) => [
      order === "asc" ? asc(orders.createdAt) : desc(orders.createdAt),
    ],
  });

  return {
    orders: orders.map((order) => ({
      ...order,
      items: order.items.map(withVariantAtSaleDisplay),
    })),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export interface ListAdminOrdersParams extends PaginationParams {
  accountId: string;
  userId?: string;
  merchantTradeNo?: string;
  status: schema.NewOrder["orderStatus"];
  order?: "asc" | "desc";
  startDate?: Date;
  endDate?: Date;
}

export async function listAdminOrders({
  page = 1,
  limit = 10,
  accountId,
  userId,
  merchantTradeNo,
  status,
  order = "desc",
  startDate,
  endDate,
}: ListAdminOrdersParams) {
  const pagination = getPagination(page, limit);
  const conditions: (SQL | undefined)[] = [];

  const isAdmin = await isAccountAdmin(accountId);
  if (!isAdmin) {
    // Subquery to find order IDs that contain at least one product from the seller
    const sellerOrderIdsSubquery = db
      .selectDistinct({ orderId: schema.orderItemTable.orderId })
      .from(schema.orderItemTable)
      .innerJoin(
        schema.productTable,
        eq(schema.orderItemTable.productId, schema.productTable.id),
      )
      .where(eq(schema.productTable.sellerId, accountId));
    conditions.push(inArray(schema.orderTable.id, sellerOrderIdsSubquery));
  }

  if (userId) {
    conditions.push(eq(schema.orderTable.userId, userId));
  }

  const merchantTradeNoPrefix = merchantTradeNo?.trim();
  if (merchantTradeNoPrefix && merchantTradeNoPrefix.length >= 4) {
    const orderIdsWithDeliveryMerchantTradeNo = db
      .select({ orderId: schema.deliveryTable.orderId })
      .from(schema.deliveryTable)
      .where(
        like(schema.deliveryTable.merchantTradeNo, `${merchantTradeNoPrefix}%`),
      );

    conditions.push(
      or(
        like(schema.orderTable.merchantTradeNo, `${merchantTradeNoPrefix}%`),
        inArray(schema.orderTable.id, orderIdsWithDeliveryMerchantTradeNo),
      ),
    );
  }

  if (status) {
    conditions.push(eq(schema.orderTable.orderStatus, status));
  }

  if (startDate) {
    conditions.push(gte(schema.orderTable.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(schema.orderTable.createdAt, endDate));
  }

  const whereClause = compactConditions(conditions);

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.orderTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  // Query for the paginated orders
  const orders = await db.query.orderTable.findMany({
    where: whereClause,
    limit: pagination.limit,
    offset: pagination.offset,
    with: {
      items: {
        columns: {
          id: true,
          productId: true,
          productVariantId: true,
          productNameAtSale: true,
          variantNameAtSale: true,
          variantSkuAtSale: true,
          variantOptionValuesAtSale: true,
        },
      },
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      deliveries: {
        columns: {
          id: true,
          merchantTradeNo: true,
          status: true,
          LogisticsType: true,
          LogisticsSubType: true,
          RtnCode: true,
          RtnMsg: true,
        },
      },
    },
    orderBy: (orders, { desc, asc }) => [
      order === "asc" ? asc(orders.createdAt) : desc(orders.createdAt),
    ],
  });

  return {
    orders: orders.map((order) => ({
      ...order,
      items: order.items.map(withVariantAtSaleDisplay),
    })),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export async function getOrderStatusById(orderId: string) {
  const order = await db.query.orderTable.findFirst({
    where: eq(schema.orderTable.id, orderId),
    columns: {
      orderStatus: true,
    },
  });
  return order?.orderStatus;
}

type RefundableOrder = Pick<schema.Order, "orderStatus">;

type RefundableOrderDelivery = Pick<schema.Delivery, "id" | "status">;

type RefundableOrderItem = Pick<schema.OrderItem, "deliveryId" | "quantity"> & {
  refundItems: Pick<schema.RefundItem, "quantity" | "status">[];
};

function getRefundedQuantity(item: RefundableOrderItem) {
  return item.refundItems.reduce(
    (total, refundItem) =>
      refundItem.status === "cancelled" ? total : total + refundItem.quantity,
    0,
  );
}

function isRefundableOrderDelivery(
  order: RefundableOrder,
  delivery?: RefundableOrderDelivery,
) {
  if (order.orderStatus !== "paid" || !delivery) {
    return false;
  }

  if (
    (process.env.NODE_ENV === "stg" || process.env.NODE_ENV === "production") &&
    delivery.status !== "delivered"
  ) {
    return false;
  }

  return true;
}

function getRemainingRefundQuantity(
  order: RefundableOrder,
  delivery: RefundableOrderDelivery | undefined,
  item: RefundableOrderItem,
) {
  if (!item.deliveryId || !isRefundableOrderDelivery(order, delivery)) {
    return 0;
  }

  return Math.max(item.quantity - getRefundedQuantity(item), 0);
}

function canRefundOrderItem(
  order: RefundableOrder,
  delivery: RefundableOrderDelivery | undefined,
  item: RefundableOrderItem,
) {
  return getRemainingRefundQuantity(order, delivery, item) > 0;
}

export async function getOrderById(
  orderId: string,
  options?: { userId?: string; includeUser?: boolean },
) {
  const { userId, includeUser = true } = options ?? {};
  const order = await db.query.orderTable.findFirst({
    where: compactConditions([
      eq(schema.orderTable.id, orderId),
      userId ? eq(schema.orderTable.userId, userId) : undefined,
    ]),
    with: {
      items: {
        with: {
          product: true,
          variant: true,
          refundItems: {
            orderBy: (refundItems, { desc }) => [desc(refundItems.createdAt)],
          },
        },
      },
      deliveries: {
        with: {
          items: {
            columns: {
              id: true,
              productId: true,
              productVariantId: true,
              productNameAtSale: true,
              variantNameAtSale: true,
              variantSkuAtSale: true,
              variantOptionValuesAtSale: true,
            },
          },
          logs: {
            orderBy: (logs, { desc }) => [desc(logs.createdAt)],
          },
        },
      },
      ...(includeUser
        ? {
            user: {
              columns: {
                id: true,
                name: true,
                email: true,
              },
            },
          }
        : {}),
    },
  }).then((order) => {
    if (!order || includeUser) {
      return order;
    }

    const { user: _user, ...orderWithoutUser } = order as typeof order & {
      user?: unknown;
    };
    return orderWithoutUser;
  });

  if (!order) {
    return order;
  }

  const deliveryById = new Map(
    order.deliveries.map((delivery) => [delivery.id, delivery]),
  );

  // Reuse loaded order/delivery/refund relations instead of calling
  // refund.canRefund for each item and triggering duplicate queries.
  return {
    ...order,
    items: order.items.map((item) => {
      const delivery = item.deliveryId
        ? deliveryById.get(item.deliveryId)
        : undefined;
      const itemWithVariantAtSale = withVariantAtSaleDisplay(item);

      return {
        ...itemWithVariantAtSale,
        canRefund: canRefundOrderItem(order, delivery, item),
        remainingRefundQuantity: getRemainingRefundQuantity(
          order,
          delivery,
          item,
        ),
      };
    }),
    deliveries: order.deliveries.map((delivery) => ({
      ...delivery,
      items: delivery.items.map(withVariantAtSaleDisplay),
    })),
  };
}

export async function createMerchantTrade({
  merchantTradeNo,
  orderId,
  productIds,
  variantIds,
  cvsStoreInfo,
  shippingCost,
  shippingCostDeduction,
}: {
  merchantTradeNo: string;
  orderId: string;
  productIds: string[];
  variantIds: string[];
  cvsStoreInfo: Record<string, string>;
  shippingCost?: number;
  shippingCostDeduction?: number;
}) {
  const [merchantTrade] = await db
    .insert(schema.merchantTradeTable)
    .values({
      merchantTradeNo,
      orderId,
      productIds,
      variantIds,
      cvsStoreInfo,
      shippingCost,
      shippingCostDeduction,
    })
    .returning();
  return merchantTrade;
}

export async function getMerchantTradeByMerchantTradeNo(
  merchantTradeNo: string,
) {
  return db.query.merchantTradeTable.findFirst({
    where: eq(schema.merchantTradeTable.merchantTradeNo, merchantTradeNo),
  });
}
