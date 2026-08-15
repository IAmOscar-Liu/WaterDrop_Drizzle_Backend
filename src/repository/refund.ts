import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
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
import {
  formatInteger,
  getBankNameByCodeMap,
  isPlainObject,
} from "../lib/general";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import { minimumVariantPrice } from "./utils/product";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

export interface GetRefundListParams extends PaginationParams {
  accountId?: string;
  userId?: string;
  productId?: string;
  merchantTradeNo?: string;
  startAt?: Date;
  endAt?: Date;
  status?: schema.RefundItem["status"];
}

export type RefundCreatedChatMessageInput = {
  accountId: string;
  userId: string;
  productId: string;
  productVariantId: string;
  orderId: string;
  senderType?: schema.ChatMessage["senderType"];
  content: string;
};

export type RefundNotificationContext = {
  userId: string;
  orderId: string;
  refundItemId: string;
  merchantTradeNo: string | null;
  productName: string;
  variantName: string | null;
  status: schema.RefundItem["status"];
};

export type RefundStatusChangedNotificationContext =
  RefundNotificationContext & {
    previousStatus: schema.RefundItem["status"];
  };

function formatRefundRow(
  row: {
    refundItem: schema.RefundItem;
    orderItem: schema.OrderItem;
    variantImage: string | null;
    product: schema.Product;
    delivery: {
      id: string;
      merchantTradeNo: string | null;
      status: schema.Delivery["status"];
      LogisticsType: schema.Delivery["LogisticsType"];
      LogisticsSubType: string | null;
      RtnCode: string | null;
      RtnMsg: string | null;
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
  const {
    variantNameAtSale,
    variantSkuAtSale,
    variantOptionValuesAtSale,
    ...orderItem
  } = row.orderItem;

  return {
    ...row.refundItem,
    orderItem: {
      ...orderItem,
      variantAtSale: {
        name: variantNameAtSale,
        sku: variantSkuAtSale,
        optionValues: variantOptionValuesAtSale,
        price: orderItem.unitPriceAtSale,
      },
      variantImage: row.variantImage,
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

  return compactConditions(conditions);
}

function getRefundBaseQuery() {
  const productPrice = minimumVariantPrice(schema.productTable.id);

  return db
    .select({
      refundItem: schema.refundItemTable,
      orderItem: schema.orderItemTable,
      variantImage: sql<string | null>`${schema.productVariantTable.images}[1]`,
      product: {
        ...getTableColumns(schema.productTable),
        price: productPrice,
      },
      delivery: {
        id: schema.deliveryTable.id,
        merchantTradeNo: schema.deliveryTable.merchantTradeNo,
        status: schema.deliveryTable.status,
        LogisticsType: schema.deliveryTable.LogisticsType,
        LogisticsSubType: schema.deliveryTable.LogisticsSubType,
        RtnCode: schema.deliveryTable.RtnCode,
        RtnMsg: schema.deliveryTable.RtnMsg,
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
    .innerJoin(
      schema.productVariantTable,
      eq(
        schema.orderItemTable.productVariantId,
        schema.productVariantTable.id,
      ),
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

function calculateRefundFinancials(
  order: schema.Order | undefined,
  quantity: number,
  refundAmount: number,
) {
  const refundTotal = refundAmount * quantity;
  const refundSubtotalRatio =
    order?.subTotal && order.subTotal > 0 ? refundTotal / order.subTotal : 0;
  const refundPaidRatio =
    order?.subTotal && order.subTotal > 0
      ? Math.max(order.subTotal - (order.discountCoin ?? 0) / 10, 0) /
        order.subTotal
      : 1;

  return {
    refundTotal,
    paidRefundAmount: refundTotal * refundPaidRatio,
    coins: (order?.discountCoin ?? 0) * refundSubtotalRatio,
  };
}

function validateRefundQuantityAndAmount({
  orderItem,
  refundedQuantity,
  quantity,
  refundAmount,
}: {
  orderItem: schema.OrderItem;
  refundedQuantity: number;
  quantity: number;
  refundAmount: number;
}) {
  const errors = [];

  if (refundedQuantity >= orderItem.quantity) {
    errors.push({
      orderItemId: orderItem.id,
      reason: "Order item already fully refunded",
    });
  }

  if (quantity <= 0 || quantity > orderItem.quantity) {
    errors.push({
      orderItemId: orderItem.id,
      reason: "Invalid refund quantity",
      quantity,
      orderItemQuantity: orderItem.quantity,
    });
  }

  if (refundedQuantity + quantity > orderItem.quantity) {
    errors.push({
      orderItemId: orderItem.id,
      reason: "Refund quantity exceeds remaining refundable quantity",
      quantity,
      remaining: orderItem.quantity - refundedQuantity,
    });
  }

  if (refundAmount > orderItem.unitPriceAtSale) {
    errors.push({
      orderItemId: orderItem.id,
      reason: "Refund amount exceeds unit price at sale",
      refundAmount,
      unitPriceAtSale: orderItem.unitPriceAtSale,
    });
  }

  return errors;
}

function formatRefundChatMessage({
  createdAt,
  productName,
  variantName,
  quantity,
  paidRefundAmount,
  coins,
  reason,
  note,
}: {
  createdAt: Date;
  productName: string;
  variantName?: string | null;
  quantity: number;
  paidRefundAmount: number | null;
  coins: number;
  reason?: string | null;
  note?: string | null;
}) {
  const appliedAt = createdAt.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return [
    "【退貨申請】",
    `• 申請時間：${appliedAt}`,
    `• 商品名稱：${productName}`,
    ...(variantName?.trim()
      ? [`• 商品規格：${variantName.trim()}`]
      : []),
    `• 退貨數量：${quantity}`,
    `• 退款金額：NT$ ${formatInteger(paidRefundAmount)}`,
    `• 退還金幣：${formatInteger(coins)}`,
    `• 退貨原因：${reason || "無"}`,
    `• 備註：${note || "無"}`,
    "※ 以上為退貨申請草稿資訊，後續可能調整，請至訂單記錄查詢最新退款內容。",
  ].join("\n");
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
  const pagination = getPagination(page, limit);
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
  const scopedWhereClause = compactConditions([
    whereClause,
    sellerScope,
    merchantTradeNoScope,
  ]);

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
    .limit(pagination.limit)
    .offset(pagination.offset);

  const total = totalResult.total;
  const totalPages = getTotalPages(total, pagination.limit);

  const bankNameByCode = getBankNameByCodeMap();

  return {
    refunds: rows.map((row) => formatRefundRow(row, bankNameByCode)),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export async function getRefundById(refundItemId: string) {
  const [[row], logs] = await Promise.all([
    getRefundBaseQuery().where(eq(schema.refundItemTable.id, refundItemId)),
    db.query.refundLogTable.findMany({
      where: eq(schema.refundLogTable.refundItemId, refundItemId),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
    }),
  ]);

  return row ? { ...formatRefundRow(row), logs } : undefined;
}

export async function createRefundWithChatContext(
  item: schema.NewRefundItem & {
    accountId?: string;
    userId?: string;
    chatSenderType?: schema.ChatMessage["senderType"];
  },
) {
  const result = await db.transaction(async (tx) => {
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

    if (item.userId && order && order.userId !== item.userId) {
      errors.push({
        orderItemId: item.orderItemId,
        reason: "Order item does not belong to user",
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
    errors.push(
      ...validateRefundQuantityAndAmount({
        orderItem,
        refundedQuantity,
        quantity: item.quantity,
        refundAmount,
      }),
    );

    // 6. Fail the refund request if the item is invalid.
    if (errors.length > 0) {
      throw new CustomError(JSON.stringify({ error: errors }), 400);
    }

    if (!order) {
      throw new CustomError("Order not found", 404);
    }

    const [product] = await tx
      .select()
      .from(schema.productTable)
      .where(eq(schema.productTable.id, orderItem.productId))
      .for("update");

    if (!product) {
      throw new CustomError("Product not found", 404);
    }

    // 7. Fill the default refund amount from the original unit sale price.
    const refundFinancials = calculateRefundFinancials(
      order,
      item.quantity,
      refundAmount,
    );

    const refundItem = {
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      reason: item.reason,
      note: item.note,
      refundAmount,
      paidRefundAmount: refundFinancials.paidRefundAmount,
      extraRefundAmount: item.extraRefundAmount ?? 0,
      coins: refundFinancials.coins,
      metadata: item.metadata,
    };

    // 8. Insert the refund item atomically after validation passes.
    const [newRefundItem] = await tx
      .insert(schema.refundItemTable)
      .values(refundItem)
      .returning();

    await tx.insert(schema.refundLogTable).values({
      refundItemId: newRefundItem.id,
      status: newRefundItem.status,
      message: "申請退貨",
    });

    if (item.accountId && !orderItem.productVariantId) {
      throw new CustomError("Order item productVariantId is required", 400);
    }

    const productVariantId = orderItem.productVariantId;

    return {
      refundItem: newRefundItem,
      notificationContext: {
        userId: order.userId,
        orderId: order.id,
        refundItemId: newRefundItem.id,
        merchantTradeNo: order.merchantTradeNo,
        productName: product.name,
        variantName: orderItem.variantNameAtSale,
        status: newRefundItem.status,
      } satisfies RefundNotificationContext,
      chatMessageInput: item.accountId
        ? {
            accountId: item.accountId,
            userId: item.userId ?? order.userId,
            productId: orderItem.productId,
            productVariantId: productVariantId!,
            orderId: orderItem.orderId,
            senderType: item.chatSenderType,
            content: formatRefundChatMessage({
              createdAt: newRefundItem.createdAt,
              productName: product.name,
              variantName: orderItem.variantNameAtSale,
              quantity: newRefundItem.quantity,
              paidRefundAmount: newRefundItem.paidRefundAmount,
              coins: newRefundItem.coins,
              reason: newRefundItem.reason,
              note: newRefundItem.note,
            }),
          }
        : undefined,
    };
  });

  return result;
}

export async function createRefund(
  item: Parameters<typeof createRefundWithChatContext>[0],
) {
  const result = await createRefundWithChatContext(item);
  return result.refundItem;
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
    quantity?: number;
    refundAmount?: number;
    reason?: string;
    note?: string | null;
    message?: string;
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
    const financialChanged =
      updates.quantity !== undefined || updates.refundAmount !== undefined;
    const latestLog =
      updates.message !== undefined
        ? await tx.query.refundLogTable.findFirst({
            where: eq(schema.refundLogTable.refundItemId, refundItemId),
            orderBy: (logs, { desc }) => [desc(logs.createdAt)],
          })
        : undefined;
    const messageChanged =
      updates.message !== undefined && updates.message !== latestLog?.message;
    const refundItemChanged =
      statusChanged ||
      financialChanged ||
      updates.reason !== undefined ||
      updates.note !== undefined ||
      updates.extraRefundAmount !== undefined ||
      updates.metadata !== undefined;
    const shouldLog = statusChanged || messageChanged;

    // 2. Completed refund items cannot have their status changed again.
    if (refundItem.status === "completed" && statusChanged) {
      throw new CustomError(
        "Cannot change status once refund is completed",
        400,
      );
    }

    if (
      financialChanged &&
      (refundItem.status === "completed" || refundItem.status === "cancelled")
    ) {
      throw new CustomError(
        "Cannot change quantity or refund amount once refund is completed or cancelled",
        400,
      );
    }

    // 3. If nothing changes, return the current refund item.
    if (!refundItemChanged && !shouldLog) {
      return {
        refundItem,
        notificationContext: undefined,
      };
    }

    let orderItem: schema.OrderItem | undefined;
    let order: schema.Order | undefined;

    async function getLockedOrderContext() {
      if (!orderItem) {
        [orderItem] = await tx
          .select()
          .from(schema.orderItemTable)
          .where(eq(schema.orderItemTable.id, refundItem.orderItemId))
          .for("update");

        if (!orderItem) {
          throw new CustomError("Order item not found", 404);
        }
      }

      if (!order) {
        [order] = await tx
          .select()
          .from(schema.orderTable)
          .where(eq(schema.orderTable.id, orderItem.orderId))
          .for("update");

        if (!order) {
          throw new CustomError("Order not found", 404);
        }
      }

      return { orderItem, order };
    }

    let financialUpdates:
      | {
          quantity: number;
          refundAmount: number;
          paidRefundAmount: number;
          coins: number;
        }
      | undefined;

    if (financialChanged) {
      const context = await getLockedOrderContext();
      const quantity = updates.quantity ?? refundItem.quantity;
      const refundAmount =
        updates.refundAmount ??
        refundItem.refundAmount ??
        context.orderItem.unitPriceAtSale;

      const [refundedRow] = await tx
        .select({
          quantity: sql<number>`coalesce(sum(${schema.refundItemTable.quantity}), 0)`,
        })
        .from(schema.refundItemTable)
        .where(
          and(
            eq(schema.refundItemTable.orderItemId, refundItem.orderItemId),
            ne(schema.refundItemTable.id, refundItem.id),
            ne(schema.refundItemTable.status, "cancelled"),
          ),
        );

      const errors = validateRefundQuantityAndAmount({
        orderItem: context.orderItem,
        refundedQuantity: Number(refundedRow.quantity),
        quantity,
        refundAmount,
      });

      if (errors.length > 0) {
        throw new CustomError(JSON.stringify({ error: errors }), 400);
      }

      financialUpdates = {
        quantity,
        refundAmount,
        ...calculateRefundFinancials(context.order, quantity, refundAmount),
      };
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
      const context = await getLockedOrderContext();
      const effectiveQuantity =
        financialUpdates?.quantity ?? refundItem.quantity;
      const effectiveRefundAmount =
        financialUpdates?.refundAmount ?? refundItem.refundAmount ?? 0;

      if (!context.orderItem.productVariantId) {
        throw new CustomError("Order item productVariantId is required", 400);
      }

      const [variant] = await tx
        .select()
        .from(schema.productVariantTable)
        .where(eq(schema.productVariantTable.id, context.orderItem.productVariantId))
        .for("update");

      if (!variant || variant.productId !== context.orderItem.productId) {
        throw new CustomError("Product variant not found", 404);
      }

      await tx
        .update(schema.productVariantTable)
        .set({
          stock: sql`${schema.productVariantTable.stock} + ${effectiveQuantity}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.productVariantTable.id, variant.id));

      // 4.3 Calculate what percentage of the order subtotal is being refunded.
      const refundTotal = effectiveQuantity * effectiveRefundAmount;
      const refundPercentage =
        context.order.subTotal > 0 ? refundTotal / context.order.subTotal : 0;

      if (refundPercentage > 0) {
        // 4.4 Build the coin refund amount by month.
        const coinUpdates: Record<string, number> = {};

        // Prefer the exact original coin usage saved on the order.
        if (
          isPlainObject(context.order.coinInfo) &&
          Object.keys(context.order.coinInfo as Record<string, number>).length >
            0
        ) {
          for (const [month, coins] of Object.entries(
            context.order.coinInfo as Record<string, number>,
          )) {
            coinUpdates[month] = coins * refundPercentage;
          }
        } else if (
          context.order.discountCoin &&
          context.order.discountCoin > 0
        ) {
          // If older orders do not have coinInfo, fall back to the latest month.
          const [latestMonthlyStat] = await tx
            .select()
            .from(schema.userMonthlyCoinStatTable)
            .where(
              eq(schema.userMonthlyCoinStatTable.userId, context.order.userId),
            )
            .orderBy(desc(schema.userMonthlyCoinStatTable.month))
            .limit(1)
            .for("update");

          if (latestMonthlyStat) {
            coinUpdates[latestMonthlyStat.month] =
              context.order.discountCoin * refundPercentage;
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
                eq(
                  schema.userMonthlyCoinStatTable.userId,
                  context.order.userId,
                ),
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
                .where(eq(schema.userTable.id, context.order.userId)),
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
                    eq(
                      schema.userMonthlyCoinStatTable.userId,
                      context.order.userId,
                    ),
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
    let updatedRefundItem = refundItem;

    if (refundItemChanged) {
      [updatedRefundItem] = await tx
        .update(schema.refundItemTable)
        .set({
          ...(updates.status !== undefined ? { status: updates.status } : {}),
          ...(financialUpdates
            ? {
                quantity: financialUpdates.quantity,
                refundAmount: financialUpdates.refundAmount,
                paidRefundAmount: financialUpdates.paidRefundAmount,
                coins: financialUpdates.coins,
              }
            : {}),
          ...(updates.reason !== undefined ? { reason: updates.reason } : {}),
          ...(updates.note !== undefined ? { note: updates.note } : {}),
          ...(updates.extraRefundAmount !== undefined
            ? { extraRefundAmount: updates.extraRefundAmount }
            : {}),
          ...(updates.metadata !== undefined
            ? { metadata: updates.metadata }
            : {}),
          ...(statusChanged && updates.status === "completed"
            ? { returnableCoins: summary.returnableCoin, summary }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.refundItemTable.id, refundItemId))
        .returning();
    }

    if (shouldLog) {
      await tx.insert(schema.refundLogTable).values({
        refundItemId,
        status: updatedRefundItem.status,
        message: updates.message ?? null,
      });
    }

    let notificationContext: RefundStatusChangedNotificationContext | undefined;
    if (statusChanged) {
      const context = await getLockedOrderContext();
      notificationContext = {
        userId: context.order.userId,
        orderId: context.order.id,
        refundItemId: updatedRefundItem.id,
        merchantTradeNo: context.order.merchantTradeNo,
        productName: context.orderItem.productNameAtSale,
        variantName: context.orderItem.variantNameAtSale,
        previousStatus: refundItem.status,
        status: updatedRefundItem.status,
      };
    }

    return {
      refundItem: updatedRefundItem,
      notificationContext,
    };
  });
}
