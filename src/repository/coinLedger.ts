import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  effectiveTimezone,
  fromCoinUnits,
  getEndOfNextLocalMonth,
  getLocalMonth,
  isCoinLedgerEnabled,
  toCoinUnits,
} from "../lib/coinAccounting";
import db, { client } from "../lib/initDB";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ASSIGNMENT_CLEANUP_BATCH_SIZE = 5_000;
const DEFAULT_MAINTENANCE_CONCURRENCY = 5;
const MAINTENANCE_ADVISORY_LOCK_KEY = "waterdrop:coin-ledger-maintenance";

function getMaintenanceConcurrency() {
  const value = Number(
    process.env.COIN_LEDGER_MAINTENANCE_CONCURRENCY ??
      DEFAULT_MAINTENANCE_CONCURRENCY,
  );
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      "COIN_LEDGER_MAINTENANCE_CONCURRENCY must be a positive integer.",
    );
  }
  return value;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  const settledWorkers = await Promise.allSettled(workers);
  const failedWorker = settledWorkers.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedWorker) throw failedWorker.reason;
  return results;
}

function getRetentionDays(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

type SellerReturnParams = {
  fundingAccountId: string;
  reason: schema.NewSellerCoinReturnTransaction["reason"];
  coinUnits: number;
  idempotencyKey: string;
  settlementCohortId?: string | null;
  rewardAllocationId?: string | null;
  userCoinLotId?: string | null;
};

async function getSellerFundedUnitsForOperation(
  tx: DbTransaction,
  lot: schema.UserCoinLot,
  operationUnits: number,
) {
  if (!lot.fundingAccountId) return 0;
  const [{ reclassified, alreadyReturned }] = await tx
    .select({
      reclassified: sql<string>`coalesce((select sum(${schema.advertisementCoinFundingTransactionTable.coinAmount}) from ${schema.advertisementCoinFundingTransactionTable} where ${schema.advertisementCoinFundingTransactionTable.userCoinLotId} = ${lot.id} and ${schema.advertisementCoinFundingTransactionTable.type} = 'funding_source_reclassified'), 0)`,
      alreadyReturned: sql<string>`coalesce((select sum(${schema.sellerCoinReturnTransactionTable.coinAmount}) from ${schema.sellerCoinReturnTransactionTable} where ${schema.sellerCoinReturnTransactionTable.userCoinLotId} = ${lot.id}), 0)`,
    })
    .from(schema.userCoinLotTable)
    .where(eq(schema.userCoinLotTable.id, lot.id));
  const reclassifiedUnits = toCoinUnits(reclassified);
  if (lot.currentFunderType === "seller" && reclassifiedUnits === 0) {
    return operationUnits;
  }
  return Math.min(
    operationUnits,
    Math.max(0, reclassifiedUnits - toCoinUnits(alreadyReturned)),
  );
}

async function reversePlatformFundingWithTx(
  tx: DbTransaction,
  params: {
    fundingAccountId: string;
    coinUnits: number;
    userCoinLotId: string;
    idempotencyKey: string;
  },
) {
  if (params.coinUnits <= 0) return;
  const [account] = await tx
    .select()
    .from(schema.advertisementCoinFundingAccountTable)
    .where(
      eq(
        schema.advertisementCoinFundingAccountTable.id,
        params.fundingAccountId,
      ),
    )
    .for("update");
  if (!account) return;
  const outstandingUnits = Math.min(
    params.coinUnits,
    toCoinUnits(account.platformAdvanceOutstandingAmount),
  );
  const promotionalUnits = Math.min(
    params.coinUnits - outstandingUnits,
    toCoinUnits(account.platformPromotionalExpenseAmount),
  );
  const totalUnits = outstandingUnits + promotionalUnits;
  if (totalUnits <= 0) return;
  await tx
    .update(schema.advertisementCoinFundingAccountTable)
    .set({
      platformAdvanceOutstandingAmount: sql`${schema.advertisementCoinFundingAccountTable.platformAdvanceOutstandingAmount} - ${fromCoinUnits(outstandingUnits)}`,
      platformPromotionalExpenseAmount: sql`${schema.advertisementCoinFundingAccountTable.platformPromotionalExpenseAmount} - ${fromCoinUnits(promotionalUnits)}`,
      platformFundedConsumedAmount: sql`greatest(${schema.advertisementCoinFundingAccountTable.platformFundedConsumedAmount} - ${fromCoinUnits(totalUnits)}, 0)`,
    })
    .where(eq(schema.advertisementCoinFundingAccountTable.id, account.id));
  if (outstandingUnits > 0) {
    await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
      fundingAccountId: account.id,
      type: "platform_advance_cancelled_expiry",
      coinAmount: fromCoinUnits(outstandingUnits),
      currencyEquivalent: (outstandingUnits / 1000).toFixed(2),
      coinToCurrencyRate: account.coinToCurrencyRate,
      userCoinLotId: params.userCoinLotId,
      idempotencyKey: `${params.idempotencyKey}:advance`,
    });
  }
  if (promotionalUnits > 0) {
    await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
      fundingAccountId: account.id,
      type: "manual_adjustment",
      coinAmount: fromCoinUnits(promotionalUnits),
      currencyEquivalent: (promotionalUnits / 1000).toFixed(2),
      coinToCurrencyRate: account.coinToCurrencyRate,
      userCoinLotId: params.userCoinLotId,
      idempotencyKey: `${params.idempotencyKey}:promotional-expense`,
      metadata: { action: "reverse_promotional_expense_after_expiry" },
    });
  }
}

