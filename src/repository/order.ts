import { and, count, eq, gte, inArray, lte, SQL, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { upsertCartItem } from "./cart";

export async function createOrder(
  orderData: schema.NewOrder,
  items: Array<Omit<schema.NewOrderItem, "orderId" | "lineTotal">>
) {
  return db.transaction(async (tx) => {
    const [newOrder] = await tx
      .insert(schema.orderTable)
      .values(orderData)
      .returning();

    console.log("New Order Created:", newOrder.id);

    await tx.insert(schema.orderItemTable).values(
      items.map((item) => ({
        ...item,
        orderId: newOrder.id,
        lineTotal: item.unitPriceAtSale * item.quantity,
      }))
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
  metadata?: schema.NewOrder["metadata"]
) {
  return db.transaction(async (tx) => {
    // First, get the order to access its items and user ID
    const order = await getOrderById(orderId);
    if (!order) throw new CustomError("Order not found", 404);

    // If the new status is "paid", remove the corresponding items from the cart
    if (status === "paid") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
          promises.push(upsertCartItem(order.userId, item.productId, 0));
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
            .where(eq(schema.userTable.id, order.userId))
        );

        // Update coinsSpent in userMonthlyCoinStatTable
        let remainingDiscountCoins = order.discountCoin;

        // 1. Find rows where expired is false, ordered by month (fartherest first)
        const monthlyStats = await tx.query.userMonthlyCoinStatTable.findMany({
          where: and(
            eq(schema.userMonthlyCoinStatTable.userId, order.userId),
            eq(schema.userMonthlyCoinStatTable.expired, false)
          ),
          orderBy: (stats, { asc }) => [asc(stats.month)],
        });

        for (const stat of monthlyStats) {
          if (remainingDiscountCoins <= 0) break; // No more discount coins to apply

          const availableCoinsToSpend = stat.coinsEarned - stat.coinsSpent;

          if (availableCoinsToSpend > 0) {
            const amountToSpendInThisMonth = Math.min(
              remainingDiscountCoins,
              availableCoinsToSpend
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
                    eq(schema.userMonthlyCoinStatTable.month, stat.month)
                  )
                )
            );
            remainingDiscountCoins -= amountToSpendInThisMonth;
          }
        }
      }
      await Promise.all(promises);
    }

    // Update the order status
    await tx
      .update(schema.orderTable)
      .set({
        orderStatus: status,
        merchantTradeNo: (metadata as any).MerchantTradeNo ?? null,
        metadata,
        updatedAt: new Date(), // Ensure updatedAt is updated
      })
      .where(eq(schema.orderTable.id, orderId));

    // Return the fully updated order with its relations
    return getOrderById(orderId);
  });
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
        eq(schema.orderTable.userId, userId)
      )
    );

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated orders with their related items and products
  const orders = await db.query.orderTable.findMany({
    limit,
    offset,
    where: and(
      inArray(schema.orderTable.orderStatus, statusIn),
      eq(schema.orderTable.userId, userId)
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
  userId?: string;
  status: schema.NewOrder["orderStatus"];
  order?: "asc" | "desc";
  startDate?: Date;
  endDate?: Date;
}

export async function listAdminOrders({
  page = 1,
  limit = 10,
  userId,
  status,
  order = "desc",
  startDate,
  endDate,
}: ListAdminOrdersParams) {
  const offset = (page - 1) * limit;
  const conditions: (SQL | undefined)[] = [];

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
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      delivery: {
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
      delivery: true,
    },
  });
}

export async function getOrderByMerchantTradeNo(merchantTradeNo: string) {
  return db.query.orderTable.findFirst({
    where: eq(schema.orderTable.merchantTradeNo, merchantTradeNo),
  });
}

export async function createDelivery(deliveryData: schema.NewDelivery) {
  const [newDelivery] = await db
    .insert(schema.deliveryTable)
    .values(deliveryData)
    .returning();

  console.log("New Delivery Created:", newDelivery.id);

  return newDelivery;
}

export async function updateDelivery(
  deliveryId: string,
  updates: Omit<
    Partial<schema.NewDelivery>,
    "id" | "orderId" | "createdAt" | "updatedAt"
  >
) {
  const [updatedDelivery] = await db
    .update(schema.deliveryTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.deliveryTable.id, deliveryId))
    .returning();

  console.log("Delivery updated:", updatedDelivery.id);
  return updatedDelivery;
}
