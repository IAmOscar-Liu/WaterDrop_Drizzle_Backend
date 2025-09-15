import { count, sql } from "drizzle-orm";

import * as schema from "../db/schema";
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
  console.log("New advertisement created:", newAd);
  return newAd;
}

interface ListAdvertisementsParams {
  page?: number;
  limit?: number;
  shuffle?: boolean;
}

/**
 * Lists advertisements with pagination.
 * @param params The pagination parameters.
 * @returns An object containing the advertisement array, total count, and pagination details.
 */
export async function listAdvertisements({
  page = 1,
  limit = 10,
  shuffle = true,
}: ListAdvertisementsParams) {
  const offset = (page - 1) * limit;

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.advertisementTable);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated advertisements with their related product
  const advertisements = await db.query.advertisementTable.findMany({
    with: {
      product: true,
    },
    limit: limit,
    offset: offset,
    // orderBy: (advertisements, { desc }) => [desc(advertisements.createdAt)],
    orderBy: shuffle
      ? sql`random()`
      : (advertisements, { desc }) => [desc(advertisements.createdAt)],
  });

  return {
    advertisements,
    total,
    page,
    limit,
    totalPages,
  };
}
