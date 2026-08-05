import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
  or,
  SQL,
} from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import { CustomError } from "../lib/error";
import {
  HOME_DELIVERY_FEE,
  HOME_DELIVERY_REFRIG_FEE,
  OKMARTC2C_LOW_TMP_DELIVERY,
} from "../constants/delivery";
import { ECPAY_SHIPPING_FEE } from "../constants/ecpay";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

type DeliveryItemWithProductVariant = schema.OrderItem & {
  product?: schema.Product | null;
  variant?: schema.ProductVariant | null;
};

function withVariantNestedInProduct<T extends DeliveryItemWithProductVariant>(
  item: T,
) {
  return {
    ...item,
    product: item.product
      ? {
          ...item.product,
          variant: item.variant ?? null,
        }
      : item.product,
    variantAtSale: {
      name: item.variantNameAtSale,
      sku: item.variantSkuAtSale,
      optionValues: item.variantOptionValuesAtSale,
    },
  };
}

export async function createDelivery(
  deliveryData: schema.NewDelivery,
  products?: { productId: string; variantId: string }[],
) {
  return db.transaction(async (tx) => {
    const [newDelivery] = await tx
      .insert(schema.deliveryTable)
      .values(deliveryData)
      .returning();

    if (newDelivery.RtnCode && newDelivery.RtnMsg) {
      await tx.insert(schema.deliveryLogTable).values({
        deliveryId: newDelivery.id,
        status: newDelivery.status,
        RtnCode: newDelivery.RtnCode,
        RtnMsg: newDelivery.RtnMsg,
      });
    }

    if (products && products.length > 0) {
      if (
        products.some((product) => !product.productId || !product.variantId)
      ) {
        throw new CustomError("productId and variantId are required", 400);
      }

      const productVariantConditions = products.map((product) =>
        and(
          eq(schema.orderItemTable.productId, product.productId),
          eq(schema.orderItemTable.productVariantId, product.variantId),
        ),
      );

      await tx
        .update(schema.orderItemTable)
        .set({
          deliveryId: newDelivery.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.orderItemTable.orderId, newDelivery.orderId),
            or(...productVariantConditions),
          ),
        );
    }

    return newDelivery;
  });
}

export type DeliveryNotificationContext = {
  lastStatus?: schema.Delivery["status"];
  update: {
    status?: schema.Delivery["status"];
    RtnCode?: string | null;
    RtnMsg?: string | null;
  };
};

export async function updateDeliveryWithNotificationContext(
  deliveryId: string,
  updates: Omit<
    Partial<schema.NewDelivery>,
    "id" | "orderId" | "createdAt" | "updatedAt"
  >,
) {
  const result = await db.transaction(async (tx) => {
    const [existingDelivery] = await tx
      .select()
      .from(schema.deliveryTable)
      .where(eq(schema.deliveryTable.id, deliveryId))
      .for("update");

    if (!existingDelivery) return null;

    const latestLog = await tx.query.deliveryLogTable.findFirst({
      where: eq(schema.deliveryLogTable.deliveryId, deliveryId),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
    });

    const [updatedDelivery] = await tx
      .update(schema.deliveryTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.deliveryTable.id, deliveryId))
      .returning();

    const shouldLog =
      (updates.status !== undefined && updates.status !== latestLog?.status) ||
      (updates.RtnCode !== undefined &&
        updates.RtnCode !== latestLog?.RtnCode) ||
      (updates.RtnMsg !== undefined && updates.RtnMsg !== latestLog?.RtnMsg);

    if (shouldLog) {
      await tx.insert(schema.deliveryLogTable).values({
        deliveryId: updatedDelivery.id,
        status:
          updates.status !== undefined
            ? updates.status
            : (latestLog?.status ?? updatedDelivery.status),
        RtnCode:
          updates.RtnCode !== undefined
            ? updates.RtnCode
            : (latestLog?.RtnCode ?? updatedDelivery.RtnCode),
        RtnMsg:
          updates.RtnMsg !== undefined
            ? updates.RtnMsg
            : (latestLog?.RtnMsg ?? updatedDelivery.RtnMsg),
      });
    }

    return { updatedDelivery, latestLog, shouldLog };
  });

  if (!result) return null;

  const newDeliveryDetails = await getDeliveryById(result.updatedDelivery.id);
  return {
    delivery: newDeliveryDetails,
    notificationContext: result.shouldLog
      ? {
          lastStatus: result.latestLog?.status,
          update: {
            status: updates.status,
            RtnCode: updates.RtnCode,
            RtnMsg: updates.RtnMsg,
          },
        }
      : undefined,
  };
}