export async function reclassifyRepaidPlatformAdvanceWithTx(
  tx: DbTransaction,
  params: {
    fundingAccountId: string;
    settlementCohortId: string;
    adViewCountId: string;
    repaidUnits: number;
    coinToCurrencyRate: string;
  },
) {
  let remainingUnits = params.repaidUnits;
  if (remainingUnits <= 0) return;
  const platformLots = await tx
    .select()
    .from(schema.userCoinLotTable)
    .where(
      and(
        eq(
          schema.userCoinLotTable.fundingAccountId,
          params.fundingAccountId,
        ),
        eq(schema.userCoinLotTable.currentFunderType, "platform"),
      ),
    )
    .orderBy(asc(schema.userCoinLotTable.createdAt))
    .for("update");
  for (const lot of platformLots) {
    if (remainingUnits <= 0) break;
    const [{ reclassified }] = await tx
      .select({
        reclassified: sql<string>`coalesce(sum(${schema.advertisementCoinFundingTransactionTable.coinAmount}), 0)`,
      })
      .from(schema.advertisementCoinFundingTransactionTable)
      .where(
        and(
          eq(
            schema.advertisementCoinFundingTransactionTable.userCoinLotId,
            lot.id,
          ),
          eq(
            schema.advertisementCoinFundingTransactionTable.type,
            "funding_source_reclassified",
          ),
        ),
      );
    const reclassifiedUnits = toCoinUnits(reclassified);
    const availableToReclassify = Math.max(
      0,
      toCoinUnits(lot.originalAmount) - reclassifiedUnits,
    );
    const units = Math.min(remainingUnits, availableToReclassify);
    if (units <= 0) continue;
    const amount = fromCoinUnits(units);
    await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
      fundingAccountId: params.fundingAccountId,
      settlementCohortId: params.settlementCohortId,
      type: "funding_source_reclassified",
      coinAmount: amount,
      currencyEquivalent: (units / 1000).toFixed(2),
      coinToCurrencyRate: params.coinToCurrencyRate,
      adViewCountId: params.adViewCountId,
      userCoinLotId: lot.id,
      idempotencyKey: `funding-reclassified:${params.adViewCountId}:${lot.id}`,
    });
    if (lot.rewardAllocationId) {
      await tx
        .update(schema.treasureBoxRewardAllocationTable)
        .set({
          platformRepaidCoinAmount: sql`${schema.treasureBoxRewardAllocationTable.platformRepaidCoinAmount} + ${amount}`,
        })
        .where(
          eq(
            schema.treasureBoxRewardAllocationTable.id,
            lot.rewardAllocationId,
          ),
        );
    }
    if (reclassifiedUnits + units >= toCoinUnits(lot.originalAmount)) {
      await tx
        .update(schema.userCoinLotTable)
        .set({ currentFunderType: "seller" })
        .where(eq(schema.userCoinLotTable.id, lot.id));
    }
    remainingUnits -= units;
  }
  // A remainder can only belong to a pre-cutover/legacy advance with no lot.
  // The account-level repayment remains authoritative for that remainder.
}

async function returnCoinsToSellerWithTx(
  tx: DbTransaction,
  params: SellerReturnParams,
) {
  if (params.coinUnits <= 0) return null;
  const [account] = await tx
    .select()
    .from(schema.advertisementCoinFundingAccountTable)
    .where(
      eq(
        schema.advertisementCoinFundingAccountTable.id,
        params.fundingAccountId,
      ),
    )
    .for("update");
  if (!account) throw new Error("Coin funding account not found.");

  const [stats] = await tx
    .select()
    .from(schema.advertisementStatsTable)
    .where(
      eq(
        schema.advertisementStatsTable.advertisementId,
        account.advertisementId,
      ),
    )
    .for("update");
  if (!stats) throw new Error("Advertisement stats not found.");

  const coinAmount = fromCoinUnits(params.coinUnits);
  const currencyAmount = (params.coinUnits / 1000).toFixed(2);
  const balanceAfter = stats.balance + Number(currencyAmount);
  const [sellerReturn] = await tx
    .insert(schema.sellerCoinReturnTransactionTable)
    .values({
      sourceSellerId: account.sourceSellerId,
      advertisementId: account.advertisementId,
      fundingAccountId: account.id,
      settlementCohortId: params.settlementCohortId,
      rewardAllocationId: params.rewardAllocationId,
      userCoinLotId: params.userCoinLotId,
      reason: params.reason,
      coinAmount,
      coinToCurrencyRate: account.coinToCurrencyRate,
      currencyEquivalent: currencyAmount,
      destinationReferenceId: account.advertisementId,
      idempotencyKey: params.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (!sellerReturn) return null;

  await tx
    .update(schema.advertisementStatsTable)
    .set({
      balance: balanceAfter,
      sellerReturnedCurrencyAmount: sql`${schema.advertisementStatsTable.sellerReturnedCurrencyAmount} + ${currencyAmount}`,
      returnedCoinAmount: sql`${schema.advertisementStatsTable.returnedCoinAmount} + ${coinAmount}`,
      netSettledSpentAmount: sql`greatest(${schema.advertisementStatsTable.totalSpent} - (${schema.advertisementStatsTable.sellerReturnedCurrencyAmount} + ${currencyAmount}), 0)`,
    })
    .where(eq(schema.advertisementStatsTable.id, stats.id));
  await tx.insert(schema.advertisementTransactionTable).values({
    advertisementId: account.advertisementId,
    amount: Number(currencyAmount),
    coinAmount,
    coinToCurrencyRate: account.coinToCurrencyRate,
    sourceSellerId: account.sourceSellerId,
    balanceBefore: stats.balance.toFixed(2),
    balanceAfter: balanceAfter.toFixed(2),
    type: "seller_return_credit",
    idempotencyKey: `ad-credit:${params.idempotencyKey}`,
    metadata: { reason: params.reason },
  });
  await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
    fundingAccountId: account.id,
    settlementCohortId: params.settlementCohortId,
    type:
      params.reason === "expired_unused"
        ? "seller_unused_returned"
        : params.reason === "refund_after_expiry"
          ? "seller_refund_after_expiry_returned"
          : "seller_surplus_returned",
    coinAmount,
    currencyEquivalent: currencyAmount,
    coinToCurrencyRate: account.coinToCurrencyRate,
    treasureBoxRewardAllocationId: params.rewardAllocationId,
    userCoinLotId: params.userCoinLotId,
    sellerReturnTransactionId: sellerReturn.id,
    idempotencyKey: `funding:${params.idempotencyKey}`,
  });
  return sellerReturn;
}

