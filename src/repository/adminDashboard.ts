import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  SQL,
  sql,
  sum,
} from "drizzle-orm";

import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { resolveAdminSellerScope } from "./adminScope";
import { compactConditions } from "./utils/query";

export type DashboardFilters = {
  requesterId: string;
  sellerId?: string;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
};

function validateFilters(input: DashboardFilters) {
  if (input.startAt && input.endAt && input.startAt > input.endAt) {
    throw new CustomError("startAt must be before endAt", 400);
  }
  const timezone = input.timezone ?? "Asia/Taipei";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new CustomError("Invalid IANA timezone", 400);
  }
  return timezone;
}

function dateConditions(column: any, startAt?: Date, endAt?: Date) {
  return [startAt ? gte(column, startAt) : undefined, endAt ? lte(column, endAt) : undefined];
}

export async function getDashboardKpi(input: DashboardFilters) {
  const timezone = validateFilters(input);
  const scope = await resolveAdminSellerScope(input.requesterId, input.sellerId);
  const sellerProduct = scope.sellerId
    ? eq(schema.productTable.sellerId, scope.sellerId)
    : undefined;

  const orderWhere = compactConditions([
    eq(schema.orderTable.orderStatus, "paid"),
    sellerProduct,
    ...dateConditions(schema.orderTable.createdAt, input.startAt, input.endAt),
  ]);
  const refundWhere = compactConditions([
    eq(schema.refundItemTable.status, "completed"),
    sellerProduct,
    ...dateConditions(schema.refundItemTable.createdAt, input.startAt, input.endAt),
  ]);

  const [salesRows, refundRows, pendingOrderRows, pendingDeliveryRows, pendingRefundRows, adRows, adSpendRows, walletRows] =
    await Promise.all([
      db
        .select({
          paidOrderCount: countDistinct(schema.orderTable.id),
          grossMerchandiseValue: sql<number>`coalesce(sum(${schema.orderItemTable.lineTotal}), 0)`.mapWith(Number),
        })
        .from(schema.orderItemTable)
        .innerJoin(schema.orderTable, eq(schema.orderTable.id, schema.orderItemTable.orderId))
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
        .where(orderWhere),
      db
        .select({
          completedRefundAmount: sql<number>`coalesce(sum(${schema.refundItemTable.cashRefundAmount}), 0)`.mapWith(Number),
        })
        .from(schema.refundItemTable)
        .innerJoin(schema.orderItemTable, eq(schema.orderItemTable.id, schema.refundItemTable.orderItemId))
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
        .where(refundWhere),
      db
        .select({ value: countDistinct(schema.orderTable.id) })
        .from(schema.orderItemTable)
        .innerJoin(schema.orderTable, eq(schema.orderTable.id, schema.orderItemTable.orderId))
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
        .where(
          compactConditions([
            inArray(schema.orderTable.orderStatus, ["pending", "payment-processing"]),
            sellerProduct,
          ]),
        ),
      db
        .select({ value: countDistinct(schema.deliveryTable.id) })
        .from(schema.deliveryTable)
        .innerJoin(schema.orderItemTable, eq(schema.orderItemTable.orderId, schema.deliveryTable.orderId))
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
        .where(
          compactConditions([
            inArray(schema.deliveryTable.status, ["pending", "exception", "unknown"]),
            sellerProduct,
          ]),
        ),
      db
        .select({ value: countDistinct(schema.refundItemTable.id) })
        .from(schema.refundItemTable)
        .innerJoin(schema.orderItemTable, eq(schema.orderItemTable.id, schema.refundItemTable.orderItemId))
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
        .where(
          compactConditions([
            inArray(schema.refundItemTable.status, ["pending", "processing"]),
            sellerProduct,
          ]),
        ),
      db
        .select({
          activeAdvertisements: sql<number>`count(*) filter (where ${schema.advertisementStatsTable.status} = 'active')`.mapWith(Number),
          depletedAdvertisements: sql<number>`count(*) filter (where ${schema.advertisementStatsTable.status} = 'depleted')`.mapWith(Number),
        })
        .from(schema.advertisementTable)
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.advertisementTable.productId))
        .innerJoin(schema.advertisementStatsTable, eq(schema.advertisementStatsTable.advertisementId, schema.advertisementTable.id))
        .where(compactConditions([sellerProduct])),
      db
        .select({
          advertisementSpend: sql<number>`coalesce(sum(${schema.adViewCountTable.viewChargeAmount}), 0)`.mapWith(Number),
        })
        .from(schema.adViewCountTable)
        .innerJoin(schema.advertisementTable, eq(schema.advertisementTable.id, schema.adViewCountTable.advertisementId))
        .innerJoin(schema.productTable, eq(schema.productTable.id, schema.advertisementTable.productId))
        .where(
          compactConditions([
            sellerProduct,
            ...dateConditions(schema.adViewCountTable.createdAt, input.startAt, input.endAt),
          ]),
        ),
      db
        .select({
          walletBalance: sql<string>`coalesce(sum(${schema.accountWalletTable.walletBalance}), 0)::numeric(18,2)`,
        })
        .from(schema.accountWalletTable)
        .innerJoin(schema.accountTable, eq(schema.accountTable.id, schema.accountWalletTable.accountId))
        .where(
          compactConditions([
            eq(schema.accountTable.role, "seller"),
            scope.sellerId ? eq(schema.accountTable.id, scope.sellerId) : undefined,
          ]),
        ),
    ]);

  const sales = salesRows[0];
  const refunds = refundRows[0];
  return {
    sellerId: scope.sellerId ?? null,
    timezone,
    startAt: input.startAt?.toISOString() ?? null,
    endAt: input.endAt?.toISOString() ?? null,
    paidOrderCount: sales.paidOrderCount,
    grossMerchandiseValue: sales.grossMerchandiseValue,
    completedRefundAmount: refunds.completedRefundAmount,
    netSales: sales.grossMerchandiseValue - refunds.completedRefundAmount,
    pendingOrderCount: pendingOrderRows[0].value,
    pendingDeliveryCount: pendingDeliveryRows[0].value,
    pendingRefundCount: pendingRefundRows[0].value,
    activeAdvertisementCount: adRows[0].activeAdvertisements,
    depletedAdvertisementCount: adRows[0].depletedAdvertisements,
    advertisementSpend: adSpendRows[0].advertisementSpend,
    walletBalance: walletRows[0].walletBalance,
  };
}

