import { SQL, and, count, eq, gte, inArray, lte, not, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import {
  moneyToMinorUnits,
  minorUnitsToMoney,
  normalizeMoney,
  subtractMoney,
} from "../lib/money";
import {
  effectiveTimezone,
  getLocalDate,
  isCoinLedgerEnabled,
} from "../lib/coinAccounting";
import { isAccountAdmin } from "./account";
import { lockWalletIdempotencyKeyWithTx } from "./accountWallet";
import { recordAdminActivityWithTx } from "./adminActivity";
import { getActiveAdminAccount, resolveAdminSellerScope } from "./adminScope";
import { withProductVariantAggregates } from "./utils/product";
import { returnCoinsToSellerWithTx } from "./coinLedger";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

// --- Advertisement Functions ---

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const activeVariantAvailabilityCondition = sql<boolean>`exists (
  select 1 from ${schema.productVariantTable}
  where ${schema.productVariantTable.productId} = ${schema.productTable.id}
    and ${schema.productVariantTable.status} = 'active'
    and ${schema.productVariantTable.stock} > ${schema.productVariantTable.reserve}
)`;

/**
 * Creates a new advertisement for a product.
 * @param advertisementData The data for the new advertisement.
 * @returns The newly created advertisement.
 */
export async function createAdvertisement(
  advertisementData: schema.NewAdvertisement,
  requesterId?: string,
) {
  return await db.transaction(async (tx) => {
    const [product] = await tx
      .select({
        id: schema.productTable.id,
        sellerId: schema.productTable.sellerId,
      })
      .from(schema.productTable)
      .where(eq(schema.productTable.id, advertisementData.productId))
      .for("update");
    if (!product) throw new CustomError("Product not found.", 404);
    if (requesterId) {
      const requester = await getActiveAdminAccount(requesterId);
      if (
        requester.role === "employee" ||
        (requester.role !== "admin" && product.sellerId !== requester.id)
      ) {
        throw new CustomError(
          "Only the product seller or a platform admin may create its advertisement.",
          403,
        );
      }
    }

    const [currentAdvertisement] = await tx
      .select({ id: schema.advertisementTable.id })
      .from(schema.advertisementTable)
      .innerJoin(
        schema.advertisementStatsTable,
        eq(
          schema.advertisementStatsTable.advertisementId,
          schema.advertisementTable.id,
        ),
      )
      .where(
        and(
          eq(schema.advertisementTable.productId, advertisementData.productId),
          sql`${schema.advertisementStatsTable.status} <> 'archived'`,
        ),
      )
      .limit(1);
    if (currentAdvertisement) {
      throw new CustomError(
        "This product already has a non-archived advertisement.",
        409,
      );
    }

    const [previousAdvertisement] = await tx
      .select({
        id: schema.advertisementTable.id,
        financiallyClosedAt: schema.advertisementTable.financiallyClosedAt,
      })
      .from(schema.advertisementTable)
      .where(eq(schema.advertisementTable.productId, advertisementData.productId))
      .orderBy(sql`${schema.advertisementTable.createdAt} desc`)
      .limit(1);
    if (previousAdvertisement && !previousAdvertisement.financiallyClosedAt) {
      throw new CustomError(
        "The archived advertisement must be financially closed before replacement.",
        409,
      );
    }

    const [newAd] = await tx
      .insert(schema.advertisementTable)
      .values({
        ...advertisementData,
        replacementOfAdvertisementId:
          advertisementData.replacementOfAdvertisementId ??
          previousAdvertisement?.id,
      })
      .returning();

    await tx.insert(schema.advertisementStatsTable).values({
      advertisementId: newAd.id,
    });

    if (isCoinLedgerEnabled()) {
      await tx.insert(schema.advertisementCoinFundingAccountTable).values({
        advertisementId: newAd.id,
        sourceSellerId: product.sellerId,
      });
    }

    return newAd;
  });
}

/**
 * Gets a single advertisement by its ID, including its product, stats, and transactions.
 * @param advertisementId The ID of the advertisement to retrieve.
 * @returns The advertisement object with its related data.
 */
export async function getAdvertisement(
  advertisementId: string,
  requesterId?: string,
) {
  const advertisement = await db.query.advertisementTable.findFirst({
    where: eq(schema.advertisementTable.id, advertisementId),
    with: {
      product: {
        with: {
          variants: {
            where: eq(schema.productVariantTable.status, "active"),
            orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
          },
        },
      },
      stats: true,
      transactions: {
        orderBy: (transactions, { desc }) => [desc(transactions.createdAt)],
      },
    },
  });

  if (!advertisement?.product) {
    return advertisement;
  }
  if (requesterId) {
    const scope = await resolveAdminSellerScope(requesterId);
    if (scope.sellerId && scope.sellerId !== advertisement.product.sellerId) {
      throw new CustomError("You cannot view another seller's advertisement", 403);
    }
  }

  return {
    ...advertisement,
    product: withProductVariantAggregates(advertisement.product),
  };
}

export async function getAdvertisementCoinLedger(
  advertisementId: string,
  requesterId?: string,
) {
  if (!isCoinLedgerEnabled()) {
    throw new CustomError("Coin ledger is not enabled.", 409);
  }
  if (requesterId) {
    const [owner] = await db
      .select({ sellerId: schema.productTable.sellerId })
      .from(schema.advertisementTable)
      .innerJoin(
        schema.productTable,
        eq(schema.productTable.id, schema.advertisementTable.productId),
      )
      .where(eq(schema.advertisementTable.id, advertisementId));
    if (!owner) throw new CustomError("Advertisement not found.", 404);
    if (owner.sellerId !== requesterId && !(await isAccountAdmin(requesterId))) {
      throw new CustomError("You cannot view this advertisement ledger.", 403);
    }
  }
  const fundingAccount = await db.query.advertisementCoinFundingAccountTable.findFirst({
    where: eq(
      schema.advertisementCoinFundingAccountTable.advertisementId,
      advertisementId,
    ),
  });
  if (!fundingAccount) {
    throw new CustomError("Advertisement coin funding account not found.", 404);
  }
  const [cohorts, sellerReturns, fundingTransactions] = await Promise.all([
    db.query.advertisementCoinSettlementCohortTable.findMany({
      where: eq(
        schema.advertisementCoinSettlementCohortTable.fundingAccountId,
        fundingAccount.id,
      ),
      orderBy: (rows, { desc }) => [desc(rows.businessDate)],
      limit: 100,
    }),
    db.query.sellerCoinReturnTransactionTable.findMany({
      where: eq(
        schema.sellerCoinReturnTransactionTable.fundingAccountId,
        fundingAccount.id,
      ),
      orderBy: (rows, { desc }) => [desc(rows.createdAt)],
      limit: 100,
    }),
    db.query.advertisementCoinFundingTransactionTable.findMany({
      where: eq(
        schema.advertisementCoinFundingTransactionTable.fundingAccountId,
        fundingAccount.id,
      ),
      orderBy: (rows, { desc }) => [desc(rows.createdAt)],
      limit: 200,
    }),
  ]);
  return { fundingAccount, cohorts, sellerReturns, fundingTransactions };
}

export interface ListAdvertisementsParams extends PaginationParams {
  userId?: string;
}

/**
 * Lists advertisements with pagination.
 * @param params The pagination parameters.
 * @returns An object containing the advertisement array, total count, and pagination details.
 */
export async function listAdvertisements({
  page = 1,
  limit = 10,
  userId,
}: ListAdvertisementsParams) {
  const pagination = getPagination(page, limit);

  const whereClause = compactConditions([
    eq(schema.productTable.status, "active"),
    activeVariantAvailabilityCondition,
    eq(schema.advertisementStatsTable.status, "active"),
    gte(schema.advertisementStatsTable.balance, 100),
    userId
      ? not(
          sql`${schema.advertisementTable.id}::text = ANY (select unnest(viewed_ads) from user_daily_stats where user_id = ${userId})`,
        )
      : undefined,
  ]);

  const [totalResult, results] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.advertisementTable)
      .leftJoin(
        schema.productTable,
        eq(schema.advertisementTable.productId, schema.productTable.id),
      )
      .leftJoin(
        schema.advertisementStatsTable,
        eq(
          schema.advertisementTable.id,
          schema.advertisementStatsTable.advertisementId,
        ),
      )
      .where(whereClause),
    db
      .select()
      .from(schema.advertisementTable)
      .leftJoin(
        schema.productTable,
        eq(schema.advertisementTable.productId, schema.productTable.id),
      )
      .leftJoin(
        schema.advertisementStatsTable,
        eq(
          schema.advertisementTable.id,
          schema.advertisementStatsTable.advertisementId,
        ),
      )
      .where(whereClause)
      .limit(pagination.limit)
      .offset(pagination.offset)
      .orderBy(() => sql`random()`),
  ]);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  const productIds = results
    .map((result) => result.products?.id)
    .filter((productId): productId is string => Boolean(productId));
  const variantsPromise = productIds.length
    ? db.query.productVariantTable.findMany({
        where: and(
          inArray(schema.productVariantTable.productId, productIds),
          eq(schema.productVariantTable.status, "active"),
        ),
        orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
      })
    : Promise.resolve([] as schema.ProductVariant[]);
  const assignmentPromise = (async () => {
    if (!userId || results.length === 0 || !isCoinLedgerEnabled()) return;

    const [user] = await db
      .select({ timezone: schema.userTable.timezone })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId));
    if (!user) throw new CustomError("User not found.", 404);

    const timezone = effectiveTimezone(user.timezone);
    const userLocalDate = getLocalDate(new Date(), timezone);
    const assignmentBatchId = randomUUID();
    const values = results.flatMap((result) => {
      const advertisement = result.advertisements;
      const product = result.products;
      if (!advertisement || !product) return [];
      return [{
        userId,
        advertisementId: advertisement.id,
        sourceSellerId: product.sellerId,
        assignmentBatchId,
        userLocalDate,
        timezoneSnapshot: timezone,
      }];
    });
    if (values.length > 0) {
      await db
        .insert(schema.advertisementAssignmentTable)
        .values(values)
        .onConflictDoNothing();
    }
  })();
  const [variants] = await Promise.all([variantsPromise, assignmentPromise]);
  const variantsByProductId = new Map<string, typeof variants>();
  variants.forEach((variant) => {
    const productVariants = variantsByProductId.get(variant.productId) ?? [];
    productVariants.push(variant);
    variantsByProductId.set(variant.productId, productVariants);
  });

  const advertisements = results.map((r) => ({
    ...r.advertisements,
    product: r.products
      ? withProductVariantAggregates({
          ...r.products,
          variants: variantsByProductId.get(r.products.id) ?? [],
        })
      : r.products,
  }));

  return {
    advertisements,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export interface ListAdminAdvertisementsParams extends PaginationParams {
  requesterId: string;
  sellerId?: string;
}

/**
 * Lists advertisements with pagination.
 * @param params The pagination parameters.
 * @returns An object containing the advertisement array, total count, and pagination details.
 */
export async function listAdminAdvertisements({
  page = 1,
  limit = 10,
  requesterId,
  sellerId,
}: ListAdminAdvertisementsParams) {
  const pagination = getPagination(page, limit);

  const scope = await resolveAdminSellerScope(requesterId, sellerId);
  const whereClause = scope.sellerId
    ? eq(schema.productTable.sellerId, scope.sellerId)
    : undefined;

  const [totalResult, results] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.advertisementTable)
      .leftJoin(
        schema.productTable,
        eq(schema.advertisementTable.productId, schema.productTable.id),
      )
      .leftJoin(
        schema.advertisementStatsTable,
        eq(
          schema.advertisementTable.id,
          schema.advertisementStatsTable.advertisementId,
        ),
      )
      .where(whereClause),
    db
      .select()
      .from(schema.advertisementTable)
      .leftJoin(
        schema.productTable,
        eq(schema.advertisementTable.productId, schema.productTable.id),
      )
      .leftJoin(
        schema.advertisementStatsTable,
        eq(
          schema.advertisementTable.id,
          schema.advertisementStatsTable.advertisementId,
        ),
      )
      .where(whereClause)
      .limit(pagination.limit)
      .offset(pagination.offset)
      .orderBy(() => [sql`${schema.advertisementTable.createdAt} desc`]),
  ]);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  const productIds = results
    .map((result) => result.products?.id)
    .filter((productId): productId is string => Boolean(productId));
  const variants = productIds.length
    ? await db.query.productVariantTable.findMany({
        where: and(
          inArray(schema.productVariantTable.productId, productIds),
          eq(schema.productVariantTable.status, "active"),
        ),
        orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
      })
    : [];
  const variantsByProductId = new Map<string, typeof variants>();
  variants.forEach((variant) => {
    const productVariants = variantsByProductId.get(variant.productId) ?? [];
    productVariants.push(variant);
    variantsByProductId.set(variant.productId, productVariants);
  });

  const advertisements = results.map((r) => ({
    ...r.advertisements,
    product: r.products
      ? withProductVariantAggregates(
          {
            ...r.products,
            variants: variantsByProductId.get(r.products.id) ?? [],
          },
          "all",
        )
      : r.products,
    stats: r.advertisement_stats,
  }));

  return {
    advertisements,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export async function updateAdvertisementById(
  advertisementId: string,
  updates: Partial<schema.Advertisement>,
  requesterId?: string,
) {
  if (requesterId) {
    const [owner] = await db
      .select({ sellerId: schema.productTable.sellerId })
      .from(schema.advertisementTable)
      .innerJoin(
        schema.productTable,
        eq(schema.productTable.id, schema.advertisementTable.productId),
      )
      .where(eq(schema.advertisementTable.id, advertisementId));
    if (!owner) throw new CustomError("Advertisement not found", 404);
    const requester = await getActiveAdminAccount(requesterId);
    if (
      requester.role === "employee" ||
      (requester.role !== "admin" && owner.sellerId !== requester.id)
    ) {
      throw new CustomError(
        "Only the advertisement seller or a platform admin may update it.",
        403,
      );
    }
  }
  const [updatedAd] = await db
    .update(schema.advertisementTable)
    .set(updates)
    .where(eq(schema.advertisementTable.id, advertisementId))
    .returning();
  return updatedAd;
}

/**
 * Gets the view count for a specific advertisement, with an optional date range.
 * @param params The advertisement ID and optional start and end dates.
 * @returns The total number of views for the advertisement.
 */
export async function getAdViewCount({
  advertisementId,
  requesterId,
  startAt,
  endAt,
}: {
  advertisementId: string;
  requesterId: string;
  startAt?: Date;
  endAt?: Date;
}) {
  const [resultWithOwner] = await db
    .select({
      advertisement: schema.advertisementTable,
      sellerId: schema.productTable.sellerId,
    })
    .from(schema.advertisementTable)
    .innerJoin(
      schema.productTable,
      eq(schema.productTable.id, schema.advertisementTable.productId),
    )
    .where(eq(schema.advertisementTable.id, advertisementId));
  if (!resultWithOwner) throw new CustomError("Advertisement not found", 404);
  if (
    resultWithOwner.sellerId !== requesterId &&
    !(await isAccountAdmin(requesterId))
  ) {
    throw new CustomError(
      "Only the advertisement seller or a platform admin may view these statistics.",
      403,
    );
  }
  const advertisement = resultWithOwner.advertisement;

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

export interface ListAdViewCountParams extends PaginationParams {
  sellerId: string;
  startAt?: Date;
  endAt?: Date;
}

export interface ListPlatformAdViewCountParams extends PaginationParams {
  requesterId: string;
  sellerId?: string;
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
  return listAdViewCounts({ sellerId, page, limit, startAt, endAt });
}

async function listAdViewCounts({
  sellerId,
  page = 1,
  limit = 10,
  startAt,
  endAt,
}: Omit<ListPlatformAdViewCountParams, "requesterId">) {
  const conditions: SQL[] = [];
  const pagination = getPagination(page, limit);
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
    .where(compactConditions(conditions))
    .groupBy(schema.adViewCountTable.advertisementId)
    .as("view_counts");

  const whereClause = sellerId
    ? eq(schema.productTable.sellerId, sellerId)
    : undefined;

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.advertisementTable)
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id),
    )
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  const results = await db
    .select({
      advertisement: schema.advertisementTable,
      count: sql<number>`coalesce(${viewCountsSubquery.count}, 0)`.mapWith(
        Number,
      ),
    })
    .from(schema.advertisementTable)
    .leftJoin(
      viewCountsSubquery,
      eq(schema.advertisementTable.id, viewCountsSubquery.advertisementId),
    )
    .leftJoin(
      schema.productTable,
      eq(schema.advertisementTable.productId, schema.productTable.id),
    )
    .where(whereClause)
    .limit(pagination.limit)
    .offset(pagination.offset);

  const advertisements = results.map((r) => ({
    ...r.advertisement,
    count: r.count,
  }));

  return {
    startAt: startAt ?? null,
    endAt: endAt ?? null,
    advertisements,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export async function listPlatformAdViewCount({
  requesterId,
  sellerId,
  page,
  limit,
  startAt,
  endAt,
}: ListPlatformAdViewCountParams) {
  if (!(await isAccountAdmin(requesterId))) {
    throw new CustomError("Administrator access required.", 403);
  }

  return listAdViewCounts({ sellerId, page, limit, startAt, endAt });
}

/**
 * Increases the balance of an advertisement and records the transaction.
 * @param params The advertisement ID, amount to add, and optional metadata.
 * @returns The updated advertisement stats.
 */
export async function depositAdBalance({
  advertisementId,
  requesterId,
  amount,
  idempotencyKey,
  metadata,
}: {
  advertisementId: string;
  requesterId: string;
  amount: string;
  idempotencyKey: string;
  metadata?: Record<string, any>;
}) {
  if (process.env.ACCOUNT_WALLET_AD_FUNDING_ENABLED !== "true") {
    throw new CustomError(
      "Account-wallet advertisement funding is temporarily disabled.",
      503,
    );
  }

  const normalizedAmount = normalizeMoney(amount);
  const amountInMinorUnits = moneyToMinorUnits(normalizedAmount);
  if (amountInMinorUnits <= BigInt(0)) {
    throw new CustomError("Deposit amount must be positive.", 400);
  }
  if (amountInMinorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CustomError("Deposit amount is too large.", 400);
  }
  const numericAmount = Number(amountInMinorUnits) / 100;

  return await db.transaction(async (tx) => {
    await lockWalletIdempotencyKeyWithTx(tx, idempotencyKey);

    const [advertisement] = await tx
      .select({
        id: schema.advertisementTable.id,
        archivedAt: schema.advertisementTable.archivedAt,
        financiallyClosedAt: schema.advertisementTable.financiallyClosedAt,
        sellerId: schema.productTable.sellerId,
        sellerRole: schema.accountTable.role,
        sellerStatus: schema.accountTable.status,
      })
      .from(schema.advertisementTable)
      .innerJoin(
        schema.productTable,
        eq(schema.productTable.id, schema.advertisementTable.productId),
      )
      .innerJoin(
        schema.accountTable,
        eq(schema.accountTable.id, schema.productTable.sellerId),
      )
      .where(eq(schema.advertisementTable.id, advertisementId))
      .limit(1);
    if (!advertisement) throw new CustomError("Advertisement not found.", 404);

    const [requester] = await tx
      .select({ role: schema.accountTable.role })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.id, requesterId))
      .limit(1);
    if (
      !requester ||
      (requester.role !== "admin" && requesterId !== advertisement.sellerId)
    ) {
      throw new CustomError(
        "Only the owning seller or a platform administrator may fund this advertisement.",
        403,
      );
    }

    const [existingAdvertisementTransaction] = await tx
      .select()
      .from(schema.advertisementTransactionTable)
      .where(
        eq(schema.advertisementTransactionTable.idempotencyKey, idempotencyKey),
      )
      .limit(1);
    if (existingAdvertisementTransaction) {
      if (
        existingAdvertisementTransaction.type !== "wallet_funding" ||
        existingAdvertisementTransaction.advertisementId !== advertisementId ||
        normalizeMoney(existingAdvertisementTransaction.amount.toFixed(2)) !==
          normalizedAmount ||
        !existingAdvertisementTransaction.accountWalletTransactionId
      ) {
        throw new CustomError(
          "Idempotency key was already used for a different advertisement operation.",
          409,
        );
      }

      const [walletTransaction] = await tx
        .select()
        .from(schema.accountWalletTransactionTable)
        .where(
          eq(
            schema.accountWalletTransactionTable.id,
            existingAdvertisementTransaction.accountWalletTransactionId,
          ),
        )
        .limit(1);
      const [wallet] = walletTransaction
        ? await tx
            .select()
            .from(schema.accountWalletTable)
            .where(
              eq(schema.accountWalletTable.id, walletTransaction.walletId),
            )
            .limit(1)
        : [];
      const [stats] = await tx
        .select()
        .from(schema.advertisementStatsTable)
        .where(
          eq(schema.advertisementStatsTable.advertisementId, advertisementId),
        )
        .limit(1);
      if (!walletTransaction || !wallet || !stats) {
        throw new CustomError("Funding ledger link is incomplete.", 409);
      }

      return {
        ...stats,
        balance: Number(
          existingAdvertisementTransaction.balanceAfter ?? stats.balance,
        ),
        wallet: {
          ...wallet,
          walletBalance: walletTransaction.balanceAfter,
        },
        walletTransaction,
        advertisementTransaction: existingAdvertisementTransaction,
        idempotentReplay: true,
      };
    }

    const [conflictingWalletTransaction] = await tx
      .select({ id: schema.accountWalletTransactionTable.id })
      .from(schema.accountWalletTransactionTable)
      .where(
        eq(schema.accountWalletTransactionTable.idempotencyKey, idempotencyKey),
      )
      .limit(1);
    if (conflictingWalletTransaction) {
      throw new CustomError(
        "Idempotency key was already used for a different wallet operation.",
        409,
      );
    }

    if (advertisement.archivedAt || advertisement.financiallyClosedAt) {
      throw new CustomError(
        "Archived or financially closed advertisements cannot receive funding.",
        409,
      );
    }
    if (
      advertisement.sellerRole !== "seller" ||
      advertisement.sellerStatus !== "active"
    ) {
      throw new CustomError(
        "Advertisement funding requires an active seller account.",
        409,
      );
    }

    const [walletBefore] = await tx
      .select()
      .from(schema.accountWalletTable)
      .where(eq(schema.accountWalletTable.accountId, advertisement.sellerId))
      .for("update");
    if (!walletBefore) {
      throw new CustomError(
        "Seller wallet has not been initialized. Run the wallet backfill first.",
        409,
      );
    }
    if (moneyToMinorUnits(walletBefore.walletBalance) < amountInMinorUnits) {
      throw new CustomError("Insufficient seller wallet balance.", 409);
    }

    const [statsBefore] = await tx
      .select()
      .from(schema.advertisementStatsTable)
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId),
      )
      .for("update");
    if (!statsBefore) throw new CustomError("Advertisement not found.", 404);
    if (statsBefore.status === "archived") {
      throw new CustomError("Archived advertisements cannot receive funding.", 409);
    }

    const walletBalanceAfter = subtractMoney(
      walletBefore.walletBalance,
      normalizedAmount,
    );
    const [wallet] = await tx
      .update(schema.accountWalletTable)
      .set({ walletBalance: walletBalanceAfter })
      .where(
        and(
          eq(schema.accountWalletTable.id, walletBefore.id),
          gte(schema.accountWalletTable.walletBalance, normalizedAmount),
        ),
      )
      .returning();
    if (!wallet) {
      throw new CustomError("Insufficient seller wallet balance.", 409);
    }

    const [walletTransaction] = await tx
      .insert(schema.accountWalletTransactionTable)
      .values({
        walletId: wallet.id,
        accountId: advertisement.sellerId,
        actorAccountId: requesterId,
        advertisementId,
        type: "advertisement_funding_debit",
        amount: `-${normalizedAmount}`,
        balanceBefore: walletBefore.walletBalance,
        balanceAfter: walletBalanceAfter,
        idempotencyKey,
        metadata,
      })
      .returning();

    const advertisementBalanceBefore = normalizeMoney(
      statsBefore.balance.toFixed(2),
    );
    const advertisementBalanceAfter = normalizeMoney(
      (statsBefore.balance + numericAmount).toFixed(2),
    );
    const [updatedStats] = await tx
      .update(schema.advertisementStatsTable)
      .set({
        balance: Number(advertisementBalanceAfter),
        status:
          statsBefore.status === "depleted" &&
          Number(advertisementBalanceAfter) >= 100
            ? "active"
            : statsBefore.status,
      })
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId),
      )
      .returning();

    if (!updatedStats) {
      throw new CustomError("Advertisement not found.", 404);
    }

    const [advertisementTransaction] = await tx
      .insert(schema.advertisementTransactionTable)
      .values({
        advertisementId,
        amount: numericAmount,
        sourceSellerId: advertisement.sellerId,
        balanceBefore: advertisementBalanceBefore,
        balanceAfter: advertisementBalanceAfter,
        idempotencyKey,
        accountWalletTransactionId: walletTransaction.id,
        type: "wallet_funding",
        metadata,
      })
      .returning();

    await recordAdminActivityWithTx(tx, {
      actorAccountId: requesterId,
      sellerId: advertisement.sellerId,
      eventType: "advertisement.funded",
      entityType: "advertisement",
      entityId: advertisementId,
      metadata: { amount: normalizedAmount, idempotencyKey },
    });

    return {
      ...updatedStats,
      wallet,
      walletTransaction,
      advertisementTransaction,
      idempotentReplay: false,
    };
  });
}

