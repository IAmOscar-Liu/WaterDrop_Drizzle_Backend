import { and, count, eq, ilike, inArray, or, SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";

/**
 * Finds an existing collection for a user and product, or creates a new one if it doesn't exist.
 * This prevents duplicate collection entries for the same user and product.
 *
 * @param collectionData The data for the collection, including userId and productId.
 * @returns The existing or newly created collection.
 */
export async function findOrCreateCollection(
  collectionData: Omit<schema.NewCollection, "id" | "createdAt" | "updatedAt">
) {
  // Check if a collection for this user and product already exists
  const existingCollection = await db.query.collectionTable.findFirst({
    where: and(
      eq(schema.collectionTable.userId, collectionData.userId),
      eq(schema.collectionTable.productId, collectionData.productId)
    ),
  });

  if (existingCollection) {
    console.log(
      `Product ${collectionData.productId} already in user ${collectionData.userId}'s collection.`
    );
    return existingCollection;
  }

  // If not, create a new one
  const [newCollection] = await db
    .insert(schema.collectionTable)
    .values(collectionData)
    .returning();

  return newCollection;
}

export async function removeCollection(userId: string, productId: string) {
  const [deletedCollection] = await db
    .delete(schema.collectionTable)
    .where(
      and(
        eq(schema.collectionTable.userId, userId),
        eq(schema.collectionTable.productId, productId)
      )
    )
    .returning();

  if (!deletedCollection) {
    throw new CustomError("Collection not found", 404);
  }

  console.log(`Removed product ${productId} from user ${userId}'s collection.`);
  return deletedCollection;
}

export interface ListCollectionsParams {
  userId: string;
  page?: number;
  limit?: number;
  search?: string;
}

export async function listCollections({
  userId,
  page = 1,
  limit = 10,
  search,
}: ListCollectionsParams) {
  const offset = (page - 1) * limit;

  const conditions: (SQL | undefined)[] = [
    eq(schema.collectionTable.userId, userId),
  ];

  if (search) {
    const searchTerm = `%${search}%`;
    // Subquery to find product IDs that match the search term
    const matchingProductIds = db
      .select({ id: schema.productTable.id })
      .from(schema.productTable)
      .where(
        or(
          ilike(schema.productTable.name, searchTerm),
          ilike(schema.productTable.description, searchTerm)
        )
      );

    conditions.push(
      inArray(schema.collectionTable.productId, matchingProductIds)
    );
  }

  const whereClause = and(...conditions);

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.collectionTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for paginated collections
  const collections = await db.query.collectionTable.findMany({
    where: whereClause,
    limit,
    offset,
    with: {
      product: true,
    },
  });

  return {
    collections,
    total,
    page,
    limit,
    totalPages,
  };
}
