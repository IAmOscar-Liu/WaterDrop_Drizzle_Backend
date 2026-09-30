import "../lib/env";

import assert from "node:assert/strict";
import { asc, eq, inArray } from "drizzle-orm";

import * as schema from "../db/schema";
import db, { client } from "../lib/initDB";
import { moneyToMinorUnits } from "../lib/money";
import { depositAdBalance } from "../repository/advertisement";
import { creditSellerWallet } from "../repository/accountWallet";

function signedMinorUnits(amount: string) {
  return amount.startsWith("-")
    ? -moneyToMinorUnits(amount.slice(1))
    : moneyToMinorUnits(amount);
}

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const [admin, concurrentSeller] = await db
    .insert(schema.accountTable)
    .values([
      {
        email: `wallet-admin-${suffix}@example.test`,
        password: "not-used",
        realName: "Wallet Test Admin",
        phone: "0900100000",
        role: "admin" as const,
      },
      {
        email: `wallet-concurrent-${suffix}@example.test`,
        password: "not-used",
        realName: "Concurrent Wallet Seller",
        phone: "0900100002",
        role: "seller" as const,
      },
    ])
    .returning();

  await db.insert(schema.accountWalletTable).values([
    { accountId: admin.id },
    { accountId: concurrentSeller.id },
  ]);

  await creditSellerWallet({
    accountId: concurrentSeller.id,
    actorAccountId: admin.id,
    amount: "100.00",
    idempotencyKey: `wallet-concurrency-credit-${suffix}`,
  });

  const products = await db
    .insert(schema.productTable)
    .values([0, 1, 2, 3].map((index) => ({
      sellerId: concurrentSeller.id,
      name: `Wallet Product ${suffix} ${index}`,
      description: "Account-wallet integration fixture",
    })))
    .returning();
  const advertisements = await db
    .insert(schema.advertisementTable)
    .values(products.map((product, index) => ({
      productId: product.id,
      title: `Wallet Ad ${suffix} ${index}`,
      video_url: "https://example.test/wallet-ad.mp4",
      ...(index === 3 ? { archivedAt: new Date() } : {}),
    })))
    .returning();
  await db.insert(schema.advertisementStatsTable).values(
    advertisements.map((advertisement, index) => ({
      advertisementId: advertisement.id,
      status: index === 2 ? "depleted" as const : "paused" as const,
    })),
  );

  const concurrentResults = await Promise.allSettled([
    depositAdBalance({
      advertisementId: advertisements[0].id,
      requesterId: concurrentSeller.id,
      amount: "75.00",
      idempotencyKey: `wallet-concurrent-a-${suffix}`,
    }),
    depositAdBalance({
      advertisementId: advertisements[1].id,
      requesterId: concurrentSeller.id,
      amount: "75.00",
      idempotencyKey: `wallet-concurrent-b-${suffix}`,
    }),
  ]);
  assert.equal(
    concurrentResults.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrentResults.filter((result) => result.status === "rejected").length,
    1,
  );

  const walletAfterConcurrentFunding =
    await db.query.accountWalletTable.findFirst({
      where: eq(
        schema.accountWalletTable.accountId,
        concurrentSeller.id,
      ),
    });
  assert.equal(walletAfterConcurrentFunding?.walletBalance, "25.00");
  const fundedStats = await db
    .select()
    .from(schema.advertisementStatsTable)
    .where(
      inArray(
        schema.advertisementStatsTable.advertisementId,
        advertisements.slice(0, 2).map(({ id }) => id),
      ),
    );
  assert.equal(
    fundedStats.reduce((sum, stats) => sum + stats.balance, 0),
    75,
  );
  assert.ok(fundedStats.every((stats) => stats.status === "paused"));

  await creditSellerWallet({
    accountId: concurrentSeller.id,
    actorAccountId: admin.id,
    amount: "100.00",
    idempotencyKey: `wallet-reactivation-credit-${suffix}`,
  });
  const reactivated = await depositAdBalance({
    advertisementId: advertisements[2].id,
    requesterId: admin.id,
    amount: "100.00",
    idempotencyKey: `wallet-reactivation-funding-${suffix}`,
  });
  assert.equal(reactivated.status, "active");
  assert.equal(reactivated.wallet.walletBalance, "25.00");

  const forcedRollbackKey = `wallet-forced-rollback-${suffix}`;
  const walletBeforeForcedRollback =
    await db.query.accountWalletTable.findFirst({
      where: eq(
        schema.accountWalletTable.accountId,
        concurrentSeller.id,
      ),
    });
  const statsBeforeForcedRollback =
    await db.query.advertisementStatsTable.findFirst({
      where: eq(
        schema.advertisementStatsTable.advertisementId,
        advertisements[0].id,
      ),
    });
  const cyclicMetadata: Record<string, unknown> = {};
  cyclicMetadata.self = cyclicMetadata;
  await assert.rejects(
    depositAdBalance({
      advertisementId: advertisements[0].id,
      requesterId: admin.id,
      amount: "1.00",
      idempotencyKey: forcedRollbackKey,
      metadata: cyclicMetadata,
    }),
  );
  const walletAfterForcedRollback =
    await db.query.accountWalletTable.findFirst({
      where: eq(
        schema.accountWalletTable.accountId,
        concurrentSeller.id,
      ),
    });
  const statsAfterForcedRollback =
    await db.query.advertisementStatsTable.findFirst({
      where: eq(
        schema.advertisementStatsTable.advertisementId,
        advertisements[0].id,
      ),
    });
  assert.equal(
    walletAfterForcedRollback?.walletBalance,
    walletBeforeForcedRollback?.walletBalance,
  );
  assert.equal(
    statsAfterForcedRollback?.balance,
    statsBeforeForcedRollback?.balance,
  );

  await assert.rejects(
    depositAdBalance({
      advertisementId: advertisements[3].id,
      requesterId: admin.id,
      amount: "1.00",
      idempotencyKey: `wallet-archived-funding-${suffix}`,
    }),
    /Archived or financially closed/,
  );
  await db
    .update(schema.accountTable)
    .set({ status: "inactive" })
    .where(eq(schema.accountTable.id, concurrentSeller.id));
  await assert.rejects(
    depositAdBalance({
      advertisementId: advertisements[0].id,
      requesterId: admin.id,
      amount: "1.00",
      idempotencyKey: `wallet-inactive-seller-${suffix}`,
    }),
    /active seller account/,
  );

  const fundingPairs = await db
    .select({
      walletTransactionId: schema.accountWalletTransactionTable.id,
      advertisementTransactionId: schema.advertisementTransactionTable.id,
      debitAmount: schema.accountWalletTransactionTable.amount,
      creditAmount: schema.advertisementTransactionTable.amount,
      debitAdvertisementId: schema.accountWalletTransactionTable.advertisementId,
      creditAdvertisementId: schema.advertisementTransactionTable.advertisementId,
      creditType: schema.advertisementTransactionTable.type,
    })
    .from(schema.accountWalletTransactionTable)
    .leftJoin(
      schema.advertisementTransactionTable,
      eq(
        schema.advertisementTransactionTable.accountWalletTransactionId,
        schema.accountWalletTransactionTable.id,
      ),
    )
    .where(
      eq(
        schema.accountWalletTransactionTable.type,
        "advertisement_funding_debit",
      ),
    );
  assert.ok(
    fundingPairs.every((pair) => pair.advertisementTransactionId !== null),
  );

  for (const pair of fundingPairs) {
    assert.equal(pair.creditType, "wallet_funding");
    assert.equal(pair.creditAdvertisementId, pair.debitAdvertisementId);
    assert.notEqual(pair.creditAmount, null);
    assert.equal(
      moneyToMinorUnits(pair.creditAmount!),
      -signedMinorUnits(pair.debitAmount),
    );
  }

  const transactions = await db
    .select()
    .from(schema.accountWalletTransactionTable)
    .where(eq(schema.accountWalletTransactionTable.accountId, concurrentSeller.id))
    .orderBy(asc(schema.accountWalletTransactionTable.sequence));
  let balance = BigInt(0);
  for (const transaction of transactions) {
    assert.equal(moneyToMinorUnits(transaction.balanceBefore), balance);
    balance += signedMinorUnits(transaction.amount);
    assert.equal(moneyToMinorUnits(transaction.balanceAfter), balance);
  }
  const finalWallet = await db.query.accountWalletTable.findFirst({
    where: eq(schema.accountWalletTable.accountId, concurrentSeller.id),
  });
  assert.ok(finalWallet);
  assert.equal(moneyToMinorUnits(finalWallet.walletBalance), balance);
  assert.equal(finalWallet.walletBalance, "25.00");
  console.log("account-wallet integration test passed");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