export async function adjustAdBudget({
  advertisementId,
  requesterId,
  operation,
  amount,
  idempotencyKey,
  metadata,
}: {
  advertisementId: string;
  requesterId: string;
  operation: "increase" | "decrease" | "set";
  amount: string;
  idempotencyKey: string;
  metadata?: Record<string, any>;
}) {
  const [record] = await db
    .select({
      stats: schema.advertisementStatsTable,
      sellerId: schema.productTable.sellerId,
    })
    .from(schema.advertisementTable)
    .innerJoin(
      schema.productTable,
      eq(schema.productTable.id, schema.advertisementTable.productId),
    )
    .innerJoin(
      schema.advertisementStatsTable,
      eq(
        schema.advertisementStatsTable.advertisementId,
        schema.advertisementTable.id,
      ),
    )
    .where(eq(schema.advertisementTable.id, advertisementId))
    .limit(1);
  if (!record) throw new CustomError("Advertisement not found.", 404);
  if (
    requesterId !== record.sellerId &&
    !(await isAccountAdmin(requesterId))
  ) {
    throw new CustomError(
      "Only the owning seller or a platform administrator may fund this advertisement.",
      403,
    );
  }

  if (operation === "decrease") {
    throw new CustomError(
      "operation_not_supported: advertisement budget cannot be withdrawn",
      409,
    );
  }
  if (operation === "increase") {
    return depositAdBalance({
      advertisementId,
      requesterId,
      amount,
      idempotencyKey,
      metadata: { ...metadata, budgetOperation: operation },
    });
  }

  const normalizedTarget = normalizeMoney(amount);

  const current = moneyToMinorUnits(record.stats.balance.toFixed(2));
  const target = moneyToMinorUnits(normalizedTarget);
  if (target < current) {
    throw new CustomError(
      "operation_not_supported: advertisement budget cannot be set lower",
      409,
    );
  }
  if (target === current) {
    return { ...record.stats, noChange: true, idempotentReplay: false };
  }
  return depositAdBalance({
    advertisementId,
    requesterId,
    amount: minorUnitsToMoney(target - current),
    idempotencyKey,
    metadata: {
      ...metadata,
      budgetOperation: operation,
      targetBalance: normalizedTarget,
    },
  });
}