async function returnRefundConversionCoinsToSellerWithTx(
  tx: DbTransaction,
  params: {
    lot: schema.UserCoinLot;
    coinUnits: number;
    reason: "expired_unused" | "refund_after_expiry";
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  if (
    params.coinUnits <= 0 ||
    !params.lot.sourceRefundId ||
    !params.lot.sourceSellerId
  ) {
    return null;
  }
  const coinAmount = fromCoinUnits(params.coinUnits);
  return tx
    .insert(schema.productSellerCoinReturnTransactionTable)
    .values({
      sourceSellerId: params.lot.sourceSellerId,
      sourceRefundId: params.lot.sourceRefundId,
      userCoinLotId: params.lot.id,
      reason: params.reason,
      coinAmount,
      coinToCurrencyRate: "10.000000",
      currencyEquivalent: (params.coinUnits / 1000).toFixed(2),
      destinationReferenceId: params.lot.sourceSellerId,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata,
    })
    .onConflictDoNothing()
    .returning();
}

export async function expireUnclaimedTreasureBoxes(limit = 200) {
  if (!isCoinLedgerEnabled()) return [];
  const due = await db
    .select({ id: schema.treasureBoxTable.id })
    .from(schema.treasureBoxTable)
    .where(
      and(
        eq(schema.treasureBoxTable.accountingStatus, "claimable"),
        lte(schema.treasureBoxTable.claimDeadlineAt, new Date()),
      ),
    )
    .limit(limit);
  const results = await mapWithConcurrency(
    due,
    getMaintenanceConcurrency(),
    async (candidate) => {
      const didExpire = await db.transaction(async (tx) => {
        const [box] = await tx
          .select()
          .from(schema.treasureBoxTable)
          .where(eq(schema.treasureBoxTable.id, candidate.id))
          .for("update");
        if (!box || box.accountingStatus !== "claimable" || box.isOpened) {
          return false;
        }
        if (!box.claimDeadlineAt || box.claimDeadlineAt > new Date()) {
          return false;
        }
        await tx
          .update(schema.treasureBoxRewardAllocationTable)
          .set({ status: "unacquired", settledAt: new Date() })
          .where(
            and(
              eq(
                schema.treasureBoxRewardAllocationTable.treasureBoxId,
                box.id,
              ),
              eq(schema.treasureBoxRewardAllocationTable.status, "demand"),
            ),
          );
        await tx
          .update(schema.treasureBoxTable)
          .set({
            accountingStatus: "unacquired",
            isActive: false,
            settledAt: new Date(),
          })
          .where(eq(schema.treasureBoxTable.id, box.id));
        return true;
      });
      return didExpire ? candidate.id : null;
    },
  );
  return results.filter((id): id is string => id !== null);
}

export async function expireCollectingRewardCycles(limit = 200) {
  if (!isCoinLedgerEnabled()) return [];
  const candidates = await db
    .select({ id: schema.treasureBoxRewardCycleTable.id })
    .from(schema.treasureBoxRewardCycleTable)
    .where(
      and(
        eq(schema.treasureBoxRewardCycleTable.status, "collecting"),
        lte(schema.treasureBoxRewardCycleTable.claimDeadlineAt, new Date()),
      ),
    )
    .orderBy(asc(schema.treasureBoxRewardCycleTable.claimDeadlineAt))
    .limit(limit);
  if (candidates.length === 0) return [];

  return db
    .update(schema.treasureBoxRewardCycleTable)
    .set({ status: "expired" })
    .where(
      and(
        inArray(
          schema.treasureBoxRewardCycleTable.id,
          candidates.map((candidate) => candidate.id),
        ),
        eq(schema.treasureBoxRewardCycleTable.status, "collecting"),
      ),
    )
    .returning({ id: schema.treasureBoxRewardCycleTable.id });
}

export async function expireUserCoinLots(limit = 200) {
  if (!isCoinLedgerEnabled()) return [];
  const due = await db
    .select({ id: schema.userCoinLotTable.id })
    .from(schema.userCoinLotTable)
    .where(
      and(
        eq(schema.userCoinLotTable.status, "active"),
        lte(schema.userCoinLotTable.expiresAt, new Date()),
        sql`${schema.userCoinLotTable.availableAmount} > 0`,
      ),
    )
    .orderBy(asc(schema.userCoinLotTable.expiresAt))
    .limit(limit);
  const results = await mapWithConcurrency(
    due,
    getMaintenanceConcurrency(),
    async (candidate) => {
      const didExpire = await db.transaction(async (tx) => {
        const [lot] = await tx
          .select()
          .from(schema.userCoinLotTable)
          .where(eq(schema.userCoinLotTable.id, candidate.id))
          .for("update");
        if (
          !lot ||
          lot.status !== "active" ||
          lot.expiresAt > new Date() ||
          toCoinUnits(lot.availableAmount) <= 0
        ) {
          return false;
        }
        const availableUnits = toCoinUnits(lot.availableAmount);
        await tx
          .update(schema.userCoinLotTable)
          .set({
            availableAmount: "0.00",
            expiredAmount: sql`${schema.userCoinLotTable.expiredAmount} + ${lot.availableAmount}`,
            status: "expired",
          })
          .where(eq(schema.userCoinLotTable.id, lot.id));
        await tx
          .update(schema.userTable)
          .set({
            coins: sql`greatest(${schema.userTable.coins} - ${lot.availableAmount}, 0)`,
          })
          .where(eq(schema.userTable.id, lot.userId));
        await tx.insert(schema.userCoinTransactionTable).values({
          userId: lot.userId,
          lotId: lot.id,
          type: "expiry",
          direction: "debit",
          amount: lot.availableAmount,
          idempotencyKey: `lot-expiry:${lot.id}`,
        });
        await tx
          .update(schema.userMonthlyCoinStatTable)
          .set({ expired: true })
          .where(
            and(
              eq(schema.userMonthlyCoinStatTable.userId, lot.userId),
              eq(schema.userMonthlyCoinStatTable.month, lot.earningLocalMonth),
            ),
          );

        const sellerUnits = await getSellerFundedUnitsForOperation(
          tx,
          lot,
          availableUnits,
        );
        if (lot.fundingAccountId && sellerUnits > 0) {
          await returnCoinsToSellerWithTx(tx, {
            fundingAccountId: lot.fundingAccountId,
            reason: "expired_unused",
            coinUnits: sellerUnits,
            idempotencyKey: `lot-expired-return:${lot.id}`,
            rewardAllocationId: lot.rewardAllocationId,
            userCoinLotId: lot.id,
          });
        }
        const platformUnits = availableUnits - sellerUnits;
        if (lot.fundingAccountId && platformUnits > 0) {
          await reversePlatformFundingWithTx(tx, {
            fundingAccountId: lot.fundingAccountId,
            coinUnits: platformUnits,
            userCoinLotId: lot.id,
            idempotencyKey: `platform-expiry:${lot.id}`,
          });
        }
        await returnRefundConversionCoinsToSellerWithTx(tx, {
          lot,
          coinUnits: availableUnits,
          reason: "expired_unused",
          idempotencyKey: `refund-conversion-expiry:${lot.id}`,
        });
        return true;
      });
      return didExpire ? candidate.id : null;
    },
  );
  return results.filter((id): id is string => id !== null);
}

export async function settleAdvertisementCoinCohorts(limit = 200) {
  if (!isCoinLedgerEnabled()) return [];
  const due = await db
    .select({ id: schema.advertisementCoinSettlementCohortTable.id })
    .from(schema.advertisementCoinSettlementCohortTable)
    .where(
      and(
        eq(schema.advertisementCoinSettlementCohortTable.status, "open"),
        lte(
          schema.advertisementCoinSettlementCohortTable.claimSettlementAt,
          new Date(),
        ),
      ),
    )
    .orderBy(asc(schema.advertisementCoinSettlementCohortTable.claimSettlementAt))
    .limit(limit);
  const results = await mapWithConcurrency(
    due,
    getMaintenanceConcurrency(),
    async (candidate) => {
      const didSettle = await db.transaction(async (tx) => {
        const [cohort] = await tx
          .select()
          .from(schema.advertisementCoinSettlementCohortTable)
          .where(
            eq(
              schema.advertisementCoinSettlementCohortTable.id,
              candidate.id,
            ),
          )
          .for("update");
        if (!cohort || cohort.status !== "open") return false;
        const [account] = await tx
          .select()
          .from(schema.advertisementCoinFundingAccountTable)
          .where(
            eq(
              schema.advertisementCoinFundingAccountTable.id,
              cohort.fundingAccountId,
            ),
          )
          .for("update");
        if (!account) throw new Error("Coin funding account not found.");

        const fundedUnits = toCoinUnits(cohort.sellerFundedAmount);
        const repaidUnits = toCoinUnits(cohort.advanceRepaidAmount);
        const alreadyReturnedUnits = toCoinUnits(
          cohort.sellerSurplusReturnedAmount,
        );
        const [{ sellerAcquired }] = await tx
          .select({
            sellerAcquired: sql<string>`coalesce(sum(${schema.treasureBoxRewardAllocationTable.sellerFundedCoinAmount}), 0)`,
          })
          .from(schema.treasureBoxRewardAllocationTable)
          .where(
            eq(
              schema.treasureBoxRewardAllocationTable.settlementCohortId,
              cohort.id,
            ),
          );
        const surplusUnits = Math.max(
          0,
          fundedUnits -
            repaidUnits -
            toCoinUnits(sellerAcquired) -
            alreadyReturnedUnits,
        );
        const returnUnits = Math.min(
          surplusUnits,
          toCoinUnits(account.sellerFundingAvailableAmount),
        );
        if (returnUnits > 0) {
          const returned = await returnCoinsToSellerWithTx(tx, {
            fundingAccountId: account.id,
            settlementCohortId: cohort.id,
            reason: "unacquired_surplus",
            coinUnits: returnUnits,
            idempotencyKey: `cohort-surplus:${cohort.id}`,
          });
          if (returned) {
            await tx
              .update(schema.advertisementCoinFundingAccountTable)
              .set({
                sellerFundingAvailableAmount: sql`${schema.advertisementCoinFundingAccountTable.sellerFundingAvailableAmount} - ${fromCoinUnits(returnUnits)}`,
              })
              .where(
                eq(
                  schema.advertisementCoinFundingAccountTable.id,
                  account.id,
                ),
              );
          }
        }
        await tx
          .update(schema.advertisementCoinSettlementCohortTable)
          .set({
            status: "settled",
            sellerSurplusReturnedAmount: fromCoinUnits(
              alreadyReturnedUnits + returnUnits,
            ),
            closingPlatformAdvanceAmount:
              account.platformAdvanceOutstandingAmount,
            settledAt: new Date(),
          })
          .where(
            eq(schema.advertisementCoinSettlementCohortTable.id, cohort.id),
          );
        return true;
      });
      return didSettle ? candidate.id : null;
    },
  );
  return results.filter((id): id is string => id !== null);
}

export async function expireIssuedAdvertisementAssignments(
  now = new Date(),
) {
  if (!isCoinLedgerEnabled()) return [];
  const nowIso = now.toISOString();
  const candidates = await db
    .select({ id: schema.advertisementAssignmentTable.id })
    .from(schema.advertisementAssignmentTable)
    .where(
      and(
        eq(schema.advertisementAssignmentTable.status, "issued"),
        sql`${schema.advertisementAssignmentTable.userLocalDate} < (${nowIso}::timestamptz at time zone ${schema.advertisementAssignmentTable.timezoneSnapshot})::date`,
      ),
    )
    .limit(ASSIGNMENT_CLEANUP_BATCH_SIZE);
  if (candidates.length === 0) return [];

  return db
    .update(schema.advertisementAssignmentTable)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        inArray(
          schema.advertisementAssignmentTable.id,
          candidates.map((candidate) => candidate.id),
        ),
        eq(schema.advertisementAssignmentTable.status, "issued"),
      ),
    )
    .returning({ id: schema.advertisementAssignmentTable.id });
}

