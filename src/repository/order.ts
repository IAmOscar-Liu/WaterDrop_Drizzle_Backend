import { and, count, eq, gte, inArray, lt, lte, SQL, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import { upsertCartItem } from "./cart";

/**
 * Creates a new order, inserts order items, and updates product reserves.
 * @param orderData The data for the new order.
 * @param items The items to be included in the order.
 * @returns The newly created order with its items and product relations.
 */
export async function createOrder(
  orderData: schema.NewOrder,
  items: Array<Omit<schema.NewOrderItem, "orderId" | "lineTotal">>,
) {
  return db.transaction(async (tx) => {
    // check if each item's quantity less or equal to (product.stock - product.reserve)
    if (items.length > 0) {
      // 1. Sort product IDs to prevent deadlocks when locking multiple rows
      const productIds = items.map((item) => item.productId).sort();

      // 2. Fetch products with "FOR UPDATE" lock
      // This ensures no other transaction can modify these rows until this transaction commits/rollbacks
      const products = await tx
        .select()
        .from(schema.productTable)
        .where(inArray(schema.productTable.id, productIds))
        .for("update");

      const productMap = new Map(products.map((p) => [p.id, p]));

      const errors = [];
      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product) {
          errors.push({
            productId: item.productId,
            productName: item.productNameAtSale,
            reason: "Not found",
          });
        } else {
          if (item.quantity > product.stock - product.reserve) {
            errors.push({
              productId: item.productId,
              productName: item.productNameAtSale,
              reason: "Insufficient stock",
              quantity: item.quantity,
              remaining: product.stock - product.reserve,
            });
          }
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

    console.log("New Order Created:", newOrder.id);

    await tx.insert(schema.orderItemTable).values(
      items.map((item) => ({
        ...item,
        pendingQuantity: item.quantity,
        orderId: newOrder.id,
        lineTotal: item.unitPriceAtSale * item.quantity,
      })),
    );

    // Update each product's reserve
    await Promise.all(
      items.map((item) =>
        tx
          .update(schema.productTable)
          .set({
            reserve: sql`COALESCE(${schema.productTable.reserve}, 0) + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.productTable.id, item.productId)),
      ),
    );

    return tx.query.orderTable.findFirst({
      where: eq(schema.orderTable.id, newOrder.id),
      with: {
        items: {
          with: {
            product: true,
          },
        },
      },
    });
  });
}

export async function updateOrderStatus(
  orderId: string,
  status: Exclude<schema.NewOrder["orderStatus"], undefined>,
  metadata?: schema.NewOrder["metadata"],
) {
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

    // If the new status is "paid", remove the corresponding items from the cart
    if (status === "paid") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
          promises.push(upsertCartItem(order.userId, item.productId, 0));
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
      if (order.discountCoin && order.discountCoin > 0) {
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
          }
        }
      }
      await Promise.all(promises);
    } else if (status !== "pending") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
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
      await Promise.all(promises);
    }

    // Update the order status
    await tx
      .update(schema.orderTable)
      .set({
        orderStatus: status,
        updatedAt: new Date(),
        completedAt: status === "paid" ? new Date() : null,
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
          },
        },
        deliveries: true,
      },
    });
  });
}

export async function expireOrders(expireInMs: number) {
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
    expiredOrders.map((order) => updateOrderStatus(order.id, "expired")),
  );
  return results;
}

export interface ListOrdersParams {
  userId: string;
  page?: number;
  limit?: number;
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
  const offset = (page - 1) * limit;

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.orderTable)
    .where(
      and(
        inArray(schema.orderTable.orderStatus, statusIn),
        eq(schema.orderTable.userId, userId),
      ),
    );

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated orders with their related items and products
  const orders = await db.query.orderTable.findMany({
    limit,
    offset,
    where: and(
      inArray(schema.orderTable.orderStatus, statusIn),
      eq(schema.orderTable.userId, userId),
    ),
    // with: {
    //   items: {
    //     with: {
    //       product: true,
    //     },
    //   },
    //   delivery: true,
    // },
    orderBy: (orders, { desc, asc }) => [
      order === "asc" ? asc(orders.createdAt) : desc(orders.createdAt),
    ],
  });

  return { orders, total, page, limit, totalPages };
}

export interface ListAdminOrdersParams {
  page?: number;
  limit?: number;
  accountId: string;
  userId?: string;
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
  status,
  order = "desc",
  startDate,
  endDate,
}: ListAdminOrdersParams) {
  const offset = (page - 1) * limit;
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

  if (status) {
    conditions.push(eq(schema.orderTable.orderStatus, status));
  }

  if (startDate) {
    conditions.push(gte(schema.orderTable.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(schema.orderTable.createdAt, endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.orderTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated orders
  const orders = await db.query.orderTable.findMany({
    where: whereClause,
    limit,
    offset,
    with: {
      items: {
        columns: {
          id: true,
          productId: true,
          productNameAtSale: true,
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
        },
      },
    },
    orderBy: (orders, { desc, asc }) => [
      order === "asc" ? asc(orders.createdAt) : desc(orders.createdAt),
    ],
  });

  return { orders, total, page, limit, totalPages };
}

export async function getOrderById(orderId: string) {
  return db.query.orderTable.findFirst({
    where: eq(schema.orderTable.id, orderId),
    with: {
      items: {
        with: {
          product: true,
        },
      },
      deliveries: {
        with: {
          items: {
            columns: {
              id: true,
              productId: true,
              productNameAtSale: true,
            },
          },
        },
      },
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function getOrderByMerchantTradeNo(merchantTradeNo: string) {
  return db.query.orderTable.findFirst({
    where: eq(schema.orderTable.merchantTradeNo, merchantTradeNo),
  });
}

export async function createMerchantTrade({
  merchantTradeNo,
  orderId,
  productIds,
}: {
  merchantTradeNo: string;
  orderId: string;
  productIds: string[];
}) {
  const [merchantTrade] = await db
    .insert(schema.merchantTradeTable)
    .values({
      merchantTradeNo,
      orderId,
      productIds,
    })
    .returning();
  console.log(
    `merchantTrade created successfully, merchantTradeNo: ${merchantTradeNo}`,
  );
  return merchantTrade;
}

export async function getMerchantTradeByMerchantTradeNo(
  merchantTradeNo: string,
) {
  return db.query.merchantTradeTable.findFirst({
    where: eq(schema.merchantTradeTable.merchantTradeNo, merchantTradeNo),
  });
}