export async function spendAdBalanceWithTx(
  tx: DbTransaction,
  {
    advertisementId,
    amount,
    allowInactive = false,
    sourceSellerId,
    adViewCountId,
    coinAmount,
    idempotencyKey,
  }: {
    advertisementId: string;
    amount: number;
    allowInactive?: boolean;
    sourceSellerId?: string;
    adViewCountId?: string;
    coinAmount?: number;
    idempotencyKey?: string;
  },
) {
  // 1. Check current status
  const [currentStats] = await tx
    .select({
      status: schema.advertisementStatsTable.status,
      balance: schema.advertisementStatsTable.balance,
    })
    .from(schema.advertisementStatsTable)
    .where(eq(schema.advertisementStatsTable.advertisementId, advertisementId))
    .for("update");

  if (!currentStats) {
    throw new CustomError("Advertisement not found.", 404);
  }

  if (
    !allowInactive &&
    currentStats.status !== "active" &&
    currentStats.status !== "depleted"
  ) {
    throw new CustomError(
      `Cannot spend balance for ad with status: ${currentStats.status}`,
      400,
    );
  }

  // 2. Decrease balance and update status if necessary
  const [updatedStats] = await tx
    .update(schema.advertisementStatsTable)
    .set({
      balance: sql`${schema.advertisementStatsTable.balance} - ${amount}`,
      totalSpent: sql`${schema.advertisementStatsTable.totalSpent} + ${amount}`,
      ...(isCoinLedgerEnabled()
        ? {
            netSettledSpentAmount: sql`${schema.advertisementStatsTable.netSettledSpentAmount} + ${amount}`,
          }
        : {}),
      status: sql`case when ${schema.advertisementStatsTable.status} = 'archived' then ${schema.advertisementStatsTable.status} when ${schema.advertisementStatsTable.balance} - ${amount} < 100 then 'depleted' else ${schema.advertisementStatsTable.status} end`,
    })
    .where(eq(schema.advertisementStatsTable.advertisementId, advertisementId))
    .returning();

  const [transaction] = isCoinLedgerEnabled()
    ? await tx
        .insert(schema.advertisementTransactionTable)
        .values({
          advertisementId,
          amount: -amount,
          coinAmount:
            coinAmount === undefined ? undefined : coinAmount.toFixed(2),
          coinToCurrencyRate:
            coinAmount === undefined
              ? undefined
              : (coinAmount / amount).toFixed(6),
          sourceSellerId,
          adViewCountId,
          balanceBefore: currentStats.balance.toFixed(2),
          balanceAfter: updatedStats.balance.toFixed(2),
          type: "view_debit",
          idempotencyKey: idempotencyKey ?? `view-debit:${randomUUID()}`,
        })
        .returning({ id: schema.advertisementTransactionTable.id })
    : [];

  return { ...updatedStats, advertisementTransactionId: transaction?.id };
}

