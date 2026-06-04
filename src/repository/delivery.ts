import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
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
import { sendDeliveryNotification } from "../lib/polling";

export async function createDelivery(
  deliveryData: schema.NewDelivery,
  productIds?: string[],
) {
  const [newDelivery] = await db
    .insert(schema.deliveryTable)
    .values(deliveryData)
    .returning();

  console.log("New Delivery Created:", newDelivery.id);

  if (newDelivery.RtnCode && newDelivery.RtnMsg) {
    await db.insert(schema.deliveryLogTable).values({
      deliveryId: newDelivery.id,
      status: newDelivery.status,
      RtnCode: newDelivery.RtnCode,
      RtnMsg: newDelivery.RtnMsg,
    });
  }

  if (productIds && productIds.length > 0) {
    await db
      .update(schema.orderItemTable)
      .set({
        deliveryId: newDelivery.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.orderItemTable.orderId, newDelivery.orderId),
          inArray(schema.orderItemTable.productId, productIds),
        ),
      );
  }

  return newDelivery;
}

export async function updateDelivery(
  deliveryId: string,
  updates: Omit<
    Partial<schema.NewDelivery>,
    "id" | "orderId" | "createdAt" | "updatedAt"
  >,
) {
  const latestLog = await db.query.deliveryLogTable.findFirst({
    where: eq(schema.deliveryLogTable.deliveryId, deliveryId),
    orderBy: (logs, { desc }) => [desc(logs.createdAt)],
  });

  const [updatedDelivery] = await db
    .update(schema.deliveryTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.deliveryTable.id, deliveryId))
    .returning();

  if (!updatedDelivery) return null;

  const shouldLog =
    (updates.status !== undefined && updates.status !== latestLog?.status) ||
    (updates.RtnCode !== undefined && updates.RtnCode !== latestLog?.RtnCode) ||
    (updates.RtnMsg !== undefined && updates.RtnMsg !== latestLog?.RtnMsg);

  if (shouldLog) {
    await db.insert(schema.deliveryLogTable).values({
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

  console.log("Delivery updated:", updatedDelivery.id);
  const newDeliveryDetails = await getDeliveryById(updatedDelivery.id);
  if (shouldLog) {
    await sendDeliveryNotification({
      lastStatus: latestLog?.status,
      update: {
        status: updates.status,
        RtnCode: updates.RtnCode,
        RtnMsg: updates.RtnMsg,
      },
      delivery: newDeliveryDetails,
    });
  }
  return newDeliveryDetails;
}

export async function getDeliveryById(deliveryId: string) {
  return db.query.deliveryTable.findFirst({
    where: eq(schema.deliveryTable.id, deliveryId),
    with: {
      order: true,
      items: {
        with: {
          product: true,
          refundItems: true,
        },
      },
      logs: {
        orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      },
    },
  });
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
      order: true,
      items: {
        with: {
          product: true,
        },
      },
    },
  });
}

export interface ListAdminDeliveriesParams {
  page?: number;
  limit?: number;
  accountId: string;
  logisticsType?: schema.Delivery["LogisticsType"];
  status?: schema.Delivery["status"];
  startDate?: Date;
  endDate?: Date;
}

export async function listAdminDeliveries({
  page = 1,
  limit = 10,
  accountId,
  logisticsType,
  status,
  startDate,
  endDate,
}: ListAdminDeliveriesParams) {
  const offset = (page - 1) * limit;
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
    .where(and(...conditions));

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  const deliveries = await db.query.deliveryTable.findMany({
    where: and(...conditions),
    limit,
    offset,
    with: {
      items: true,
    },
    orderBy: (deliveries, { desc }) => [desc(deliveries.createdAt)],
  });

  return { deliveries, total, page, limit, totalPages };
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
    console.log("Shipping fee updated:", updated.id);
    return updated;
  }

  const [created] = await db
    .insert(schema.shippingFeeTable)
    .values({ accountId, ...data })
    .returning();
  console.log("Shipping fee created:", created.id);
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
