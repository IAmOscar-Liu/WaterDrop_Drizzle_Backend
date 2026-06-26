import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  ne,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import { getBankNameByCodeMap, isPlainObject } from "../lib/general";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";

export interface GetRefundListParams {
  page?: number;
  limit?: number;
  accountId?: string;
  userId?: string;
  productId?: string;
  merchantTradeNo?: string;
  startAt?: Date;
  endAt?: Date;
  status?: schema.RefundItem["status"];
}

function formatRefundRow(
  row: {
    refundItem: schema.RefundItem;
    orderItem: schema.OrderItem;
    product: schema.Product;
    delivery: {
      id: string;
      merchantTradeNo: string | null;
      status: schema.Delivery["status"];
      LogisticsType: schema.Delivery["LogisticsType"];
      LogisticsSubType: string | null;
    } | null;
    order: schema.Order;
    user: {
      id: string;
      name: string | null;
      email: string;
      bankCode: string | null;
      bankAccount: string | null;
    };
  },
  bankNameByCode = getBankNameByCodeMap(),
) {
  const bankCode = row.user.bankCode?.trim().padStart(3, "0");

  return {
    ...row.refundItem,
    orderItem: {
      ...row.orderItem,
      product: row.product,
      delivery: row.delivery,
      order: {
        ...row.order,
        user: {
          ...row.user,
          bankName: bankCode ? (bankNameByCode.get(bankCode) ?? null) : null,
        },
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
      delivery: {
        id: schema.deliveryTable.id,
        merchantTradeNo: schema.deliveryTable.merchantTradeNo,
        status: schema.deliveryTable.status,
        LogisticsType: schema.deliveryTable.LogisticsType,
        LogisticsSubType: schema.deliveryTable.LogisticsSubType,
      },
      order: schema.orderTable,
      user: {
        id: schema.userTable.id,
        name: schema.userTable.name,
        email: schema.userTable.email,
        bankCode: schema.userTable.bankCode,
        bankAccount: schema.userTable.bankAccount,
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
    .leftJoin(
      schema.deliveryTable,
      eq(schema.orderItemTable.deliveryId, schema.deliveryTable.id),
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
  accountId,
  userId,
  productId,
  merchantTradeNo,
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
  const sellerScope =
    accountId && !(await isAccountAdmin(accountId))
      ? eq(schema.productTable.sellerId, accountId)
      : undefined;
  const merchantTradeNoPrefix = merchantTradeNo?.trim();
  const merchantTradeNoScope =
    merchantTradeNoPrefix && merchantTradeNoPrefix.length >= 4
      ? or(
          like(schema.orderTable.merchantTradeNo, `${merchantTradeNoPrefix}%`),
          like(
            schema.deliveryTable.merchantTradeNo,
            `${merchantTradeNoPrefix}%`,
          ),
        )
      : undefined;
  const scopedWhereClause = and(whereClause, sellerScope, merchantTradeNoScope);

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
    .innerJoin(
      schema.productTable,
      eq(schema.orderItemTable.productId, schema.productTable.id),
    )
    .leftJoin(
      schema.deliveryTable,
      eq(schema.orderItemTable.deliveryId, schema.deliveryTable.id),
    )
    .where(scopedWhereClause);

  const rows = await getRefundBaseQuery()
    .where(scopedWhereClause)
    .orderBy(desc(schema.refundItemTable.createdAt))
    .limit(limit)
    .offset(offset);

  const total = totalResult.total;
  const totalPages = Math.ceil(total / limit);

  const bankNameByCode = getBankNameByCodeMap();

  return {
    refunds: rows.map((row) => formatRefundRow(row, bankNameByCode)),
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
      } else if (
        (process.env.NODE_ENV === "stg" ||
          process.env.NODE_ENV === "production") &&
        delivery.status !== "delivered"
      ) {
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
    const refundTotal = refundAmount * item.quantity;
    const refundSubtotalRatio =
      order?.subTotal && order.subTotal > 0 ? refundTotal / order.subTotal : 0;
    const refundPaidRatio =
      order?.subTotal && order.subTotal > 0
        ? Math.max(order.subTotal - (order.discountCoin ?? 0) / 10, 0) /
          order.subTotal
        : 1;

    const refundItem = {
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      reason: item.reason,
      note: item.note,
      refundAmount,
      paidRefundAmount: refundTotal * refundPaidRatio,
      extraRefundAmount: item.extraRefundAmount ?? 0,
      coins: (order?.discountCoin ?? 0) * refundSubtotalRatio,
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

export async function canRefund(orderItemId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [orderItem] = await tx
      .select()
      .from(schema.orderItemTable)
      .where(eq(schema.orderItemTable.id, orderItemId))
      .for("update");

    if (!orderItem) {
      return false;
    }

    const [order] = await tx
      .select()
      .from(schema.orderTable)
      .where(eq(schema.orderTable.id, orderItem.orderId))
      .for("update");

    if (!order || order.orderStatus !== "paid") {
      return false;
    }

    if (!orderItem.deliveryId) {
      return false;
    }

    const [delivery] = await tx
      .select()
      .from(schema.deliveryTable)
      .where(eq(schema.deliveryTable.id, orderItem.deliveryId))
      .for("update");

    if (
      !delivery ||
      ((process.env.NODE_ENV === "stg" ||
        process.env.NODE_ENV === "production") &&
        delivery.status !== "delivered")
    ) {
      return false;
    }

    const [refundedRow] = await tx
      .select({
        quantity: sql<number>`coalesce(sum(${schema.refundItemTable.quantity}), 0)`,
      })
      .from(schema.refundItemTable)
      .where(
        and(
          eq(schema.refundItemTable.orderItemId, orderItemId),
          ne(schema.refundItemTable.status, "cancelled"),
        ),
      );

    return Number(refundedRow.quantity) < orderItem.quantity;
  });
}

export async function updateRefundItemStatus(
  refundItemId: string,
  updates: {
    status?: schema.RefundItem["status"];
    reason?: string;
    note?: string | null;
    extraRefundAmount?: number;
    metadata?: schema.RefundItem["metadata"];
  },
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

    const statusChanged =
      updates.status !== undefined && refundItem.status !== updates.status;

    // 2. Completed refund items cannot have their status changed again.
    if (refundItem.status === "completed" && statusChanged) {
      throw new CustomError(
        "Cannot change status once refund is completed",
        400,
      );
    }

    // 3. If nothing changes, return the current refund item.
    if (
      !statusChanged &&
      updates.reason === undefined &&
      updates.note === undefined &&
      updates.extraRefundAmount === undefined &&
      updates.metadata === undefined
    ) {
      return refundItem;
    }

    // 4. When completing a refund, reverse the proportional coin spend.
    //    - Calculate how much of the order was refunded.
    //    - Apply that percentage to the order's original coin usage by month.
    //    - Decrease monthly coinsSpent for all affected months so historical
    //      usage stays accurate.
    //    - Return coins to user.coins only for months that are not expired.
    const summary: {
      totalCoin: number;
      returnableCoin: number;
      coinByMonth: Record<
        string,
        {
          coin: number;
          expired: boolean;
          returnedCoin: number;
        }
      >;
    } = {
      totalCoin: 0,
      returnableCoin: 0,
      coinByMonth: {},
    };

    if (statusChanged && updates.status === "completed") {
      // 4.1 Find the refunded order item.
      const [orderItem] = await tx
        .select()
        .from(schema.orderItemTable)
        .where(eq(schema.orderItemTable.id, refundItem.orderItemId))
        .for("update");

      if (!orderItem) {
        throw new CustomError("Order item not found", 404);
      }

      // 4.2 Find the parent order so we can read subtotal and coinInfo.
      const [order] = await tx
        .select()
        .from(schema.orderTable)
        .where(eq(schema.orderTable.id, orderItem.orderId))
        .for("update");

      if (!order) {
        throw new CustomError("Order not found", 404);
      }

      // 4.3 Calculate what percentage of the order subtotal is being refunded.
      const refundTotal = refundItem.quantity * (refundItem.refundAmount ?? 0);
      const refundPercentage =
        order.subTotal > 0 ? refundTotal / order.subTotal : 0;

      if (refundPercentage > 0) {
        // 4.4 Build the coin refund amount by month.
        const coinUpdates: Record<string, number> = {};

        // Prefer the exact original coin usage saved on the order.
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
          // If older orders do not have coinInfo, fall back to the latest month.
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

        // 4.5 Total all affected monthly coin amounts for the summary.
        const coinSum = Object.values(coinUpdates).reduce(
          (sum, coins) => sum + coins,
          0,
        );

        if (coinSum > 0) {
          // 4.6 Load monthly expiration state before returning coins to balance.
          const coinMonths = Object.keys(coinUpdates);
          const monthlyStats = await tx
            .select({
              month: schema.userMonthlyCoinStatTable.month,
              expired: schema.userMonthlyCoinStatTable.expired,
            })
            .from(schema.userMonthlyCoinStatTable)
            .where(
              and(
                eq(schema.userMonthlyCoinStatTable.userId, order.userId),
                inArray(schema.userMonthlyCoinStatTable.month, coinMonths),
              ),
            )
            .for("update");

          const expiredByMonth = new Map(
            monthlyStats.map((stat) => [stat.month, stat.expired]),
          );

          // 4.7 Only non-expired months can be returned to user.coins.
          const returnableCoinSum = Object.entries(coinUpdates).reduce(
            (sum, [month, coins]) =>
              expiredByMonth.get(month) === false ? sum + coins : sum,
            0,
          );

          // 4.8 Save a detailed refund coin summary for future reference.
          summary.totalCoin = coinSum;
          summary.returnableCoin = returnableCoinSum;
          summary.coinByMonth = Object.fromEntries(
            Object.entries(coinUpdates).map(([month, coins]) => {
              const expired = expiredByMonth.get(month) !== false;

              return [
                month,
                {
                  coin: coins,
                  expired,
                  returnedCoin: expired ? 0 : coins,
                },
              ];
            }),
          );

          const promises: Promise<any>[] = [];

          // 4.9 Return non-expired coins to the user's live coin balance.
          if (returnableCoinSum > 0) {
            promises.push(
              tx
                .update(schema.userTable)
                .set({
                  coins: sql`${schema.userTable.coins} + ${returnableCoinSum}`,
                })
                .where(eq(schema.userTable.id, order.userId)),
            );
          }

          // 4.10 Reverse monthly coinsSpent for every affected month.
          for (const [month, coins] of Object.entries(coinUpdates)) {
            promises.push(
              tx
                .update(schema.userMonthlyCoinStatTable)
                .set({
                  coinsSpent: sql`GREATEST(${schema.userMonthlyCoinStatTable.coinsSpent} - ${coins}, 0)`,
                })
                .where(
                  and(
                    eq(schema.userMonthlyCoinStatTable.userId, order.userId),
                    eq(schema.userMonthlyCoinStatTable.month, month),
                  ),
                ),
            );
          }

          // 4.11 Apply all coin updates atomically within the transaction.
          await Promise.all(promises);
        }
      }
    }

    // 5. Status, reason, note, and extra refund amount are mutable.
    const [updatedRefundItem] = await tx
      .update(schema.refundItemTable)
      .set({
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.reason !== undefined ? { reason: updates.reason } : {}),
        ...(updates.note !== undefined ? { note: updates.note } : {}),
        ...(updates.extraRefundAmount !== undefined
          ? { extraRefundAmount: updates.extraRefundAmount }
          : {}),
        ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
        ...(statusChanged && updates.status === "completed"
          ? { returnableCoins: summary.returnableCoin, summary }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.refundItemTable.id, refundItemId))
      .returning();

    return updatedRefundItem;
  });
}