export async function spendAdBalance({
  advertisementId,
  amount,
}: {
  advertisementId: string;
  amount: number;
}) {
  return await db.transaction(async (tx) => {
    return spendAdBalanceWithTx(tx, { advertisementId, amount });
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
  status: schema.AdvertisementStats["status"],
  requesterId: string,
) {
  return db.transaction(async (tx) => {
    const [advertisement] = await tx
      .select()
      .from(schema.advertisementTable)
      .where(eq(schema.advertisementTable.id, advertisementId))
      .for("update");
    const [stats] = await tx
      .select()
      .from(schema.advertisementStatsTable)
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId),
      )
      .for("update");
    if (!advertisement || !stats) {
      throw new CustomError("Advertisement not found.", 404);
    }

    const [product] = await tx
      .select({
        sellerId: schema.productTable.sellerId,
        status: schema.productTable.status,
      })
      .from(schema.productTable)
      .where(eq(schema.productTable.id, advertisement.productId))
      .for("update");
    if (!product) throw new CustomError("Product not found.", 404);
    if (
      product.sellerId !== requesterId &&
      !(await isAccountAdmin(requesterId))
    ) {
      throw new CustomError(
        "Only the advertisement seller or a platform admin may change its status.",
        403,
      );
    }
    if (stats.status === "archived" && status !== "archived") {
      throw new CustomError("An archived advertisement cannot be reactivated.", 409);
    }
    if (status === "active" && product.status !== "active") {
      throw new CustomError(
        "Cannot activate an advertisement for an inactive product.",
        409,
      );
    }
    if (status === "active") {
      const [availableVariant] = await tx
        .select({ id: schema.productVariantTable.id })
        .from(schema.productVariantTable)
        .where(
          and(
            eq(schema.productVariantTable.productId, advertisement.productId),
            eq(schema.productVariantTable.status, "active"),
            sql`${schema.productVariantTable.stock} > ${schema.productVariantTable.reserve}`,
          ),
        )
        .limit(1);
      if (!availableVariant) {
        throw new CustomError(
          "Cannot activate an advertisement without an active, available product variant.",
          409,
        );
      }
    }
    if (status === "active" && stats.balance < 100) {
      throw new CustomError(
        "Cannot activate ad with balance less than 100.",
        409,
      );
    }
    if (status === "archived" && stats.status !== "archived") {
      const graceHours = Number(process.env.AD_ARCHIVE_GRACE_HOURS ?? 24);
      if (!Number.isFinite(graceHours) || graceHours <= 0) {
        throw new Error("AD_ARCHIVE_GRACE_HOURS must be a positive number.");
      }
      const archivedAt = new Date();
      await tx
        .update(schema.advertisementTable)
        .set({
          archivedAt,
          archiveGraceEndsAt: new Date(
            archivedAt.getTime() + graceHours * 60 * 60 * 1000,
          ),
        })
        .where(eq(schema.advertisementTable.id, advertisementId));
    }
    const [updatedStats] = await tx
      .update(schema.advertisementStatsTable)
      .set({ status })
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId),
      )
      .returning();
    if (stats.status !== status) {
      await recordAdminActivityWithTx(tx, {
        actorAccountId: requesterId,
        sellerId: product.sellerId,
        eventType: "advertisement.status_changed",
        entityType: "advertisement",
        entityId: advertisementId,
        metadata: { previousStatus: stats.status, status },
      });
    }
    return updatedStats;
  });
}

