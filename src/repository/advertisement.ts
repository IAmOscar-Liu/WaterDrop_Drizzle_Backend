import { and, count, eq, gte, lte, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";

// --- Advertisement Functions ---

/**
 * Creates a new advertisement for a product.
 * @param advertisementData The data for the new advertisement.
 * @returns The newly created advertisement.
 */
export async function createAdvertisement(
  advertisementData: schema.NewAdvertisement
) {
  const [newAd] = await db
    .insert(schema.advertisementTable)
    .values(advertisementData)
    .returning();
  console.log("New advertisement created:", newAd.id);
  return newAd;
}

/**
 * Gets a single advertisement by its ID, including its product, stats, and transactions.
 * @param advertisementId The ID of the advertisement to retrieve.
 * @returns The advertisement object with its related data.
 */
export async function getAdvertisement(advertisementId: string) {
  const advertisement = await db.query.advertisementTable.findFirst({
    where: eq(schema.advertisementTable.id, advertisementId),
    with: {
      product: true,
      stats: true,
      transactions: {
        orderBy: (transactions, { desc }) => [desc(transactions.createdAt)],
      },
    },
  });

  return advertisement;
}

export interface ListAdvertisementsParams {
  page?: number;
  limit?: number;
}

/**
 * Lists advertisements with pagination.
 * @param params The pagination parameters.
 * @returns An object containing the advertisement array, total count, and pagination details.
 */
export async function listAdvertisements({
  page = 1,
  limit = 10,
}: ListAdvertisementsParams) {
  const offset = (page - 1) * limit;

  const whereClause = and(
    eq(schema.advertisementStatsTable.status, "active"),
    gte(schema.advertisementStatsTable.balance, 100)
  );

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .leftJoin(
      schema.advertisementStatsTable,
      eq(
        schema.advertisementTable.id,
        schema.advertisementStatsTable.advertisementId
      )
    )
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated advertisements with their related product
  const results = await db
    .select()
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .leftJoin(
      schema.advertisementStatsTable,
      eq(
        schema.advertisementTable.id,
        schema.advertisementStatsTable.advertisementId
      )
    )
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(() => sql`random()`);

  const advertisements = results.map((r) => ({
    ...r.advertisements,
    product: r.products,
  }));

  return {
    advertisements,
    total,
    page,
    limit,
    totalPages,
  };
}

export interface ListAdminAdvertisementsParams {
  page?: number;
  limit?: number;
  sellerId: string;
}

/**
 * Lists advertisements with pagination.
 * @param params The pagination parameters.
 * @returns An object containing the advertisement array, total count, and pagination details.
 */
export async function listAdminAdvertisements({
  page = 1,
  limit = 10,
  sellerId,
}: ListAdminAdvertisementsParams) {
  const offset = (page - 1) * limit;

  const whereClause = eq(schema.productTable.sellerId, sellerId);
  // const whereClause = undefined;

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .leftJoin(
      schema.advertisementStatsTable,
      eq(
        schema.advertisementTable.id,
        schema.advertisementStatsTable.advertisementId
      )
    )
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated advertisements with their related product
  const results = await db
    .select()
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .leftJoin(
      schema.advertisementStatsTable,
      eq(
        schema.advertisementTable.id,
        schema.advertisementStatsTable.advertisementId
      )
    )
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(() => [sql`${schema.advertisementTable.createdAt} desc`]);

  const advertisements = results.map((r) => ({
    ...r.advertisements,
    product: r.products,
    stats: r.advertisement_stats,
  }));

  return {
    advertisements,
    total,
    page,
    limit,
    totalPages,
  };
}

export async function updateAdvertisementById(
  advertisementId: string,
  updates: Partial<schema.Advertisement>
) {
  const [updatedAd] = await db
    .update(schema.advertisementTable)
    .set(updates)
    .where(eq(schema.advertisementTable.id, advertisementId))
    .returning();
  console.log("Advertisement updated:", updatedAd.id);
  return updatedAd;
}

/**
 * Gets the view count for a specific advertisement, with an optional date range.
 * @param params The advertisement ID and optional start and end dates.
 * @returns The total number of views for the advertisement.
 */
export async function getAdViewCount({
  advertisementId,
  startAt,
  endAt,
}: {
  advertisementId: string;
  startAt?: Date;
  endAt?: Date;
}) {
  const advertisement = await db.query.advertisementTable.findFirst({
    where: eq(schema.advertisementTable.id, advertisementId),
  });
  if (!advertisement) throw new CustomError("Advertisement not found", 404);

  const conditions = [
    eq(schema.adViewCountTable.advertisementId, advertisementId),
  ];

  if (startAt) {
    conditions.push(gte(schema.adViewCountTable.createdAt, startAt));
  }
  if (endAt) {
    conditions.push(lte(schema.adViewCountTable.createdAt, endAt));
  }

  const [result] = await db
    .select({ value: count() })
    .from(schema.adViewCountTable)
    .where(and(...conditions));

  return {
    advertisement,
    stats: {
      startAt: startAt ? startAt.toISOString() : null,
      endAt: endAt ? endAt.toISOString() : null,
      count: result.value,
    },
  };
}

export interface ListAdViewCountParams {
  page?: number;
  limit?: number;
  sellerId: string;
  startAt?: Date;
  endAt?: Date;
}

/**
 * Lists all advertisements along with their view counts within an optional date range.
 * Ads with zero views in the range are included.
 * @param params Optional start and end dates for filtering the view counts.
 * @returns A list of advertisements, each with its associated view count for the period.
 */
export async function listAdViewCount({
  sellerId,
  page = 1,
  limit = 10,
  startAt,
  endAt,
}: ListAdViewCountParams) {
  const conditions = [];
  const offset = (page - 1) * limit;
  if (startAt) conditions.push(gte(schema.adViewCountTable.createdAt, startAt));
  if (endAt) conditions.push(lte(schema.adViewCountTable.createdAt, endAt));

  // Subquery to get view counts within the date range
  const viewCountsSubquery = db
    .select({
      advertisementId: schema.adViewCountTable.advertisementId,
      count: sql<number>`count(${schema.adViewCountTable.id})`
        .mapWith(Number)
        .as("view_count"),
    })
    .from(schema.adViewCountTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(schema.adViewCountTable.advertisementId)
    .as("view_counts");

  const whereClause = eq(schema.productTable.sellerId, sellerId);

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  const results = await db
    .select({
      advertisement: schema.advertisementTable,
      count: sql<number>`coalesce(${viewCountsSubquery.count}, 0)`.mapWith(
        Number
      ),
    })
    .from(schema.advertisementTable)
    .leftJoin(
      viewCountsSubquery,
      eq(schema.advertisementTable.id, viewCountsSubquery.advertisementId)
    )
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .where(whereClause)
    .limit(limit)
    .offset(offset);

  const advertisements = results.map((r) => ({
    ...r.advertisement,
    count: r.count,
  }));

  return {
    startAt: startAt ?? null,
    endAt: endAt ?? null,
    advertisements,
    total,
    page,
    limit,
    totalPages,
  };
}

/**
 * Increases the balance of an advertisement and records the transaction.
 * @param params The advertisement ID, amount to add, and optional metadata.
 * @returns The updated advertisement stats.
 */
export async function depositAdBalance({
  advertisementId,
  amount,
  metadata,
}: {
  advertisementId: string;
  amount: number;
  metadata?: Record<string, any>;
}) {
  if (amount <= 0) {
    throw new CustomError("Deposit amount must be positive.", 400);
  }

  return await db.transaction(async (tx) => {
    // 1. Update the balance
    const [updatedStats] = await tx
      .update(schema.advertisementStatsTable)
      .set({
        balance: sql`${schema.advertisementStatsTable.balance} + ${amount}`,
        status: sql`case when ${schema.advertisementStatsTable.status} = 'depleted' and ${schema.advertisementStatsTable.balance} + ${amount} >= 100 then 'active' else ${schema.advertisementStatsTable.status} end`,
      })
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId)
      )
      .returning();

    if (!updatedStats) {
      throw new CustomError("Advertisement not found.", 404);
    }

    // 2. Create a transaction record
    await tx.insert(schema.advertisementTransactionTable).values({
      advertisementId,
      amount,
      type: "deposit",
      metadata,
    });

    console.log(
      `Increased balance for ad ${advertisementId} by ${amount}. New balance: ${updatedStats.balance}`
    );
    return updatedStats;
  });
}

