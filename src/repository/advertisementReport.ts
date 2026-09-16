import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  SQL,
  sql,
} from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { resolveAdminSellerScope } from "./adminScope";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

export type AdvertisementMetricsInput = PaginationParams & {
  requesterId: string;
  sellerId?: string;
  productId?: string;
  status?: schema.AdvertisementStats["status"];
  startAt?: Date;
  endAt?: Date;
};

async function viewAggregates(
  advertisementIds: string[],
  startAt?: Date,
  endAt?: Date,
) {
  if (!advertisementIds.length) return new Map<string, any>();
  const rows = await db
    .select({
      advertisementId: schema.adViewCountTable.advertisementId,
      completedViewCount: count(schema.adViewCountTable.id),
      periodViewSpend: sql<string>`coalesce(sum(${schema.adViewCountTable.viewChargeAmount}), 0)::numeric(18,2)`,
      periodFundedCoinAmount: sql<string>`coalesce(sum(${schema.adViewCountTable.fundedCoinAmount}), 0)::numeric(18,2)`,
    })
    .from(schema.adViewCountTable)
    .where(
      compactConditions([
        inArray(schema.adViewCountTable.advertisementId, advertisementIds),
        startAt ? gte(schema.adViewCountTable.createdAt, startAt) : undefined,
        endAt ? lte(schema.adViewCountTable.createdAt, endAt) : undefined,
      ]),
    )
    .groupBy(schema.adViewCountTable.advertisementId);
  return new Map(rows.map((row) => [row.advertisementId, row]));
}

export async function listAdvertisementMetrics(input: AdvertisementMetricsInput) {
  if (input.startAt && input.endAt && input.startAt > input.endAt) {
    throw new CustomError("startAt must be before endAt", 400);
  }
  const scope = await resolveAdminSellerScope(input.requesterId, input.sellerId);
  const pagination = getPagination(input.page, input.limit);
  const conditions: (SQL | undefined)[] = [
    scope.sellerId ? eq(schema.productTable.sellerId, scope.sellerId) : undefined,
    input.productId ? eq(schema.productTable.id, input.productId) : undefined,
    input.status ? eq(schema.advertisementStatsTable.status, input.status) : undefined,
  ];
  const where = compactConditions(conditions);
  const [[totalRow], advertisements] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.advertisementTable)
      .innerJoin(schema.productTable, eq(schema.productTable.id, schema.advertisementTable.productId))
      .innerJoin(schema.advertisementStatsTable, eq(schema.advertisementStatsTable.advertisementId, schema.advertisementTable.id))
      .where(where),
    db
      .select({
        advertisement: schema.advertisementTable,
        product: {
          id: schema.productTable.id,
          sellerId: schema.productTable.sellerId,
          name: schema.productTable.name,
        },
        stats: schema.advertisementStatsTable,
        fundingAccount: schema.advertisementCoinFundingAccountTable,
      })
      .from(schema.advertisementTable)
      .innerJoin(schema.productTable, eq(schema.productTable.id, schema.advertisementTable.productId))
      .innerJoin(schema.advertisementStatsTable, eq(schema.advertisementStatsTable.advertisementId, schema.advertisementTable.id))
      .leftJoin(
        schema.advertisementCoinFundingAccountTable,
        eq(schema.advertisementCoinFundingAccountTable.advertisementId, schema.advertisementTable.id),
      )
      .where(where)
      .orderBy(desc(schema.advertisementTable.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
  ]);
  const aggregateMap = await viewAggregates(
    advertisements.map(({ advertisement }) => advertisement.id),
    input.startAt,
    input.endAt,
  );
  return {
    advertisements: advertisements.map((row) => ({
      ...row,
      completedViewCount: aggregateMap.get(row.advertisement.id)?.completedViewCount ?? 0,
      periodViewSpend: aggregateMap.get(row.advertisement.id)?.periodViewSpend ?? "0.00",
      periodFundedCoinAmount:
        aggregateMap.get(row.advertisement.id)?.periodFundedCoinAmount ?? "0.00",
      grossViewSpend: row.stats.totalSpent,
      sellerReturnedAmount: row.stats.sellerReturnedCurrencyAmount,
      netSettledSpend: row.stats.netSettledSpentAmount,
      platformAdvanceOutstanding:
        row.fundingAccount?.platformAdvanceOutstandingAmount ?? "0.00",
      platformPromotionalExpense:
        row.fundingAccount?.platformPromotionalExpenseAmount ?? "0.00",
    })),
    startAt: input.startAt?.toISOString() ?? null,
    endAt: input.endAt?.toISOString() ?? null,
    page: pagination.page,
    limit: pagination.limit,
    total: totalRow.total,
    totalPages: getTotalPages(totalRow.total, pagination.limit),
  };
}

export async function getProductAdvertisementDashboard(input: {
  requesterId: string;
  productId: string;
  startAt?: Date;
  endAt?: Date;
}) {
  const product = await db.query.productTable.findFirst({
    where: eq(schema.productTable.id, input.productId),
  });
  if (!product) throw new CustomError("Product not found", 404);
  const scope = await resolveAdminSellerScope(input.requesterId);
  if (scope.sellerId && scope.sellerId !== product.sellerId) {
    throw new CustomError("You cannot access another seller's product", 403);
  }
  const metrics = await listAdvertisementMetrics({
    requesterId: input.requesterId,
    sellerId: scope.isPlatformAdmin ? product.sellerId : undefined,
    productId: input.productId,
    startAt: input.startAt,
    endAt: input.endAt,
    page: 1,
    limit: 100,
  });
  const ids = metrics.advertisements.map((row) => row.advertisement.id);
  const daily = ids.length
    ? await db
        .select({
          date: sql<string>`date_trunc('day', timezone('Asia/Taipei', ${schema.adViewCountTable.createdAt}))::date::text`,
          views: count(schema.adViewCountTable.id),
          spend: sql<string>`coalesce(sum(${schema.adViewCountTable.viewChargeAmount}), 0)::numeric(18,2)`,
          fundedCoins: sql<string>`coalesce(sum(${schema.adViewCountTable.fundedCoinAmount}), 0)::numeric(18,2)`,
        })
        .from(schema.adViewCountTable)
        .where(
          compactConditions([
            inArray(schema.adViewCountTable.advertisementId, ids),
            input.startAt ? gte(schema.adViewCountTable.createdAt, input.startAt) : undefined,
            input.endAt ? lte(schema.adViewCountTable.createdAt, input.endAt) : undefined,
          ]),
        )
        .groupBy(sql`date_trunc('day', timezone('Asia/Taipei', ${schema.adViewCountTable.createdAt}))::date`)
        .orderBy(sql`date_trunc('day', timezone('Asia/Taipei', ${schema.adViewCountTable.createdAt}))::date`)
    : [];
  return { product, advertisements: metrics.advertisements, daily };
}
