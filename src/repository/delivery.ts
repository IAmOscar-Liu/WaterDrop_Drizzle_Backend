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

export async function createDelivery(
  deliveryData: schema.NewDelivery,
  productIds?: string[],
) {
  const [newDelivery] = await db
    .insert(schema.deliveryTable)
    .values(deliveryData)
    .returning();

  console.log("New Delivery Created:", newDelivery.id);

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
  const [updatedDelivery] = await db
    .update(schema.deliveryTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.deliveryTable.id, deliveryId))
    .returning();

  console.log("Delivery updated:", updatedDelivery.id);
  return await getDeliveryById(updatedDelivery.id);
}

export async function getDeliveryById(deliveryId: string) {
  return db.query.deliveryTable.findFirst({
    where: eq(schema.deliveryTable.id, deliveryId),
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
  status?: schema.Delivery["status"];
  startDate?: Date;
  endDate?: Date;
}

export async function listAdminDeliveries({
  page = 1,
  limit = 10,
  accountId,
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