export async function financiallyCloseAdvertisement(
  advertisementId: string,
  requesterId?: string,
) {
  if (!isCoinLedgerEnabled()) {
    throw new CustomError("Coin ledger is not enabled.", 409);
  }
  return db.transaction(async (tx) => {
    const [advertisement] = await tx
      .select()
      .from(schema.advertisementTable)
      .where(eq(schema.advertisementTable.id, advertisementId))
      .for("update");
    const [stats] = await tx
      .select()
      .from(schema.advertisementStatsTable)
      .where(
        eq(schema.advertisementStatsTable.advertisementId, advertisementId),
      )
      .for("update");
    if (!advertisement || !stats) {
      throw new CustomError("Advertisement not found.", 404);
    }
    if (requesterId) {
      const [product] = await tx
        .select({ sellerId: schema.productTable.sellerId })
        .from(schema.productTable)
        .where(eq(schema.productTable.id, advertisement.productId));
      if (
        product?.sellerId !== requesterId &&
        !(await isAccountAdmin(requesterId))
      ) {
        throw new CustomError("You cannot close this advertisement.", 403);
      }
    }
    if (stats.status !== "archived" || !advertisement.archivedAt) {
      throw new CustomError(
        "Advertisement must be archived before financial closure.",
        409,
      );
    }
    if (
      advertisement.archiveGraceEndsAt &&
      advertisement.archiveGraceEndsAt > new Date()
    ) {
      throw new CustomError(
        "Advertisement archive grace period has not ended.",
        409,
      );
    }
    if (advertisement.financiallyClosedAt) return advertisement;

    const [account] = await tx
      .select()
      .from(schema.advertisementCoinFundingAccountTable)
      .where(
        eq(
          schema.advertisementCoinFundingAccountTable.advertisementId,
          advertisementId,
        ),
      )
      .for("update");
    if (account) {
      const [{ pendingDemand }] = await tx
        .select({
          pendingDemand: sql<number>`count(*)`,
        })
        .from(schema.treasureBoxRewardAllocationTable)
        .where(
          and(
            eq(
              schema.treasureBoxRewardAllocationTable.fundingAccountId,
              account.id,
            ),
            eq(schema.treasureBoxRewardAllocationTable.status, "demand"),
          ),
        );
      if (Number(pendingDemand) > 0) {
        throw new CustomError(
          "Advertisement still has unsettled treasure-box claims.",
          409,
        );
      }
      const availableUnits = Math.round(
        Number(account.sellerFundingAvailableAmount) * 100,
      );
      if (availableUnits > 0) {
        await returnCoinsToSellerWithTx(tx, {
          fundingAccountId: account.id,
          reason: "unacquired_surplus",
          coinUnits: availableUnits,
          idempotencyKey: `financial-close-surplus:${advertisementId}`,
        });
      }
      const outstanding = Number(account.platformAdvanceOutstandingAmount);
      if (outstanding > 0) {
        await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
          fundingAccountId: account.id,
          type: "platform_advance_written_off_archive",
          coinAmount: outstanding.toFixed(2),
          currencyEquivalent: (outstanding / 10).toFixed(2),
          coinToCurrencyRate: account.coinToCurrencyRate,
          idempotencyKey: `archive-writeoff:${advertisementId}`,
        });
      }
      await tx
        .update(schema.advertisementCoinFundingAccountTable)
        .set({
          sellerFundingAvailableAmount: "0.00",
          platformAdvanceOutstandingAmount: "0.00",
          platformPromotionalExpenseAmount: sql`${schema.advertisementCoinFundingAccountTable.platformPromotionalExpenseAmount} + ${account.platformAdvanceOutstandingAmount}`,
          status: "closed",
          closedAt: new Date(),
        })
        .where(eq(schema.advertisementCoinFundingAccountTable.id, account.id));
    }
    const [closed] = await tx
      .update(schema.advertisementTable)
      .set({ financiallyClosedAt: new Date() })
      .where(eq(schema.advertisementTable.id, advertisementId))
      .returning();
    return closed;
  });
}

