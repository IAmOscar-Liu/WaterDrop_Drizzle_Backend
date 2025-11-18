import { and, count, eq, gte, lte, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";

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

export interface ListAdvertisementsParams {
  page?: number;
  limit?: number;
  shuffle?: boolean;
  activeProductOnly?: boolean;
}

/**
 * Lists advertisements with pagination.
 * @param params The pagination parameters.
 * @returns An object containing the advertisement array, total count, and pagination details.
 */
export async function listAdvertisements({
  page = 1,
  limit = 10,
  shuffle = false,
  activeProductOnly = false,
}: ListAdvertisementsParams) {
  const offset = (page - 1) * limit;

  const whereClause = activeProductOnly
    ? eq(schema.productTable.status, "active")
    : undefined;

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

  // Query for the paginated advertisements with their related product
  const results = await db
    .select()
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id)
    )
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(() =>
      shuffle
        ? sql`random()`
        : [sql`${schema.advertisementTable.createdAt} desc`]
    );

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
