import { and, count, desc, eq, gte, lte, ne, SQL, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import { isPlainObject } from "../lib/general";
import db from "../lib/initDB";

export interface GetRefundListParams {
  page?: number;
  limit?: number;
  userId?: string;
  productId?: string;
  startAt?: Date;
  endAt?: Date;
  status?: schema.RefundItem["status"];
}

function formatRefundRow(row: {
  refundItem: schema.RefundItem;
  orderItem: schema.OrderItem;
  product: schema.Product;
  order: schema.Order;
  user: {
    name: string | null;
    email: string;
  };
}) {
  return {
    ...row.refundItem,
    orderItem: {
      ...row.orderItem,
      product: row.product,
      order: {
        ...row.order,
        user: row.user,
      },
    },
  };
}

function getRefundFilters({
  userId,
  productId,
  startAt,
  endAt,
  status,
}: Omit<GetRefundListParams, "page" | "limit">) {
  const conditions: SQL[] = [];

  if (userId) {
    conditions.push(eq(schema.orderTable.userId, userId));
  }

  if (productId) {
    conditions.push(eq(schema.orderItemTable.productId, productId));
  }

  if (startAt) {
    conditions.push(gte(schema.refundItemTable.createdAt, startAt));
  }

  if (endAt) {
    conditions.push(lte(schema.refundItemTable.createdAt, endAt));
  }

  if (status) {
    conditions.push(eq(schema.refundItemTable.status, status));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function getRefundBaseQuery() {
  return db
    .select({
      refundItem: schema.refundItemTable,
      orderItem: schema.orderItemTable,
      product: schema.productTable,
      order: schema.orderTable,
      user: {
        name: schema.userTable.name,
        email: schema.userTable.email,
      },
    })
    .from(schema.refundItemTable)
    .innerJoin(
      schema.orderItemTable,
      eq(schema.refundItemTable.orderItemId, schema.orderItemTable.id),
    )
    .innerJoin(
      schema.productTable,
      eq(schema.orderItemTable.productId, schema.productTable.id),
    )
    .innerJoin(
      schema.orderTable,
      eq(schema.orderItemTable.orderId, schema.orderTable.id),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.orderTable.userId, schema.userTable.id),
    );
}

export async function getRefundList({
  page = 1,
  limit = 10,
  userId,
  productId,
  startAt,
  endAt,
  status,
}: GetRefundListParams = {}) {
  const offset = (page - 1) * limit;
  const whereClause = getRefundFilters({
    userId,
    productId,
    startAt,
    endAt,
    status,
  });

  const [totalResult] = await db
    .select({ total: count() })
    .from(schema.refundItemTable)
    .innerJoin(
      schema.orderItemTable,
      eq(schema.refundItemTable.orderItemId, schema.orderItemTable.id),
    )
    .innerJoin(
      schema.orderTable,
      eq(schema.orderItemTable.orderId, schema.orderTable.id),
    )
    .where(whereClause);

  const rows = await getRefundBaseQuery()
    .where(whereClause)
    .orderBy(desc(schema.refundItemTable.createdAt))
    .limit(limit)
    .offset(offset);

  const total = totalResult.total;
  const totalPages = Math.ceil(total / limit);

  return {
    refunds: rows.map(formatRefundRow),
    total,
    page,
    limit,
    totalPages,
  };
}

export async function getRefundById(refundItemId: string) {
  const [row] = await getRefundBaseQuery().where(
    eq(schema.refundItemTable.id, refundItemId),
  );

  return row ? formatRefundRow(row) : undefined;
}

export async function createRefund(item: schema.NewRefundItem) {
  return db.transaction(async (tx) => {
    // 1. Lock the order item so concurrent refunds cannot over-refund it.
    const [orderItem] = await tx
      .select()
      .from(schema.orderItemTable)
      .where(eq(schema.orderItemTable.id, item.orderItemId))
      .for("update");

    if (!orderItem) {
      throw new CustomError(
        JSON.stringify({
          error: [
            {
              orderItemId: item.orderItemId,
              reason: "Order item not found",
            },
          ],
        }),
        400,
      );
    }

    const errors = [];

    // 2. Check that the order is paid before allowing a refund.
    const [order] = await tx
      .select()
      .from(schema.orderTable)
      .where(eq(schema.orderTable.id, orderItem.orderId))
      .for("update");

    if (!order) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Order not found",
      });
    } else if (order.orderStatus !== "paid") {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Order is not paid",
        orderStatus: order.orderStatus,
      });
    }

    // 3. Check that the delivery is delivered before allowing a refund.
    if (!orderItem.deliveryId) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Order item delivery not found",
      });
    } else {
      const [delivery] = await tx
        .select()
        .from(schema.deliveryTable)
        .where(eq(schema.deliveryTable.id, orderItem.deliveryId))
        .for("update");

      if (!delivery) {
        errors.push({
          orderItemId: item.orderItemId,
          reason: "Delivery not found",
        });
      } else if (delivery.status !== "delivered") {
        errors.push({
          orderItemId: item.orderItemId,
          reason: "Delivery is not delivered",
          deliveryStatus: delivery.status,
        });
      }
    }

    // 4. Count existing non-cancelled refunds against this order item.
    const [refundedRow] = await tx
      .select({
        quantity: sql<number>`coalesce(sum(${schema.refundItemTable.quantity}), 0)`,
      })
      .from(schema.refundItemTable)
      .where(
        and(
          eq(schema.refundItemTable.orderItemId, item.orderItemId),
          ne(schema.refundItemTable.status, "cancelled"),
        ),
      );

    const refundedQuantity = Number(refundedRow.quantity);
    const refundAmount = item.refundAmount ?? orderItem.unitPriceAtSale;

    // 5. Validate the single requested refund item before inserting anything.
    if (refundedQuantity >= orderItem.quantity) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Order item already fully refunded",
      });
    }

    if (item.quantity <= 0 || item.quantity > orderItem.quantity) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Invalid refund quantity",
        quantity: item.quantity,
        orderItemQuantity: orderItem.quantity,
      });
    }

    if (refundedQuantity + item.quantity > orderItem.quantity) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Refund quantity exceeds remaining refundable quantity",
        quantity: item.quantity,
        remaining: orderItem.quantity - refundedQuantity,
      });
    }

    if (refundAmount > orderItem.unitPriceAtSale) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Refund amount exceeds unit price at sale",
        refundAmount,
        unitPriceAtSale: orderItem.unitPriceAtSale,
      });
    }

    // 6. Fail the refund request if the item is invalid.
    if (errors.length > 0) {
      throw new CustomError(JSON.stringify({ error: errors }), 400);
    }

    // 7. Fill the default refund amount from the original unit sale price.
    const refundItem = {
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      reason: item.reason,
      note: item.note,
      refundAmount,
      metadata: item.metadata,
    };

    // 8. Insert the refund item atomically after validation passes.
    const [newRefundItem] = await tx
      .insert(schema.refundItemTable)
      .values(refundItem)
      .returning();

    return newRefundItem;
  });
}

