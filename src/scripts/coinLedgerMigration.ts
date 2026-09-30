import "../lib/env";

import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  effectiveTimezone,
  fromCoinUnits,
  getEndOfNextLocalMonth,
  getLocalMonth,
  toCoinUnits,
} from "../lib/coinAccounting";
import db, { client } from "../lib/initDB";
import { expirePaymentProcessingOrders } from "../repository/order";

const BACKFILL_NAME = "legacy_unattributed_user_balances_v1";
const BACKFILL_LOCK = "waterdrop:backfill:legacy-user-balances:v1";
const AD_ACCOUNT_BACKFILL_NAME = "legacy_advertisement_funding_accounts_v1";
const AD_ACCOUNT_BACKFILL_LOCK =
  "waterdrop:backfill:advertisement-funding-accounts:v1";
const PAYMENT_PROCESSING_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000;

type Command = "audit" | "finalize-orders" | "backfill" | "reconcile";

type ReconciliationMismatch = {
  userId: string;
  userCoin: number;
  lotCoin: number;
  difference: number;
};

function parseCommand(): { command: Command; apply: boolean } {
  const command = (process.argv[2] ?? "audit") as Command;
  if (!["audit", "finalize-orders", "backfill", "reconcile"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return { command, apply: process.argv.includes("--apply") };
}

function assertLedgerDisabled() {
  if (process.env.COIN_LEDGER_ENABLED === "true") {
    throw new Error(
      "Disable COIN_LEDGER_ENABLED while finalizing legacy orders and backfilling balances.",
    );
  }
}

async function getStalePaymentProcessingOrders() {
  const cutoff = new Date(Date.now() - PAYMENT_PROCESSING_EXPIRY_MS);
  return db
    .select({
      id: schema.orderTable.id,
      userId: schema.orderTable.userId,
      discountCoin: schema.orderTable.discountCoin,
      coinInfo: schema.orderTable.coinInfo,
      createdAt: schema.orderTable.createdAt,
    })
    .from(schema.orderTable)
    .where(
      and(
        eq(schema.orderTable.orderStatus, "payment-processing"),
        lt(schema.orderTable.createdAt, cutoff),
      ),
    )
    .orderBy(asc(schema.orderTable.createdAt));
}

async function getAuditSummary() {
  const [userSummary] = await db
    .select({
      userCount: sql<number>`count(*)::int`,
      usersWithCoins: sql<number>`count(*) filter (where ${schema.userTable.coins} > 0)::int`,
      totalUserCoins: sql<string>`coalesce(sum(${schema.userTable.coins}), 0)::text`,
    })
    .from(schema.userTable);
  const [lotSummary] = await db
    .select({
      lotCount: sql<number>`count(*)::int`,
      activeLotCoins: sql<string>`coalesce(sum(${schema.userCoinLotTable.availableAmount}) filter (where ${schema.userCoinLotTable.status} = 'active'), 0)::text`,
      reservedLotCoins: sql<string>`coalesce(sum(${schema.userCoinLotTable.reservedAmount}) filter (where ${schema.userCoinLotTable.status} = 'active'), 0)::text`,
    })
    .from(schema.userCoinLotTable);
  const [historicalOrderSummary] = await db
    .select({
      paidCoinOrders: sql<number>`count(*)::int`,
      withoutAllocations: sql<number>`count(*) filter (where not exists (
        select 1 from ${schema.orderCoinAllocationTable}
        where ${schema.orderCoinAllocationTable.orderId} = ${schema.orderTable.id}
      ))::int`,
    })
    .from(schema.orderTable)
    .where(
      and(
        eq(schema.orderTable.orderStatus, "paid"),
        gt(schema.orderTable.discountCoin, 0),
      ),
    );
  const [advertisementSummary] = await db
    .select({
      advertisementCount: sql<number>`count(*)::int`,
      missingFundingAccounts: sql<number>`count(*) filter (where ${schema.advertisementCoinFundingAccountTable.id} is null)::int`,
    })
    .from(schema.advertisementTable)
    .leftJoin(
      schema.advertisementCoinFundingAccountTable,
      eq(
        schema.advertisementCoinFundingAccountTable.advertisementId,
        schema.advertisementTable.id,
      ),
    );
  const [ledgerEventSummary] = await db.execute<{
    assignments: number;
    reward_cycles: number;
    reward_allocations: number;
    funding_transactions: number;
    settlement_cohorts: number;
    order_allocations: number;
    seller_returns: number;
    product_seller_returns: number;
    balance_transfers: number;
    job_runs: number;
  }>(sql`
    select
      (select count(*)::int from ${schema.advertisementAssignmentTable}) as assignments,
      (select count(*)::int from ${schema.treasureBoxRewardCycleTable}) as reward_cycles,
      (select count(*)::int from ${schema.treasureBoxRewardAllocationTable}) as reward_allocations,
      (select count(*)::int from ${schema.advertisementCoinFundingTransactionTable}) as funding_transactions,
      (select count(*)::int from ${schema.advertisementCoinSettlementCohortTable}) as settlement_cohorts,
      (select count(*)::int from ${schema.orderCoinAllocationTable}) as order_allocations,
      (select count(*)::int from ${schema.sellerCoinReturnTransactionTable}) as seller_returns,
      (select count(*)::int from ${schema.productSellerCoinReturnTransactionTable}) as product_seller_returns,
      (select count(*)::int from ${schema.advertisementBalanceTransferTable}) as balance_transfers,
      (select count(*)::int from ${schema.coinLedgerJobRunTable}) as job_runs
  `);
  const staleOrders = await getStalePaymentProcessingOrders();
  const checkpoints = await db
    .select()
    .from(schema.coinLedgerBackfillCheckpointTable)
    .where(
      sql`${schema.coinLedgerBackfillCheckpointTable.name} in (${BACKFILL_NAME}, ${AD_ACCOUNT_BACKFILL_NAME})`,
    )
    .orderBy(asc(schema.coinLedgerBackfillCheckpointTable.name));

  return {
    users: userSummary,
    lots: lotSummary,
    advertisements: advertisementSummary,
    ledgerEvents: ledgerEventSummary,
    stalePaymentProcessingOrders: staleOrders,
    historicalPaidCoinOrders: historicalOrderSummary,
    checkpoints,
  };
}

async function finalizeOrders(apply: boolean) {
  assertLedgerDisabled();
  const staleOrders = await getStalePaymentProcessingOrders();
  console.log(`Stale payment-processing orders: ${staleOrders.length}`);
  for (const order of staleOrders) {
    console.log({
      id: order.id,
      createdAt: order.createdAt.toISOString(),
      discountCoin: order.discountCoin ?? 0,
      coinInfo: order.coinInfo,
    });
  }
  if (!apply || staleOrders.length === 0) return;

  const expired = await expirePaymentProcessingOrders(
    PAYMENT_PROCESSING_EXPIRY_MS,
  );
  console.log(`Expired through normal order logic: ${expired.length}`);
}

async function backfill(apply: boolean) {
  assertLedgerDisabled();
  if (!apply) {
    console.log(
      "Dry run only. Pass --apply to write legacy lots and advertisement funding accounts.",
    );
    console.log(await getAuditSummary());
    return;
  }

  const userBalanceResult = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${BACKFILL_LOCK}))`,
    );
    const [existingCheckpoint] = await tx
      .select()
      .from(schema.coinLedgerBackfillCheckpointTable)
      .where(eq(schema.coinLedgerBackfillCheckpointTable.name, BACKFILL_NAME))
      .for("update");
    if (existingCheckpoint?.status === "completed") {
      return {
        alreadyCompleted: true,
        usersBackfilled: 0,
        lotsCreated: 0,
        coinsBackfilled: "0.00",
      };
    }

    const paymentProcessingOrders = await tx
      .select({ id: schema.orderTable.id })
      .from(schema.orderTable)
      .where(eq(schema.orderTable.orderStatus, "payment-processing"))
      .limit(1);
    if (paymentProcessingOrders.length > 0) {
      throw new Error(
        "Payment-processing orders remain. Finalize them before backfilling.",
      );
    }

    const [existingLot] = await tx
      .select({ id: schema.userCoinLotTable.id })
      .from(schema.userCoinLotTable)
      .limit(1)
      .for("update");
    if (existingLot) {
      throw new Error(
        "Coin lots already exist without a completed legacy backfill checkpoint; refusing to guess which balances remain uncovered.",
      );
    }

    const now = new Date();
    const users = await tx
      .select({
        id: schema.userTable.id,
        coins: schema.userTable.coins,
        timezone: schema.userTable.timezone,
      })
      .from(schema.userTable)
      .orderBy(asc(schema.userTable.id))
      .for("update");

    if (existingCheckpoint) {
      await tx
        .update(schema.coinLedgerBackfillCheckpointTable)
        .set({
          status: "started",
          checkpoint: null,
          completedAt: null,
          metadata: { restartedAt: now.toISOString() },
          updatedAt: now,
        })
        .where(eq(schema.coinLedgerBackfillCheckpointTable.id, existingCheckpoint.id));
    } else {
      await tx.insert(schema.coinLedgerBackfillCheckpointTable).values({
        name: BACKFILL_NAME,
        status: "started",
        metadata: { startedAt: now.toISOString() },
      });
    }

    let usersBackfilled = 0;
    let lotsCreated = 0;
    let totalUnits = 0;
    for (const user of users) {
      const coinUnits = toCoinUnits(user.coins);
      if (Math.abs(user.coins - coinUnits / 100) > 0.000001) {
        throw new Error(
          `User ${user.id} has a balance with more than two decimal places: ${user.coins}`,
        );
      }

      await tx
        .update(schema.userMonthlyCoinStatTable)
        .set({ expired: true, updatedAt: now })
        .where(
          and(
            eq(schema.userMonthlyCoinStatTable.userId, user.id),
            eq(schema.userMonthlyCoinStatTable.expired, false),
          ),
        );

      if (coinUnits <= 0) continue;
      const amount = fromCoinUnits(coinUnits);
      const timezone = effectiveTimezone(user.timezone);
      const earningLocalMonth = getLocalMonth(now, timezone);
      const expiresAt = getEndOfNextLocalMonth(now, timezone);
      const [lot] = await tx
        .insert(schema.userCoinLotTable)
        .values({
          userId: user.id,
          legacySource: "legacy_unattributed",
          currentFunderType: "platform",
          originalAmount: amount,
          availableAmount: amount,
          timezoneSnapshot: timezone,
          earningLocalMonth,
          expiresAt,
        })
        .returning({ id: schema.userCoinLotTable.id });
      await tx.insert(schema.userCoinTransactionTable).values({
        userId: user.id,
        lotId: lot.id,
        type: "acquire",
        direction: "credit",
        amount,
        idempotencyKey: `${BACKFILL_NAME}:${user.id}`,
        metadata: {
          source: "legacy_balance_backfill",
          sellerAttribution: "unavailable",
        },
      });
      await tx
        .insert(schema.userMonthlyCoinStatTable)
        .values({
          userId: user.id,
          month: earningLocalMonth,
          coinsEarned: coinUnits / 100,
          coinsSpent: 0,
          expired: false,
        })
        .onConflictDoUpdate({
          target: [
            schema.userMonthlyCoinStatTable.userId,
            schema.userMonthlyCoinStatTable.month,
          ],
          set: {
            coinsEarned: coinUnits / 100,
            coinsSpent: 0,
            expired: false,
            updatedAt: now,
          },
        });
      usersBackfilled += 1;
      lotsCreated += 1;
      totalUnits += coinUnits;
    }

    await tx
      .update(schema.coinLedgerBackfillCheckpointTable)
      .set({
        status: "completed",
        checkpoint: users.length > 0 ? users[users.length - 1].id : null,
        completedAt: now,
        metadata: {
          policy: "preserve_balance_as_fresh_legacy_unattributed_lot",
          usersBackfilled,
          lotsCreated,
          coinsBackfilled: fromCoinUnits(totalUnits),
          expiresAtPolicy: "end_of_next_month_in_user_timezone",
        },
        updatedAt: now,
      })
      .where(eq(schema.coinLedgerBackfillCheckpointTable.name, BACKFILL_NAME));

    return {
      alreadyCompleted: false,
      usersBackfilled,
      lotsCreated,
      coinsBackfilled: fromCoinUnits(totalUnits),
    };
  });
  const advertisementAccountResult = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${AD_ACCOUNT_BACKFILL_LOCK}))`,
    );
    const [existingCheckpoint] = await tx
      .select()
      .from(schema.coinLedgerBackfillCheckpointTable)
      .where(
        eq(
          schema.coinLedgerBackfillCheckpointTable.name,
          AD_ACCOUNT_BACKFILL_NAME,
        ),
      )
      .for("update");
    if (existingCheckpoint?.status === "completed") {
      return {
        alreadyCompleted: true,
        advertisementsChecked: 0,
        accountsCreated: 0,
      };
    }

    const now = new Date();
    const advertisements = await tx
      .select({
        advertisementId: schema.advertisementTable.id,
        sourceSellerId: schema.productTable.sellerId,
      })
      .from(schema.advertisementTable)
      .innerJoin(
        schema.productTable,
        eq(schema.advertisementTable.productId, schema.productTable.id),
      )
      .orderBy(asc(schema.advertisementTable.id))
      .for("update");

    const sellerMismatches = await tx.execute<{ advertisement_id: string }>(sql`
      select advertisement.id as advertisement_id
      from ${schema.advertisementTable} as advertisement
      inner join ${schema.productTable} as product
        on product.id = advertisement.product_id
      inner join ${schema.advertisementCoinFundingAccountTable} as funding_account
        on funding_account.advertisement_id = advertisement.id
      where funding_account.source_seller_id <> product.seller_id
      limit 1
    `);
    if (sellerMismatches.length > 0) {
      throw new Error(
        `Advertisement ${sellerMismatches[0].advertisement_id} has a funding account owned by the wrong seller.`,
      );
    }

    if (existingCheckpoint) {
      await tx
        .update(schema.coinLedgerBackfillCheckpointTable)
        .set({
          status: "started",
          checkpoint: null,
          completedAt: null,
          metadata: { restartedAt: now.toISOString() },
          updatedAt: now,
        })
        .where(
          eq(
            schema.coinLedgerBackfillCheckpointTable.id,
            existingCheckpoint.id,
          ),
        );
    } else {
      await tx.insert(schema.coinLedgerBackfillCheckpointTable).values({
        name: AD_ACCOUNT_BACKFILL_NAME,
        status: "started",
        metadata: { startedAt: now.toISOString() },
      });
    }

    let accountsCreated = 0;
    for (const advertisement of advertisements) {
      const inserted = await tx
        .insert(schema.advertisementCoinFundingAccountTable)
        .values({
          advertisementId: advertisement.advertisementId,
          sourceSellerId: advertisement.sourceSellerId,
        })
        .onConflictDoNothing({
          target:
            schema.advertisementCoinFundingAccountTable.advertisementId,
        })
        .returning({ id: schema.advertisementCoinFundingAccountTable.id });
      accountsCreated += inserted.length;
    }

    await tx
      .update(schema.coinLedgerBackfillCheckpointTable)
      .set({
        status: "completed",
        checkpoint:
          advertisements.length > 0
            ? advertisements[advertisements.length - 1].advertisementId
            : null,
        completedAt: now,
        metadata: {
          policy: "initialize_existing_advertisements_with_zero_ledger_totals",
          advertisementsChecked: advertisements.length,
          accountsCreated,
        },
        updatedAt: now,
      })
      .where(
        eq(
          schema.coinLedgerBackfillCheckpointTable.name,
          AD_ACCOUNT_BACKFILL_NAME,
        ),
      );

    return {
      alreadyCompleted: false,
      advertisementsChecked: advertisements.length,
      accountsCreated,
    };
  });
  console.log("User-balance backfill result:", userBalanceResult);
  console.log(
    "Advertisement-account backfill result:",
    advertisementAccountResult,
  );
}

