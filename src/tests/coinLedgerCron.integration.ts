import "../lib/env";

import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { getLocalDate } from "../lib/coinAccounting";
import { runCoinLedgerMaintenanceJob } from "../lib/coinLedgerMaintenanceJob";
import { client } from "../lib/initDB";
import db from "../lib/initDB";
import {
  createAdvertisement,
  listAdvertisements,
} from "../repository/advertisement";
import {
  openTreasureBox,
  processVideoCompletion,
} from "../repository/treasureBox";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.NO_CRON, "true");
  assert.equal(process.env.COIN_LEDGER_ENABLED, "true");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const [seller] = await db
      .insert(schema.accountTable)
      .values({
        email: `cron-seller-${suffix}@example.test`,
        password: "not-used",
        realName: "Cron Test Seller",
        phone: "0900000001",
      })
      .returning();
    const products = await db
      .insert(schema.productTable)
      .values([0, 1].map((index) => ({
        sellerId: seller.id,
        name: `Cron Product ${suffix} ${index}`,
        description: "Disposable cron fixture",
      })))
      .returning();
    await db.insert(schema.productVariantTable).values(
      products.map((product, index) => ({
        productId: product.id,
        name: "Default",
        sku: `cron-${suffix}-${index}`,
        price: 20,
        stock: 100,
        optionValues: {},
      })),
    );

    const advertisements: schema.Advertisement[] = [];
    for (const [index, product] of products.entries()) {
      const advertisement = await createAdvertisement({
        productId: product.id,
        title: `Cron Ad ${suffix} ${index}`,
        video_url: "https://example.test/cron-ad.mp4",
      });
      advertisements.push(advertisement);
      await db
        .update(schema.advertisementStatsTable)
        .set({ balance: 200, status: "active" })
        .where(
          eq(
            schema.advertisementStatsTable.advertisementId,
            advertisement.id,
          ),
        );
    }
    const fundingAccounts = await db
      .select({ id: schema.advertisementCoinFundingAccountTable.id })
      .from(schema.advertisementCoinFundingAccountTable)
      .where(
        inArray(
          schema.advertisementCoinFundingAccountTable.advertisementId,
          advertisements.map((advertisement) => advertisement.id),
        ),
      );
    const fundingAccountIds = fundingAccounts.map((account) => account.id);

    const users = await db
      .insert(schema.userTable)
      .values(["unclaimed", "unused"].map((label) => ({
        email: `cron-${label}-${suffix}@example.test`,
        oauthProvider: "other" as const,
        oauthId: `cron-${label}-${suffix}`,
        referralCode: `cron-${label}-${suffix}`,
        timezone: "Asia/Taipei",
      })))
      .returning();
    await db.insert(schema.userDailyStatTable).values(
      users.map((user) => ({
        userId: user.id,
        groupAdViewsCountYesterday: 20,
      })),
    );

    for (const user of users) {
      await listAdvertisements({ userId: user.id, limit: 100 });
      await processVideoCompletion(user.id, advertisements[0].id);
      await processVideoCompletion(user.id, advertisements[1].id);
    }

    const [assignmentCleanupUser] = await db
      .insert(schema.userTable)
      .values({
        email: `cron-assignment-cleanup-${suffix}@example.test`,
        oauthProvider: "other",
        oauthId: `cron-assignment-cleanup-${suffix}`,
        referralCode: `cron-assignment-cleanup-${suffix}`,
        timezone: "Asia/Taipei",
      })
      .returning();
    await listAdvertisements({ userId: assignmentCleanupUser.id, limit: 100 });
    const staleLocalDate = getLocalDate(
      new Date(Date.now() - 24 * 60 * 60 * 1_000),
      "Asia/Taipei",
    );
    const staleIssuedAssignments = await db
      .update(schema.advertisementAssignmentTable)
      .set({ userLocalDate: staleLocalDate })
      .where(
        eq(
          schema.advertisementAssignmentTable.userId,
          assignmentCleanupUser.id,
        ),
      )
      .returning({ id: schema.advertisementAssignmentTable.id });
    assert.ok(staleIssuedAssignments.length >= advertisements.length);

    const [oldCompletedAssignment] = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        and(
          eq(schema.advertisementAssignmentTable.userId, users[0].id),
          eq(schema.advertisementAssignmentTable.status, "completed"),
        ),
      )
      .limit(1);
    assert.ok(oldCompletedAssignment);
    const oldAuditTimestamp = new Date(
      Date.now() - 366 * 24 * 60 * 60 * 1_000,
    );
    await db
      .update(schema.advertisementAssignmentTable)
      .set({
        completedAt: oldAuditTimestamp,
        updatedAt: oldAuditTimestamp,
      })
      .where(
        eq(
          schema.advertisementAssignmentTable.id,
          oldCompletedAssignment.id,
        ),
      );
    const [linkedOldAdView] = await db
      .select()
      .from(schema.adViewCountTable)
      .where(
        eq(
          schema.adViewCountTable.assignmentId,
          oldCompletedAssignment.id,
        ),
      );
    assert.ok(linkedOldAdView);

    const [unclaimedBox] = await db
      .select()
      .from(schema.treasureBoxTable)
      .where(eq(schema.treasureBoxTable.userId, users[0].id));
    const [unusedBox] = await db
      .select()
      .from(schema.treasureBoxTable)
      .where(eq(schema.treasureBoxTable.userId, users[1].id));
    await openTreasureBox(users[1].id, unusedBox.id);

    const past = new Date(Date.now() - 1_000);
    await db
      .update(schema.treasureBoxTable)
      .set({ claimDeadlineAt: past })
      .where(eq(schema.treasureBoxTable.id, unclaimedBox.id));
    await db
      .update(schema.userCoinLotTable)
      .set({ expiresAt: past })
      .where(eq(schema.userCoinLotTable.userId, users[1].id));
    await db
      .update(schema.advertisementCoinSettlementCohortTable)
      .set({ claimSettlementAt: past })
      .where(
        inArray(
          schema.advertisementCoinSettlementCohortTable.fundingAccountId,
          fundingAccountIds,
        ),
      );

    const result = await runCoinLedgerMaintenanceJob();
    assert.equal(result.skipped, false);
    if (!result.skipped) {
      assert.equal(result.boxes, 1);
      assert.equal(result.lots, 2);
      assert.equal(result.cohorts, 2);
      assert.ok(result.assignmentsExpired >= staleIssuedAssignments.length);
      assert.equal(result.assignmentsPurged, 1);
    }

    const expiredAssignments = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        inArray(
          schema.advertisementAssignmentTable.id,
          staleIssuedAssignments.map((assignment) => assignment.id),
        ),
      );
    assert.ok(
      expiredAssignments.every((assignment) => assignment.status === "expired"),
    );
    const [purgedOldAssignment] = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        eq(
          schema.advertisementAssignmentTable.id,
          oldCompletedAssignment.id,
        ),
      );
    assert.equal(purgedOldAssignment, undefined);
    const [retainedAdView] = await db
      .select()
      .from(schema.adViewCountTable)
      .where(eq(schema.adViewCountTable.id, linkedOldAdView.id));
    assert.equal(retainedAdView.assignmentId, null);

    const [expiredBox] = await db
      .select()
      .from(schema.treasureBoxTable)
      .where(eq(schema.treasureBoxTable.id, unclaimedBox.id));
    assert.equal(expiredBox.accountingStatus, "unacquired");
    assert.equal(expiredBox.isActive, false);

    const [expiredCoinUser] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, users[1].id));
    assert.equal(expiredCoinUser.coins, 0);
    const expiredLots = await db
      .select()
      .from(schema.userCoinLotTable)
      .where(eq(schema.userCoinLotTable.userId, users[1].id));
    assert.ok(expiredLots.every((lot) => lot.status === "expired"));

    const [{ settledCohorts }] = await db
      .select({ settledCohorts: sql<number>`count(*)` })
      .from(schema.advertisementCoinSettlementCohortTable)
      .where(
        and(
          eq(
            schema.advertisementCoinSettlementCohortTable.status,
            "settled",
          ),
          inArray(
            schema.advertisementCoinSettlementCohortTable.fundingAccountId,
            fundingAccountIds,
          ),
        ),
      );
    assert.equal(Number(settledCohorts), 2);
    const [{ sellerReturns }] = await db
      .select({ sellerReturns: sql<number>`count(*)` })
      .from(schema.sellerCoinReturnTransactionTable);
    assert.ok(Number(sellerReturns) >= 2);
    const [jobRun] = await db
      .select()
      .from(schema.coinLedgerJobRunTable)
      .where(eq(schema.coinLedgerJobRunTable.jobName, "coin-ledger-maintenance"));
    assert.equal(jobRun.status, "completed");

    const retry = await runCoinLedgerMaintenanceJob();
    assert.equal(retry.skipped, true);
    console.log("coin-ledger cron integration test passed");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