export async function updateRefundItemStatus(
  refundItemId: string,
  status: schema.RefundItem["status"],
) {
  return db.transaction(async (tx) => {
    // 1. Lock the refund item so completion side effects can only run once.
    const [refundItem] = await tx
      .select()
      .from(schema.refundItemTable)
      .where(eq(schema.refundItemTable.id, refundItemId))
      .for("update");

    if (!refundItem) {
      throw new CustomError("Refund item not found", 404);
    }

    // 2. Completed refund items are final and cannot change status again.
    if (refundItem.status === "completed") {
      throw new CustomError(
        "Cannot change status once refund is completed",
        400,
      );
    }

    // 3. If nothing changes, return the current refund item.
    if (refundItem.status === status) {
      return refundItem;
    }

    // 4. When completing a refund, reverse the proportional coin spend.
    const summary: { totalCoin: number; coinByMonth: Record<string, number> } =
      {
        totalCoin: 0,
        coinByMonth: {},
      };

    if (status === "completed") {
      const [orderItem] = await tx
        .select()
        .from(schema.orderItemTable)
        .where(eq(schema.orderItemTable.id, refundItem.orderItemId))
        .for("update");

      if (!orderItem) {
        throw new CustomError("Order item not found", 404);
      }

      const [order] = await tx
        .select()
        .from(schema.orderTable)
        .where(eq(schema.orderTable.id, orderItem.orderId))
        .for("update");

      if (!order) {
        throw new CustomError("Order not found", 404);
      }

      const refundTotal = refundItem.quantity * (refundItem.refundAmount ?? 0);
      const refundPercentage =
        order.subTotal > 0 ? refundTotal / order.subTotal : 0;

      if (refundPercentage > 0) {
        const coinUpdates: Record<string, number> = {};

        if (
          isPlainObject(order.coinInfo) &&
          Object.keys(order.coinInfo as Record<string, number>).length > 0
        ) {
          for (const [month, coins] of Object.entries(
            order.coinInfo as Record<string, number>,
          )) {
            coinUpdates[month] = coins * refundPercentage;
          }
        } else if (order.discountCoin && order.discountCoin > 0) {
          const [latestMonthlyStat] = await tx
            .select()
            .from(schema.userMonthlyCoinStatTable)
            .where(eq(schema.userMonthlyCoinStatTable.userId, order.userId))
            .orderBy(desc(schema.userMonthlyCoinStatTable.month))
            .limit(1)
            .for("update");

          if (latestMonthlyStat) {
            coinUpdates[latestMonthlyStat.month] =
              order.discountCoin * refundPercentage;
          }
        }

        const coinSum = Object.values(coinUpdates).reduce(
          (sum, coins) => sum + coins,
          0,
        );

        summary.totalCoin = coinSum;
        summary.coinByMonth = coinUpdates;

        if (coinSum > 0) {
          const promises: Promise<any>[] = [
            tx
              .update(schema.userTable)
              .set({
                coins: sql`${schema.userTable.coins} + ${coinSum}`,
              })
              .where(eq(schema.userTable.id, order.userId)),
          ];

          for (const [month, coins] of Object.entries(coinUpdates)) {
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

          await Promise.all(promises);
        }
      }
    }

    // 5. Status is the only mutable field for refund items.
    const [updatedRefundItem] = await tx
      .update(schema.refundItemTable)
      .set({
        status,
        ...(status === "completed" ? { summary } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.refundItemTable.id, refundItemId))
      .returning();

    return updatedRefundItem;
  });
}