async function reconcile() {
  const rows = await db.execute<{
    user_id: string;
    user_coin: string;
    lot_coin: string;
  }>(sql`
    select
      users.id as user_id,
      round(users.coins::numeric, 2)::text as user_coin,
      coalesce(round(sum(
        case
          when ${schema.userCoinLotTable.status} = 'active'
          then ${schema.userCoinLotTable.availableAmount}
          else 0
        end
      ), 2), 0)::text as lot_coin
    from ${schema.userTable} as users
    left join ${schema.userCoinLotTable}
      on ${schema.userCoinLotTable.userId} = users.id
    group by users.id, users.coins
    order by users.id
  `);
  const mismatches: ReconciliationMismatch[] = rows
    .map((row) => {
      const userCoin = Number(row.user_coin);
      const lotCoin = Number(row.lot_coin);
      return {
        userId: row.user_id,
        userCoin,
        lotCoin,
        difference: Math.round((userCoin - lotCoin) * 100) / 100,
      };
    })
    .filter((row) => row.difference !== 0);
  const totalUserCoin = rows.reduce((sum, row) => sum + Number(row.user_coin), 0);
  const totalLotCoin = rows.reduce((sum, row) => sum + Number(row.lot_coin), 0);
  const staleOrders = await getStalePaymentProcessingOrders();
  const advertisementAccountProblems = await db.execute<{
    advertisement_id: string;
    problem: string;
  }>(sql`
    select
      advertisement.id as advertisement_id,
      case
        when funding_account.id is null then 'missing_account'
        else 'seller_mismatch'
      end as problem
    from ${schema.advertisementTable} as advertisement
    inner join ${schema.productTable} as product
      on product.id = advertisement.product_id
    left join ${schema.advertisementCoinFundingAccountTable} as funding_account
      on funding_account.advertisement_id = advertisement.id
    where funding_account.id is null
       or funding_account.source_seller_id <> product.seller_id
    order by advertisement.id
  `);

  console.log({
    usersChecked: rows.length,
    totalUserCoin: fromCoinUnits(toCoinUnits(totalUserCoin)),
    totalActiveLotCoin: fromCoinUnits(toCoinUnits(totalLotCoin)),
    mismatchCount: mismatches.length,
    stalePaymentProcessingOrderCount: staleOrders.length,
    advertisementAccountProblemCount: advertisementAccountProblems.length,
  });
  if (mismatches.length > 0) {
    console.error("Balance mismatches:", mismatches);
    throw new Error("Coin-ledger reconciliation failed.");
  }
  if (staleOrders.length > 0) {
    throw new Error("Stale payment-processing orders remain.");
  }
  if (advertisementAccountProblems.length > 0) {
    console.error(
      "Advertisement funding-account problems:",
      advertisementAccountProblems,
    );
    throw new Error("Advertisement funding-account reconciliation failed.");
  }
  console.log("Coin-ledger reconciliation passed.");
}

async function main() {
  const { command, apply } = parseCommand();
  if (command === "audit") {
    console.dir(await getAuditSummary(), { depth: null });
    return;
  }
  if (command === "finalize-orders") {
    await finalizeOrders(apply);
    return;
  }
  if (command === "backfill") {
    await backfill(apply);
    return;
  }
  await reconcile();
}

main()
  .catch((error) => {
    console.error("Coin-ledger migration command failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