export async function getDashboardPendingTasks(input: DashboardFilters) {
  const kpi = await getDashboardKpi(input);
  return {
    sellerId: kpi.sellerId,
    tasks: [
      { section: "orders", count: kpi.pendingOrderCount, route: "/order/list" },
      { section: "deliveries", count: kpi.pendingDeliveryCount, route: "/delivery/list" },
      { section: "refunds", count: kpi.pendingRefundCount, route: "/refund/list" },
      { section: "advertisements", count: kpi.depletedAdvertisementCount, route: "/advertisement/list" },
    ],
  };
}

export async function getDashboardTimeSeries(
  input: DashboardFilters & {
    metric: "sales" | "orders" | "refunds" | "adViews" | "adSpend";
    interval: "day" | "week" | "month";
  },
) {
  const timezone = validateFilters(input);
  const scope = await resolveAdminSellerScope(input.requesterId, input.sellerId);
  const sellerProduct = scope.sellerId
    ? eq(schema.productTable.sellerId, scope.sellerId)
    : undefined;
  const bucket = (column: any) =>
    sql<string>`date_trunc(${input.interval}, timezone(${timezone}, ${column}))::text`;

  let rows: { bucket: string; value: number }[];
  if (input.metric === "sales" || input.metric === "orders") {
    const bucketExpression = bucket(schema.orderTable.createdAt);
    rows = await db
      .select({
        bucket: bucketExpression,
        value:
          input.metric === "sales"
            ? sql<number>`coalesce(sum(${schema.orderItemTable.lineTotal}), 0)`.mapWith(Number)
            : countDistinct(schema.orderTable.id),
      })
      .from(schema.orderItemTable)
      .innerJoin(schema.orderTable, eq(schema.orderTable.id, schema.orderItemTable.orderId))
      .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
      .where(
        compactConditions([
          eq(schema.orderTable.orderStatus, "paid"),
          sellerProduct,
          ...dateConditions(schema.orderTable.createdAt, input.startAt, input.endAt),
        ]),
      )
      .groupBy(sql.raw("1"))
      .orderBy(sql.raw("1"));
  } else if (input.metric === "refunds") {
    const bucketExpression = bucket(schema.refundItemTable.createdAt);
    rows = await db
      .select({
        bucket: bucketExpression,
        value: sql<number>`coalesce(sum(${schema.refundItemTable.cashRefundAmount}), 0)`.mapWith(Number),
      })
      .from(schema.refundItemTable)
      .innerJoin(schema.orderItemTable, eq(schema.orderItemTable.id, schema.refundItemTable.orderItemId))
      .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
      .where(
        compactConditions([
          eq(schema.refundItemTable.status, "completed"),
          sellerProduct,
          ...dateConditions(schema.refundItemTable.createdAt, input.startAt, input.endAt),
        ]),
      )
      .groupBy(sql.raw("1"))
      .orderBy(sql.raw("1"));
  } else {
    const bucketExpression = bucket(schema.adViewCountTable.createdAt);
    rows = await db
      .select({
        bucket: bucketExpression,
        value:
          input.metric === "adViews"
            ? count(schema.adViewCountTable.id)
            : sql<number>`coalesce(sum(${schema.adViewCountTable.viewChargeAmount}), 0)`.mapWith(Number),
      })
      .from(schema.adViewCountTable)
      .innerJoin(schema.advertisementTable, eq(schema.advertisementTable.id, schema.adViewCountTable.advertisementId))
      .innerJoin(schema.productTable, eq(schema.productTable.id, schema.advertisementTable.productId))
      .where(
        compactConditions([
          sellerProduct,
          ...dateConditions(schema.adViewCountTable.createdAt, input.startAt, input.endAt),
        ]),
      )
      .groupBy(sql.raw("1"))
      .orderBy(sql.raw("1"));
  }

  return {
    sellerId: scope.sellerId ?? null,
    timezone,
    metric: input.metric,
    interval: input.interval,
    points: rows,
  };
}

export async function getRecentAdminActivities(
  input: DashboardFilters & { cursor?: Date; limit?: number },
) {
  validateFilters(input);
  const scope = await resolveAdminSellerScope(input.requesterId, input.sellerId);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conditions: (SQL | undefined)[] = [
    scope.sellerId
      ? eq(schema.adminActivityEventTable.sellerId, scope.sellerId)
      : undefined,
    input.cursor ? lt(schema.adminActivityEventTable.createdAt, input.cursor) : undefined,
    ...dateConditions(schema.adminActivityEventTable.createdAt, input.startAt, input.endAt),
  ];
  const events = await db
    .select()
    .from(schema.adminActivityEventTable)
    .where(compactConditions(conditions))
    .orderBy(desc(schema.adminActivityEventTable.createdAt), desc(schema.adminActivityEventTable.id))
    .limit(limit + 1);
  const hasMore = events.length > limit;
  const data = events.slice(0, limit);
  return {
    activities: data,
    nextCursor: hasMore ? data[data.length - 1]?.createdAt.toISOString() ?? null : null,
  };
}