export async function purgeTerminalAdvertisementAssignments(
  now = new Date(),
) {
  if (!isCoinLedgerEnabled()) return [];
  const completedRetentionDays = getRetentionDays(
    "ADVERTISEMENT_ASSIGNMENT_COMPLETED_RETENTION_DAYS",
    365,
  );
  const expiredRetentionDays = getRetentionDays(
    "ADVERTISEMENT_ASSIGNMENT_EXPIRED_RETENTION_DAYS",
    7,
  );
  const completedCutoff = new Date(
    now.getTime() - completedRetentionDays * 24 * 60 * 60 * 1_000,
  );
  const expiredCutoff = new Date(
    now.getTime() - expiredRetentionDays * 24 * 60 * 60 * 1_000,
  );
  const candidates = await db
    .select({ id: schema.advertisementAssignmentTable.id })
    .from(schema.advertisementAssignmentTable)
    .where(
      or(
        and(
          eq(schema.advertisementAssignmentTable.status, "completed"),
          lte(
            schema.advertisementAssignmentTable.completedAt,
            completedCutoff,
          ),
        ),
        and(
          inArray(schema.advertisementAssignmentTable.status, [
            "expired",
            "cancelled",
          ]),
          lte(schema.advertisementAssignmentTable.updatedAt, expiredCutoff),
        ),
      ),
    )
    .limit(ASSIGNMENT_CLEANUP_BATCH_SIZE);
  if (candidates.length === 0) return [];
  const candidateIds = candidates.map((candidate) => candidate.id);

  return db.transaction(async (tx) => {
    await tx
      .update(schema.adViewCountTable)
      .set({ assignmentId: null })
      .where(inArray(schema.adViewCountTable.assignmentId, candidateIds));
    return tx
      .delete(schema.advertisementAssignmentTable)
      .where(inArray(schema.advertisementAssignmentTable.id, candidateIds))
      .returning({ id: schema.advertisementAssignmentTable.id });
  });
}

export async function deleteCoinLedgerJobRuns(
  retentionInMs: number,
  limit = 5_000,
) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Coin-ledger job-run cleanup limit must be a positive integer.");
  }
  const cutoff = new Date(Date.now() - retentionInMs);
  const candidates = await db
    .select({ id: schema.coinLedgerJobRunTable.id })
    .from(schema.coinLedgerJobRunTable)
    .where(lte(schema.coinLedgerJobRunTable.scheduledFor, cutoff))
    .orderBy(asc(schema.coinLedgerJobRunTable.scheduledFor))
    .limit(limit);
  if (candidates.length === 0) return [];

  return db
    .delete(schema.coinLedgerJobRunTable)
    .where(
      inArray(
        schema.coinLedgerJobRunTable.id,
        candidates.map((candidate) => candidate.id),
      ),
    )
    .returning({ id: schema.coinLedgerJobRunTable.id });
}