export async function updateDelivery(
  deliveryId: string,
  updates: Parameters<typeof updateDeliveryWithNotificationContext>[1],
) {
  const result = await updateDeliveryWithNotificationContext(
    deliveryId,
    updates,
  );

  return result?.delivery ?? null;
}

type RefundableDelivery = Pick<schema.Delivery, "status"> & {
  order: Pick<schema.Order, "orderStatus">;
};

type RefundableDeliveryItem = Pick<
  schema.OrderItem,
  "deliveryId" | "quantity"
> & {
  refundItems: Pick<schema.RefundItem, "quantity" | "status">[];
};

function isRefundableDelivery(delivery: RefundableDelivery) {
  if (delivery.order.orderStatus !== "paid") {
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

function getRefundedQuantity(item: RefundableDeliveryItem) {
  return item.refundItems.reduce(
    (total, refundItem) =>
      refundItem.status === "cancelled" ? total : total + refundItem.quantity,
    0,
  );
}

function getRemainingRefundQuantity(
  delivery: RefundableDelivery,
  item: RefundableDeliveryItem,
) {
  if (!isRefundableDelivery(delivery) || !item.deliveryId) {
    return 0;
  }

  return Math.max(item.quantity - getRefundedQuantity(item), 0);
}

function canRefundDeliveryItem(
  delivery: RefundableDelivery,
  item: RefundableDeliveryItem,
) {
  return getRemainingRefundQuantity(delivery, item) > 0;
}

export async function getDeliveryById(deliveryId: string) {
  const delivery = await db.query.deliveryTable.findFirst({
    where: eq(schema.deliveryTable.id, deliveryId),
    with: {
      order: {
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      items: {
        with: {
          product: true,
          variant: true,
          refundItems: {
            orderBy: (refundItems, { desc }) => [desc(refundItems.createdAt)],
          },
        },
      },
      logs: {
        orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      },
    },
  });

  if (!delivery) {
    return delivery;
  }

  // Reuse the loaded delivery/order/refund relations instead of calling
  // refund.canRefund for each item and triggering duplicate queries.
  return {
    ...delivery,
    items: delivery.items.map((item) => {
      const itemWithNestedVariant = withVariantNestedInProduct(item);

      return {
        ...itemWithNestedVariant,
        canRefund: canRefundDeliveryItem(delivery, item),
        remainingRefundQuantity: getRemainingRefundQuantity(delivery, item),
      };
    }),
  };
}

export async function getDeliveryByMerchantTradeNo(merchantTradeNo: string) {
  return db.query.deliveryTable.findFirst({
    where: eq(schema.deliveryTable.merchantTradeNo, merchantTradeNo),
  });
}

export async function getDeliveriesByMerchantTradeNo(
  merchantTradeNo: string,
  options?: { matchPrefix: boolean },
) {
  const { matchPrefix = false } = options ?? {};

  if (matchPrefix && merchantTradeNo.length < 4) {
    throw new CustomError(
      "Merchant trade no must be at least 4 characters for prefix match",
      400,
    );
  }

  const whereClause = matchPrefix
    ? like(schema.deliveryTable.merchantTradeNo, `${merchantTradeNo}%`)
    : eq(schema.deliveryTable.merchantTradeNo, merchantTradeNo);

  return db.query.deliveryTable.findMany({
    where: whereClause,
    with: {
      order: {
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      items: true,
    },
  }).then((deliveries) =>
    deliveries.map((delivery) => ({
      ...delivery,
      items: delivery.items.map(withVariantNestedInProduct),
    })),
  );
}

export interface ListAdminDeliveriesParams extends PaginationParams {
  accountId: string;
  merchantTradeNo?: string;
  logisticsType?: schema.Delivery["LogisticsType"];
  status?: schema.Delivery["status"];
  startDate?: Date;
  endDate?: Date;
}

export async function listAdminDeliveries({
  page = 1,
  limit = 10,
  accountId,
  merchantTradeNo,
  logisticsType,
  status,
  startDate,
  endDate,
}: ListAdminDeliveriesParams) {
  const pagination = getPagination(page, limit);
  const conditions: (SQL | undefined)[] = [];

  const isAdmin = await isAccountAdmin(accountId);
  if (!isAdmin) {
    const sellerDeliveryIdsSubquery = db
      .selectDistinct({ deliveryId: schema.orderItemTable.deliveryId })
      .from(schema.orderItemTable)
      .innerJoin(
        schema.productTable,
        eq(schema.orderItemTable.productId, schema.productTable.id),
      )
      .where(
        and(
          eq(schema.productTable.sellerId, accountId),
          isNotNull(schema.orderItemTable.deliveryId),
        ),
      );
    conditions.push(
      inArray(schema.deliveryTable.id, sellerDeliveryIdsSubquery),
    );
  }

  const merchantTradeNoPrefix = merchantTradeNo?.trim();
  if (merchantTradeNoPrefix && merchantTradeNoPrefix.length >= 4) {
    const orderIdsSubquery = db
      .select({ id: schema.orderTable.id })
      .from(schema.orderTable)
      .where(
        like(schema.orderTable.merchantTradeNo, `${merchantTradeNoPrefix}%`),
      );
    conditions.push(
      or(
        like(schema.deliveryTable.merchantTradeNo, `${merchantTradeNoPrefix}%`),
        inArray(schema.deliveryTable.orderId, orderIdsSubquery),
      ),
    );
  }

  if (status) {
    conditions.push(eq(schema.deliveryTable.status, status));
  }
  if (logisticsType) {
    conditions.push(eq(schema.deliveryTable.LogisticsType, logisticsType));
  }
  if (startDate) {
    conditions.push(gte(schema.deliveryTable.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(schema.deliveryTable.createdAt, endDate));
  }

  const totalResult = await db
    .select({ total: count() })
    .from(schema.deliveryTable)
    .where(compactConditions(conditions));

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  const deliveriesData = await db.query.deliveryTable.findMany({
    where: compactConditions(conditions),
    limit: pagination.limit,
    offset: pagination.offset,
    with: {
      items: true,
      order: {
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: (deliveries, { desc }) => [desc(deliveries.createdAt)],
  });
  const deliveries = deliveriesData.map((delivery) => ({
    ...delivery,
    items: delivery.items.map(withVariantNestedInProduct),
  }));

  return {
    deliveries,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export async function upsertShippingFee(
  accountId: string,
  data: Partial<Omit<schema.ShippingFee, "id" | "accountId">>,
) {
  if (Object.keys(data).length === 0)
    throw new CustomError("No data provided", 400);

  for (let key of Object.keys(data)) {
    if (typeof (data as any)[key] === "number" && (data as any)[key] < 0)
      throw new CustomError(`${key} must be a positive number`, 400);
  }

  if (data.homeDelivery && data.homeDelivery > HOME_DELIVERY_FEE)
    throw new CustomError(
      `homeDelivery cannot be greater than ${HOME_DELIVERY_FEE}`,
      400,
    );
  if (data.homeDeliveryRefrig && data.homeDeliveryRefrig > HOME_DELIVERY_FEE)
    throw new CustomError(
      `homeDeliveryRefrig cannot be greater than ${HOME_DELIVERY_REFRIG_FEE}`,
      400,
    );
  if (
    data.OKMART_LOW_TMP_C2C &&
    data.OKMART_LOW_TMP_C2C > OKMARTC2C_LOW_TMP_DELIVERY
  )
    throw new CustomError(
      `OKMART_LOW_TMP_C2C cannot be greater than ${OKMARTC2C_LOW_TMP_DELIVERY}`,
      400,
    );
  if (data.FAMIC2C && data.FAMIC2C > ECPAY_SHIPPING_FEE.FAMIC2C)
    throw new CustomError(
      `FAMIC2C cannot be greater than ${ECPAY_SHIPPING_FEE.FAMIC2C}`,
      400,
    );
  if (data.UNIMARTC2C && data.UNIMARTC2C > ECPAY_SHIPPING_FEE.UNIMARTC2C)
    throw new CustomError(
      `UNIMARTC2C cannot be greater than ${ECPAY_SHIPPING_FEE.UNIMARTC2C}`,
      400,
    );
  if (data.HILIFEC2C && data.HILIFEC2C > ECPAY_SHIPPING_FEE.HILIFEC2C)
    throw new CustomError(
      `HILIFEC2C cannot be greater than ${ECPAY_SHIPPING_FEE.HILIFEC2C}`,
      400,
    );
  if (data.OKMARTC2C && data.OKMARTC2C > ECPAY_SHIPPING_FEE.OKMARTC2C)
    throw new CustomError(
      `OKMARTC2C cannot be greater than ${ECPAY_SHIPPING_FEE.OKMARTC2C}`,
      400,
    );

  const existing = await db.query.shippingFeeTable.findFirst({
    where: eq(schema.shippingFeeTable.accountId, accountId),
  });

  if (existing) {
    const [updated] = await db
      .update(schema.shippingFeeTable)
      .set({ ...existing, ...data })
      .where(eq(schema.shippingFeeTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(schema.shippingFeeTable)
    .values({ accountId, ...data })
    .returning();
  return created;
}

export async function getShippingFeeByAccountIds(accountIds: string[]) {
  return db.query.shippingFeeTable.findMany({
    where: inArray(schema.shippingFeeTable.accountId, accountIds),
  });
}

export async function getShippingFee(accountId: string) {
  return db.query.shippingFeeTable.findFirst({
    where: eq(schema.shippingFeeTable.accountId, accountId),
  });
}