export async function transferArchivedAdvertisementBalance(params: {
  sourceAdvertisementId: string;
  destinationAdvertisementId: string;
  amount: number;
  idempotencyKey: string;
  requesterId?: string;
}) {
  if (!isCoinLedgerEnabled()) {
    throw new CustomError("Coin ledger is not enabled.", 409);
  }
  if (params.amount <= 0) {
    throw new CustomError("Transfer amount must be positive.", 400);
  }
  return db.transaction(async (tx) => {
    const orderedIds = [
      params.sourceAdvertisementId,
      params.destinationAdvertisementId,
    ].sort();
    if (orderedIds[0] === orderedIds[1]) {
      throw new CustomError("Source and destination ads must differ.", 400);
    }
    await tx
      .select({ id: schema.advertisementTable.id })
      .from(schema.advertisementTable)
      .where(inArray(schema.advertisementTable.id, orderedIds))
      .orderBy(schema.advertisementTable.id)
      .for("update");
    const rows = await tx
      .select({
        advertisement: schema.advertisementTable,
        stats: schema.advertisementStatsTable,
        sellerId: schema.productTable.sellerId,
      })
      .from(schema.advertisementTable)
      .innerJoin(
        schema.advertisementStatsTable,
        eq(
          schema.advertisementStatsTable.advertisementId,
          schema.advertisementTable.id,
        ),
      )
      .innerJoin(
        schema.productTable,
        eq(schema.productTable.id, schema.advertisementTable.productId),
      )
      .where(inArray(schema.advertisementTable.id, orderedIds));
    const source = rows.find(
      (row) => row.advertisement.id === params.sourceAdvertisementId,
    );
    const destination = rows.find(
      (row) => row.advertisement.id === params.destinationAdvertisementId,
    );
    if (!source || !destination) {
      throw new CustomError("Advertisement not found.", 404);
    }
    if (
      params.requesterId &&
      source.sellerId !== params.requesterId &&
      !(await isAccountAdmin(params.requesterId))
    ) {
      throw new CustomError("You cannot transfer this advertisement balance.", 403);
    }
    if (
      source.stats.status !== "archived" ||
      !source.advertisement.financiallyClosedAt
    ) {
      throw new CustomError(
        "Source advertisement must be archived and financially closed.",
        409,
      );
    }
    if (destination.stats.status === "archived") {
      throw new CustomError("Destination advertisement is archived.", 409);
    }
    if (
      source.advertisement.productId !== destination.advertisement.productId ||
      source.sellerId !== destination.sellerId ||
      destination.advertisement.replacementOfAdvertisementId !==
        source.advertisement.id
    ) {
      throw new CustomError(
        "Balance may only move to the source ad's direct replacement.",
        409,
      );
    }
    const existing = await tx.query.advertisementBalanceTransferTable.findFirst({
      where: eq(
        schema.advertisementBalanceTransferTable.idempotencyKey,
        params.idempotencyKey,
      ),
    });
    if (existing) return existing;
    if (source.stats.balance < params.amount) {
      throw new CustomError("Insufficient archived advertisement balance.", 400);
    }
    const sourceAfter = source.stats.balance - params.amount;
    const destinationAfter = destination.stats.balance + params.amount;
    const coinAmount = (params.amount * 10).toFixed(2);
    await tx
      .update(schema.advertisementStatsTable)
      .set({ balance: sourceAfter })
      .where(eq(schema.advertisementStatsTable.id, source.stats.id));
    await tx
      .update(schema.advertisementStatsTable)
      .set({ balance: destinationAfter })
      .where(eq(schema.advertisementStatsTable.id, destination.stats.id));
    const [transfer] = await tx
      .insert(schema.advertisementBalanceTransferTable)
      .values({
        sourceAdvertisementId: source.advertisement.id,
        destinationAdvertisementId: destination.advertisement.id,
        sourceSellerId: source.sellerId,
        coinAmount,
        coinToCurrencyRate: "10.000000",
        currencyAmount: params.amount.toFixed(2),
        sourceBalanceBefore: source.stats.balance.toFixed(2),
        sourceBalanceAfter: sourceAfter.toFixed(2),
        destinationBalanceBefore: destination.stats.balance.toFixed(2),
        destinationBalanceAfter: destinationAfter.toFixed(2),
        idempotencyKey: params.idempotencyKey,
      })
      .returning();
    await tx.insert(schema.advertisementTransactionTable).values([
      {
        advertisementId: source.advertisement.id,
        amount: -params.amount,
        coinAmount,
        coinToCurrencyRate: "10.000000",
        sourceSellerId: source.sellerId,
        balanceBefore: source.stats.balance.toFixed(2),
        balanceAfter: sourceAfter.toFixed(2),
        type: "balance_transfer_out",
        idempotencyKey: `transfer-out:${params.idempotencyKey}`,
      },
      {
        advertisementId: destination.advertisement.id,
        amount: params.amount,
        coinAmount,
        coinToCurrencyRate: "10.000000",
        sourceSellerId: source.sellerId,
        balanceBefore: destination.stats.balance.toFixed(2),
        balanceAfter: destinationAfter.toFixed(2),
        type: "balance_transfer_in",
        idempotencyKey: `transfer-in:${params.idempotencyKey}`,
      },
    ]);
    return transfer;
  });
}