export async function runCoinLedgerMaintenance() {
  if (!isCoinLedgerEnabled()) return { skipped: true } as const;
  const lockConnection = await client.reserve();
  let lockAcquired = false;
  try {
    const [lockResult] = await lockConnection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(
        hashtextextended(${MAINTENANCE_ADVISORY_LOCK_KEY}, 0)
      ) as acquired
    `;
    lockAcquired = lockResult.acquired;
    if (!lockAcquired) return { skipped: true } as const;

    const scheduledFor = new Date();
    scheduledFor.setUTCSeconds(0, 0);
    const scopeKey = scheduledFor.toISOString().slice(0, 16);
    const [run] = await db
      .insert(schema.coinLedgerJobRunTable)
      .values({ jobName: "coin-ledger-maintenance", scopeKey, scheduledFor })
      .onConflictDoNothing()
      .returning();
    if (!run) return { skipped: true } as const;
    try {
      const boxes = await expireUnclaimedTreasureBoxes();
      const cycles = await expireCollectingRewardCycles();
      const lots = await expireUserCoinLots();
      const cohorts = await settleAdvertisementCoinCohorts();
      const assignmentsExpired = await expireIssuedAdvertisementAssignments();
      const assignmentsPurged = await purgeTerminalAdvertisementAssignments();
      const result = {
        boxes: boxes.length,
        cycles: cycles.length,
        lots: lots.length,
        cohorts: cohorts.length,
        assignmentsExpired: assignmentsExpired.length,
        assignmentsPurged: assignmentsPurged.length,
      };
      await db
        .update(schema.coinLedgerJobRunTable)
        .set({ status: "completed", completedAt: new Date(), metadata: result })
        .where(eq(schema.coinLedgerJobRunTable.id, run.id));
      return { skipped: false, ...result } as const;
    } catch (error) {
      await db
        .update(schema.coinLedgerJobRunTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(schema.coinLedgerJobRunTable.id, run.id));
      throw error;
    }
  } finally {
    try {
      if (lockAcquired) {
        await lockConnection`
          select pg_advisory_unlock(
            hashtextextended(${MAINTENANCE_ADVISORY_LOCK_KEY}, 0)
          )
        `;
      }
    } finally {
      lockConnection.release();
    }
  }
}

export async function issueRefundCashRemainderCoinsWithTx(
  tx: DbTransaction,
  params: {
    refundId: string;
    userId: string;
    sourceSellerId: string;
    amount: number;
  },
) {
  const coinUnits = toCoinUnits(params.amount);
  if (coinUnits <= 0) {
    return { creditedCoin: 0, lot: null };
  }

  const [user] = await tx
    .select({ timezone: schema.userTable.timezone })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, params.userId))
    .for("update");
  if (!user) throw new Error("Refund user not found.");

  const now = new Date();
  const timezone = effectiveTimezone(user.timezone);
  const earningLocalMonth = getLocalMonth(now, timezone);
  const expiresAt = getEndOfNextLocalMonth(now, timezone);
  const amount = fromCoinUnits(coinUnits);
  const [lot] = await tx
    .insert(schema.userCoinLotTable)
    .values({
      userId: params.userId,
      sourceRefundId: params.refundId,
      sourceSellerId: params.sourceSellerId,
      legacySource: "refund_cash_fraction",
      currentFunderType: "seller",
      originalAmount: amount,
      availableAmount: amount,
      timezoneSnapshot: timezone,
      earningLocalMonth,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning();
  if (!lot) {
    return { creditedCoin: 0, lot: null };
  }

  await tx.insert(schema.userCoinTransactionTable).values({
    userId: params.userId,
    lotId: lot.id,
    refundId: params.refundId,
    type: "cash_refund_conversion",
    direction: "credit",
    amount,
    idempotencyKey: `refund-cash-conversion:${params.refundId}`,
    metadata: {
      sourceSellerId: params.sourceSellerId,
      currencyEquivalent: (coinUnits / 1000).toFixed(2),
    },
  });
  await tx
    .update(schema.userTable)
    .set({ coins: sql`${schema.userTable.coins} + ${amount}` })
    .where(eq(schema.userTable.id, params.userId));
  await tx
    .insert(schema.userMonthlyCoinStatTable)
    .values({
      userId: params.userId,
      month: earningLocalMonth,
      coinsEarned: Number(amount),
    })
    .onConflictDoUpdate({
      target: [
        schema.userMonthlyCoinStatTable.userId,
        schema.userMonthlyCoinStatTable.month,
      ],
      set: {
        coinsEarned: sql`${schema.userMonthlyCoinStatTable.coinsEarned} + ${amount}`,
      },
    });
  return { creditedCoin: coinUnits / 100, lot };
}

export async function creditManualUserCoins(params: {
  userId: string;
  amount: number | string;
  reason: string;
  idempotencyKey: string;
  operator?: string;
}) {
  const environment = process.env.NODE_ENV ?? "";
  const allowedEnvironment =
    environment === "local" ||
    environment === "development" ||
    (environment === "test" && process.env.TEST_DATABASE_MANAGED === "true");
  if (!allowedEnvironment) {
    throw new Error(
      "Manual coin credits are only allowed in local, development, and managed test environments.",
    );
  }
  if (!isCoinLedgerEnabled()) {
    throw new Error("COIN_LEDGER_ENABLED must be true for manual coin credits.");
  }

  const numericAmount = Number(params.amount);
  const coinUnits = toCoinUnits(params.amount);
  if (coinUnits <= 0) {
    throw new Error("Manual coin credit amount must be greater than zero.");
  }
  if (!Number.isSafeInteger(coinUnits)) {
    throw new Error("Manual coin credit amount is too large.");
  }
  if (Math.abs(numericAmount - coinUnits / 100) > Number.EPSILON * 10) {
    throw new Error("Manual coin credit amount supports at most 2 decimal places.");
  }

  const reason = params.reason.trim();
  if (!reason) throw new Error("Manual coin credit reason is required.");
  const providedIdempotencyKey = params.idempotencyKey.trim();
  if (!providedIdempotencyKey) {
    throw new Error("Manual coin credit idempotency key is required.");
  }
  const idempotencyKey = `manual-credit:${providedIdempotencyKey}`;
  const amount = fromCoinUnits(coinUnits);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
    );

    const [existingTransaction] = await tx
      .select()
      .from(schema.userCoinTransactionTable)
      .where(
        eq(schema.userCoinTransactionTable.idempotencyKey, idempotencyKey),
      );
    if (existingTransaction) {
      if (
        existingTransaction.type !== "manual" ||
        existingTransaction.direction !== "credit" ||
        existingTransaction.userId !== params.userId ||
        toCoinUnits(existingTransaction.amount) !== coinUnits ||
        !existingTransaction.lotId
      ) {
        throw new Error(
          "Manual coin credit idempotency key was already used with different data.",
        );
      }
      const [existingLot] = await tx
        .select()
        .from(schema.userCoinLotTable)
        .where(eq(schema.userCoinLotTable.id, existingTransaction.lotId));
      const [existingUser] = await tx
        .select({ coins: schema.userTable.coins })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, params.userId));
      if (!existingLot || !existingUser) {
        throw new Error("Existing manual coin credit is incomplete.");
      }
      return {
        creditedCoin: coinUnits / 100,
        balance: existingUser.coins,
        lot: existingLot,
        transaction: existingTransaction,
        alreadyApplied: true,
      };
    }

    const [user] = await tx
      .select({ timezone: schema.userTable.timezone })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, params.userId))
      .for("update");
    if (!user) throw new Error("Manual coin credit user not found.");

    const now = new Date();
    const timezone = effectiveTimezone(user.timezone);
    const earningLocalMonth = getLocalMonth(now, timezone);
    const [lot] = await tx
      .insert(schema.userCoinLotTable)
      .values({
        userId: params.userId,
        legacySource: "manual_adjustment",
        currentFunderType: "platform",
        originalAmount: amount,
        availableAmount: amount,
        timezoneSnapshot: timezone,
        earningLocalMonth,
        expiresAt: getEndOfNextLocalMonth(now, timezone),
      })
      .returning();
    const [manualTransaction] = await tx
      .insert(schema.userCoinTransactionTable)
      .values({
        userId: params.userId,
        lotId: lot.id,
        type: "manual",
        direction: "credit",
        amount,
        idempotencyKey,
        metadata: {
          source: "manual_credit",
          reason,
          operator: params.operator?.trim() || "unspecified",
          environment,
        },
      })
      .returning();
    const [updatedUser] = await tx
      .update(schema.userTable)
      .set({ coins: sql`${schema.userTable.coins} + ${amount}` })
      .where(eq(schema.userTable.id, params.userId))
      .returning({ coins: schema.userTable.coins });
    await tx
      .insert(schema.userMonthlyCoinStatTable)
      .values({
        userId: params.userId,
        month: earningLocalMonth,
        coinsEarned: Number(amount),
      })
      .onConflictDoUpdate({
        target: [
          schema.userMonthlyCoinStatTable.userId,
          schema.userMonthlyCoinStatTable.month,
        ],
        set: {
          coinsEarned: sql`${schema.userMonthlyCoinStatTable.coinsEarned} + ${amount}`,
        },
      });

    return {
      creditedCoin: coinUnits / 100,
      balance: updatedUser.coins,
      lot,
      transaction: manualTransaction,
      alreadyApplied: false,
    };
  });
}

export async function allocateOrderCoinsWithTx(
  tx: DbTransaction,
  params: {
    orderId: string;
    userId: string;
    amount: number;
    mode: "reserve" | "consume";
  },
) {
  const requiredUnits = toCoinUnits(params.amount);
  const coinInfo: Record<string, number> = {};
  if (requiredUnits <= 0) return coinInfo;
  const lots = await tx
    .select()
    .from(schema.userCoinLotTable)
    .where(
      and(
        eq(schema.userCoinLotTable.userId, params.userId),
        eq(schema.userCoinLotTable.status, "active"),
        sql`${schema.userCoinLotTable.availableAmount} > 0`,
        sql`${schema.userCoinLotTable.expiresAt} > now()`,
      ),
    )
    .orderBy(
      asc(schema.userCoinLotTable.expiresAt),
      asc(schema.userCoinLotTable.createdAt),
    )
    .for("update");
  let remainingUnits = requiredUnits;
  for (const lot of lots) {
    if (remainingUnits <= 0) break;
    const usedUnits = Math.min(
      remainingUnits,
      toCoinUnits(lot.availableAmount),
    );
    if (usedUnits <= 0) continue;
    const used = fromCoinUnits(usedUnits);
    coinInfo[lot.earningLocalMonth] =
      (coinInfo[lot.earningLocalMonth] ?? 0) + usedUnits / 100;
    await tx
      .update(schema.userCoinLotTable)
      .set({
        availableAmount: sql`${schema.userCoinLotTable.availableAmount} - ${used}`,
        ...(params.mode === "reserve"
          ? {
              reservedAmount: sql`${schema.userCoinLotTable.reservedAmount} + ${used}`,
            }
          : {
              consumedAmount: sql`${schema.userCoinLotTable.consumedAmount} + ${used}`,
            }),
      })
      .where(eq(schema.userCoinLotTable.id, lot.id));
    await tx.insert(schema.orderCoinAllocationTable).values({
      orderId: params.orderId,
      lotId: lot.id,
      allocatedAmount: used,
      reservedAmount: params.mode === "reserve" ? used : "0.00",
      consumedAmount: params.mode === "consume" ? used : "0.00",
    });
    await tx.insert(schema.userCoinTransactionTable).values({
      userId: params.userId,
      lotId: lot.id,
      orderId: params.orderId,
      type: params.mode === "reserve" ? "reserve" : "spend",
      direction: "debit",
      amount: used,
      idempotencyKey: `order-${params.mode}:${params.orderId}:${lot.id}`,
    });
    await tx
      .update(schema.userMonthlyCoinStatTable)
      .set({
        coinsSpent: sql`${schema.userMonthlyCoinStatTable.coinsSpent} + ${used}`,
      })
      .where(
        and(
          eq(schema.userMonthlyCoinStatTable.userId, params.userId),
          eq(schema.userMonthlyCoinStatTable.month, lot.earningLocalMonth),
        ),
      );
    if (params.mode === "consume" && lot.fundingAccountId) {
      const [account] = await tx
        .select()
        .from(schema.advertisementCoinFundingAccountTable)
        .where(
          eq(
            schema.advertisementCoinFundingAccountTable.id,
            lot.fundingAccountId,
          ),
        );
      if (account) {
        await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
          fundingAccountId: account.id,
          type: "coin_consumed",
          coinAmount: used,
          currencyEquivalent: (usedUnits / 1000).toFixed(2),
          coinToCurrencyRate: account.coinToCurrencyRate,
          userCoinLotId: lot.id,
          idempotencyKey: `coin-consumed:${params.orderId}:${lot.id}`,
        });
      }
    }
    remainingUnits -= usedUnits;
  }
  if (remainingUnits > 0) {
    throw new Error("Insufficient non-expired attributed coin lots.");
  }
  await tx
    .update(schema.userTable)
    .set({ coins: sql`${schema.userTable.coins} - ${fromCoinUnits(requiredUnits)}` })
    .where(eq(schema.userTable.id, params.userId));
  return coinInfo;
}

export async function hasOrderCoinAllocationsWithTx(
  tx: DbTransaction,
  orderId: string,
) {
  const [allocation] = await tx
    .select({ id: schema.orderCoinAllocationTable.id })
    .from(schema.orderCoinAllocationTable)
    .where(eq(schema.orderCoinAllocationTable.orderId, orderId))
    .limit(1);
  return Boolean(allocation);
}

export async function createLegacyRefundCoinLotsWithTx(
  tx: DbTransaction,
  params: {
    userId: string;
    refundId: string;
    coinByMonth: Record<string, number>;
  },
) {
  const [user] = await tx
    .select({ timezone: schema.userTable.timezone })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, params.userId))
    .for("update");
  if (!user) throw new Error("Refund user not found.");

  const timezone = effectiveTimezone(user.timezone);
  const lots: schema.UserCoinLot[] = [];
  for (const [earningLocalMonth, coin] of Object.entries(params.coinByMonth)) {
    const coinUnits = toCoinUnits(coin);
    if (coinUnits <= 0) continue;
    const [yearText, monthText] = earningLocalMonth.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isInteger(year) || month < 1 || month > 12) {
      throw new Error(`Invalid legacy earning month: ${earningLocalMonth}`);
    }
    const earningMonthReference = new Date(
      Date.UTC(year, month - 1, 15, 12, 0, 0),
    );
    const amount = fromCoinUnits(coinUnits);
    const [lot] = await tx
      .insert(schema.userCoinLotTable)
      .values({
        userId: params.userId,
        legacySource: "legacy_unattributed",
        currentFunderType: "platform",
        originalAmount: amount,
        availableAmount: amount,
        timezoneSnapshot: timezone,
        earningLocalMonth,
        expiresAt: getEndOfNextLocalMonth(earningMonthReference, timezone),
      })
      .returning();
    await tx.insert(schema.userCoinTransactionTable).values({
      userId: params.userId,
      lotId: lot.id,
      refundId: params.refundId,
      type: "refund",
      direction: "credit",
      amount,
      idempotencyKey: `legacy-refund:${params.refundId}:${earningLocalMonth}`,
      metadata: { source: "historical_order_coin_info" },
    });
    lots.push(lot);
  }
  return lots;
}

export async function consumeOrderReservationsWithTx(
  tx: DbTransaction,
  orderId: string,
) {
  const coinInfo: Record<string, number> = {};
  const allocations = await tx
    .select({
      allocation: schema.orderCoinAllocationTable,
      lot: schema.userCoinLotTable,
    })
    .from(schema.orderCoinAllocationTable)
    .innerJoin(
      schema.userCoinLotTable,
      eq(schema.orderCoinAllocationTable.lotId, schema.userCoinLotTable.id),
    )
    .where(eq(schema.orderCoinAllocationTable.orderId, orderId))
    .orderBy(asc(schema.orderCoinAllocationTable.createdAt))
    .for("update");
  for (const { allocation, lot } of allocations) {
    const units = toCoinUnits(allocation.reservedAmount);
    if (units <= 0) continue;
    const amount = fromCoinUnits(units);
    coinInfo[lot.earningLocalMonth] =
      (coinInfo[lot.earningLocalMonth] ?? 0) + units / 100;
    await tx
      .update(schema.userCoinLotTable)
      .set({
        reservedAmount: sql`${schema.userCoinLotTable.reservedAmount} - ${amount}`,
        consumedAmount: sql`${schema.userCoinLotTable.consumedAmount} + ${amount}`,
      })
      .where(eq(schema.userCoinLotTable.id, lot.id));
    await tx
      .update(schema.orderCoinAllocationTable)
      .set({ reservedAmount: "0.00", consumedAmount: amount })
      .where(eq(schema.orderCoinAllocationTable.id, allocation.id));
    if (lot.fundingAccountId) {
      const [account] = await tx
        .select()
        .from(schema.advertisementCoinFundingAccountTable)
        .where(
          eq(
            schema.advertisementCoinFundingAccountTable.id,
            lot.fundingAccountId,
          ),
        );
      if (account) {
        await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
          fundingAccountId: account.id,
          type: "coin_consumed",
          coinAmount: amount,
          currencyEquivalent: (units / 1000).toFixed(2),
          coinToCurrencyRate: account.coinToCurrencyRate,
          userCoinLotId: lot.id,
          idempotencyKey: `coin-consumed:${orderId}:${lot.id}`,
        });
      }
    }
  }
  return coinInfo;
}

export async function releaseOrderReservationsWithTx(
  tx: DbTransaction,
  params: { orderId: string; userId: string },
) {
  const allocations = await tx
    .select({
      allocation: schema.orderCoinAllocationTable,
      lot: schema.userCoinLotTable,
    })
    .from(schema.orderCoinAllocationTable)
    .innerJoin(
      schema.userCoinLotTable,
      eq(schema.orderCoinAllocationTable.lotId, schema.userCoinLotTable.id),
    )
    .where(eq(schema.orderCoinAllocationTable.orderId, params.orderId))
    .orderBy(asc(schema.orderCoinAllocationTable.createdAt))
    .for("update");
  let releasedUnits = 0;
  for (const { allocation, lot } of allocations) {
    const units = toCoinUnits(allocation.reservedAmount);
    if (units <= 0) continue;
    const amount = fromCoinUnits(units);
    const expired = lot.expiresAt <= new Date();
    await tx
      .update(schema.userCoinLotTable)
      .set({
        reservedAmount: sql`${schema.userCoinLotTable.reservedAmount} - ${amount}`,
        ...(expired
          ? {
              expiredAmount: sql`${schema.userCoinLotTable.expiredAmount} + ${amount}`,
              status: "expired" as const,
            }
          : {
              availableAmount: sql`${schema.userCoinLotTable.availableAmount} + ${amount}`,
            }),
      })
      .where(eq(schema.userCoinLotTable.id, lot.id));
    await tx
      .update(schema.orderCoinAllocationTable)
      .set({ reservedAmount: "0.00" })
      .where(eq(schema.orderCoinAllocationTable.id, allocation.id));
    await tx.insert(schema.userCoinTransactionTable).values({
      userId: params.userId,
      lotId: lot.id,
      orderId: params.orderId,
      type: "reversal",
      direction: "credit",
      amount,
      idempotencyKey: `order-release:${params.orderId}:${lot.id}`,
      metadata: { creditedToUser: !expired },
    });
    await tx
      .update(schema.userMonthlyCoinStatTable)
      .set({
        coinsSpent: sql`greatest(${schema.userMonthlyCoinStatTable.coinsSpent} - ${amount}, 0)`,
      })
      .where(
        and(
          eq(schema.userMonthlyCoinStatTable.userId, params.userId),
          eq(schema.userMonthlyCoinStatTable.month, lot.earningLocalMonth),
        ),
      );
    const sellerUnits = expired
      ? await getSellerFundedUnitsForOperation(tx, lot, units)
      : 0;
    if (expired && lot.fundingAccountId && sellerUnits > 0) {
      await returnCoinsToSellerWithTx(tx, {
        fundingAccountId: lot.fundingAccountId,
        reason: "expired_unused",
        coinUnits: sellerUnits,
        idempotencyKey: `expired-reservation-return:${params.orderId}:${lot.id}`,
        rewardAllocationId: lot.rewardAllocationId,
        userCoinLotId: lot.id,
      });
    }
    const platformUnits = expired ? units - sellerUnits : 0;
    if (platformUnits > 0 && lot.fundingAccountId) {
      await reversePlatformFundingWithTx(tx, {
        fundingAccountId: lot.fundingAccountId,
        coinUnits: platformUnits,
        userCoinLotId: lot.id,
        idempotencyKey: `platform-reservation-expiry:${params.orderId}:${lot.id}`,
      });
    }
    if (expired && lot.sourceRefundId) {
      await returnRefundConversionCoinsToSellerWithTx(tx, {
        lot,
        coinUnits: units,
        reason: "expired_unused",
        idempotencyKey: `refund-conversion-reservation-expiry:${params.orderId}:${lot.id}`,
      });
    }
    if (!expired) releasedUnits += units;
  }
  if (releasedUnits > 0) {
    await tx
      .update(schema.userTable)
      .set({ coins: sql`${schema.userTable.coins} + ${fromCoinUnits(releasedUnits)}` })
      .where(eq(schema.userTable.id, params.userId));
  }
}

export async function refundOrderCoinsWithTx(
  tx: DbTransaction,
  params: {
    orderId: string;
    userId: string;
    refundId: string;
    amount: number;
  },
) {
  let remainingUnits = toCoinUnits(params.amount);
  const allocations = await tx
    .select({
      allocation: schema.orderCoinAllocationTable,
      lot: schema.userCoinLotTable,
    })
    .from(schema.orderCoinAllocationTable)
    .innerJoin(
      schema.userCoinLotTable,
      eq(schema.orderCoinAllocationTable.lotId, schema.userCoinLotTable.id),
    )
    .where(eq(schema.orderCoinAllocationTable.orderId, params.orderId))
    .orderBy(asc(schema.orderCoinAllocationTable.createdAt))
    .for("update");
  const coinByMonth: Record<
    string,
    { coin: number; expired: boolean; returnedCoin: number }
  > = {};
  let totalUnits = 0;
  let returnableUnits = 0;
  for (const { allocation, lot } of allocations) {
    if (remainingUnits <= 0) break;
    const refundableUnits = Math.max(
      0,
      toCoinUnits(allocation.consumedAmount) -
        toCoinUnits(allocation.reversedAmount),
    );
    const reversedUnits = Math.min(remainingUnits, refundableUnits);
    if (reversedUnits <= 0) continue;
    const amount = fromCoinUnits(reversedUnits);
    const expired = lot.expiresAt <= new Date();

    await tx
      .update(schema.orderCoinAllocationTable)
      .set({
        reversedAmount: sql`${schema.orderCoinAllocationTable.reversedAmount} + ${amount}`,
      })
      .where(eq(schema.orderCoinAllocationTable.id, allocation.id));
    await tx
      .update(schema.userCoinLotTable)
      .set({
        consumedAmount: sql`${schema.userCoinLotTable.consumedAmount} - ${amount}`,
        ...(expired
          ? {
              returnedAmount: sql`${schema.userCoinLotTable.returnedAmount} + ${amount}`,
            }
          : {
              availableAmount: sql`${schema.userCoinLotTable.availableAmount} + ${amount}`,
              status: "active" as const,
            }),
      })
      .where(eq(schema.userCoinLotTable.id, lot.id));
    await tx.insert(schema.userCoinTransactionTable).values({
      userId: params.userId,
      lotId: lot.id,
      orderId: params.orderId,
      refundId: params.refundId,
      type: "refund",
      direction: "credit",
      amount,
      idempotencyKey: `refund:${params.refundId}:${allocation.id}`,
      metadata: { creditedToUser: !expired },
    });
    await tx
      .update(schema.userMonthlyCoinStatTable)
      .set({
        coinsSpent: sql`greatest(${schema.userMonthlyCoinStatTable.coinsSpent} - ${amount}, 0)`,
      })
      .where(
        and(
          eq(schema.userMonthlyCoinStatTable.userId, params.userId),
          eq(schema.userMonthlyCoinStatTable.month, lot.earningLocalMonth),
        ),
      );

    if (lot.fundingAccountId) {
      const [account] = await tx
        .select()
        .from(schema.advertisementCoinFundingAccountTable)
        .where(
          eq(
            schema.advertisementCoinFundingAccountTable.id,
            lot.fundingAccountId,
          ),
        )
        .for("update");
      if (account) {
        await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
          fundingAccountId: account.id,
          type: "coin_consumption_reversed",
          coinAmount: amount,
          currencyEquivalent: (reversedUnits / 1000).toFixed(2),
          coinToCurrencyRate: account.coinToCurrencyRate,
          userCoinLotId: lot.id,
          idempotencyKey: `coin-consumption-reversed:${params.refundId}:${allocation.id}`,
        });
        const sellerUnits = expired
          ? await getSellerFundedUnitsForOperation(tx, lot, reversedUnits)
          : 0;
        if (expired && sellerUnits > 0) {
          await returnCoinsToSellerWithTx(tx, {
            fundingAccountId: account.id,
            reason: "refund_after_expiry",
            coinUnits: sellerUnits,
            idempotencyKey: `refund-expired-return:${params.refundId}:${allocation.id}`,
            rewardAllocationId: lot.rewardAllocationId,
            userCoinLotId: lot.id,
          });
        }
        const platformUnits = expired ? reversedUnits - sellerUnits : 0;
        if (platformUnits > 0) {
          await reversePlatformFundingWithTx(tx, {
            fundingAccountId: account.id,
            coinUnits: platformUnits,
            userCoinLotId: lot.id,
            idempotencyKey: `platform-refund-expiry:${params.refundId}:${allocation.id}`,
          });
        }
      }
    }
    if (expired && lot.sourceRefundId) {
      await returnRefundConversionCoinsToSellerWithTx(tx, {
        lot,
        coinUnits: reversedUnits,
        reason: "refund_after_expiry",
        idempotencyKey: `refund-conversion-after-expiry:${params.refundId}:${allocation.id}`,
        metadata: { reversingRefundId: params.refundId },
      });
    }

    const previous = coinByMonth[lot.earningLocalMonth] ?? {
      coin: 0,
      expired,
      returnedCoin: 0,
    };
    previous.coin += reversedUnits / 100;
    if (!expired) previous.returnedCoin += reversedUnits / 100;
    previous.expired = previous.expired && expired;
    coinByMonth[lot.earningLocalMonth] = previous;
    totalUnits += reversedUnits;
    if (!expired) returnableUnits += reversedUnits;
    remainingUnits -= reversedUnits;
  }
  if (returnableUnits > 0) {
    await tx
      .update(schema.userTable)
      .set({ coins: sql`${schema.userTable.coins} + ${fromCoinUnits(returnableUnits)}` })
      .where(eq(schema.userTable.id, params.userId));
  }
  return {
    totalCoin: totalUnits / 100,
    returnableCoin: returnableUnits / 100,
    coinByMonth,
  };
}

export { returnCoinsToSellerWithTx };