export async function spendAdBalance({
  advertisementId,
  amount,
}: {
  advertisementId: string;
  amount: number;
}) {
  return await db.transaction(async (tx) => {
    // 1. Check current status
    const [currentStats] = await tx
      .select({ status: schema.advertisementStatsTable.status })
      .from(schema.advertisementStatsTable)
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId)
      );

    if (!currentStats) {
      throw new CustomError("Advertisement not found.", 404);
    }

    if (
      currentStats.status !== "active" &&
      currentStats.status !== "depleted"
    ) {
      throw new CustomError(
        `Cannot spend balance for ad with status: ${currentStats.status}`,
        400
      );
    }

    // 2. Decrease balance and update status if necessary
    const [updatedStats] = await tx
      .update(schema.advertisementStatsTable)
      .set({
        balance: sql`${schema.advertisementStatsTable.balance} - ${amount}`,
        totalSpent: sql`${schema.advertisementStatsTable.totalSpent} + ${amount}`,
        status: sql`case when ${schema.advertisementStatsTable.balance} - ${amount} < 100 then 'depleted' else ${schema.advertisementStatsTable.status} end`,
      })
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId)
      )
      .returning();

    return updatedStats;
  });
}

/**
 * Sets the status of an advertisement.
 * Throws an error if trying to set to 'active' with an insufficient balance.
 * @param advertisementId The ID of the advertisement to update.
 * @param status The new status to set.
 * @returns The updated advertisement stats.
 */
export async function setAdStatus(
  advertisementId: string,
  status: schema.AdvertisementStats["status"]
) {
  if (status === "active") {
    // Check balance before attempting to set to active
    const [stats] = await db
      .select({ balance: schema.advertisementStatsTable.balance })
      .from(schema.advertisementStatsTable)
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId)
      );

    if (!stats) throw new CustomError("Advertisement not found.", 404);
    if (stats.balance < 100) {
      throw new CustomError(
        "Cannot activate ad with balance less than 100.",
        400
      );
    }
  }

  const [updatedStats] = await db
    .update(schema.advertisementStatsTable)
    .set({ status })
    .where(eq(schema.advertisementStatsTable.advertisementId, advertisementId))
    .returning();

  if (!updatedStats) throw new CustomError("Advertisement not found.", 404);

  console.log(`Set status for ad ${advertisementId} to ${status}`);
  return updatedStats;
}
