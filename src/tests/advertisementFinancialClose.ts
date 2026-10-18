import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { getLocalDate } from "../lib/coinAccounting";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { runCoinLedgerMaintenanceJob } from "../lib/coinLedgerMaintenanceJob";
import { createAdvertisement, financiallyCloseAdvertisement, listAdvertisements, setAdStatus } from "../repository/advertisement";
import { closeEligibleArchivedAdvertisements, returnCoinsToSellerWithTx } from "../repository/coinLedger";
import { openTreasureBox, processVideoCompletion } from "../repository/treasureBox";

// Called by the cron suite, exclusively inside its disposable database.
export async function verifyAutomaticFinancialClose() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const suffix = randomUUID();
  const [seller] = await db.insert(s.accountTable).values({
    profileCompletedAt: new Date(), emailVerifiedAt: new Date(),
    email: `close-${suffix}@example.test`, password: "unused", realName: "Close test", phone: "0900000000",
  }).returning();
  async function makeAd() {
    const [product] = await db.insert(s.productTable).values({
      sellerId: seller.id, name: "Close fixture", description: "Test",
    }).returning();
    await db.insert(s.productVariantTable).values({
      productId: product.id, name: "Default", sku: randomUUID(), price: 20, stock: 100, optionValues: {},
    });
    const ad = await createAdvertisement({ productId: product.id, title: "Close fixture", video_url: "https://example.test/a.mp4" });
    await db.update(s.advertisementStatsTable).set({ balance: 200, status: "active" })
      .where(eq(s.advertisementStatsTable.advertisementId, ad.id));
    return ad;
  }
  const a = await makeAd();
  const b = await makeAd();
  const [user] = await db.insert(s.userTable).values({
    email: `close-user-${suffix}@example.test`, oauthProvider: "other", oauthId: suffix, referralCode: suffix, timezone: "Asia/Taipei",
  }).returning();
  await db.insert(s.userDailyStatTable).values({ userId: user.id, groupAdViewsCountYesterday: 20 });
  await listAdvertisements({ userId: user.id, limit: 100 });
  await setAdStatus(a.id, "archived", seller.id);
  async function blocked(code: string) {
    await assert.rejects(financiallyCloseAdvertisement(a.id, seller.id),
      (error: unknown) => error instanceof CustomError && error.statusCode === 409 && error.code === code);
    const [ad] = await db.select().from(s.advertisementTable).where(eq(s.advertisementTable.id, a.id));
    assert.equal(ad.financiallyClosedAt, null);
  }
  await blocked("AD_FINANCIAL_CLOSE_ASSIGNMENTS_PENDING");
  await processVideoCompletion(user.id, a.id);
  await blocked("AD_FINANCIAL_CLOSE_CYCLES_PENDING");
  // A different ad finishes the cycle and creates a claim against archived A.
  await Promise.all([
    processVideoCompletion(user.id, b.id),
    assert.rejects(financiallyCloseAdvertisement(a.id, seller.id),
      (error: unknown) => error instanceof CustomError &&
        ["AD_FINANCIAL_CLOSE_CYCLES_PENDING", "AD_FINANCIAL_CLOSE_CLAIMS_PENDING"].includes(error.code ?? "")),
  ]);
  await blocked("AD_FINANCIAL_CLOSE_CLAIMS_PENDING");
  const [box] = await db.select().from(s.treasureBoxTable).where(eq(s.treasureBoxTable.userId, user.id));
  await openTreasureBox(user.id, box.id);
  const beforeLots = await db.select().from(s.userCoinLotTable).where(eq(s.userCoinLotTable.userId, user.id));
  assert.ok(beforeLots.length > 0);

  // Manual/cron racers serialize; acquired coins stay intact, without waiting for expiry.
  const [manual] = await Promise.all([
    financiallyCloseAdvertisement(a.id, seller.id), closeEligibleArchivedAdvertisements(),
  ]);
  assert.ok(manual.financiallyClosedAt! < manual.archiveGraceEndsAt!);
  const retry = await financiallyCloseAdvertisement(a.id, seller.id);
  assert.equal(retry.financiallyClosedAt!.toISOString(), manual.financiallyClosedAt!.toISOString());
  const afterLots = await db.select().from(s.userCoinLotTable).where(eq(s.userCoinLotTable.userId, user.id));
  assert.deepEqual(afterLots, beforeLots);
  const [closedAccount] = await db.select().from(s.advertisementCoinFundingAccountTable)
    .where(eq(s.advertisementCoinFundingAccountTable.advertisementId, a.id));
  assert.equal(closedAccount.status, "closed");
  assert.equal(Number(closedAccount.sellerFundingAvailableAmount), 0);
  assert.equal(Number(closedAccount.platformAdvanceOutstandingAmount), 0);

  // Exercise the scheduled entry point: immediate close, surplus credit once,
  // partial failure isolation, and expired assignment/cycle/claim cleanup.
  const ready = await makeAd();
  const broken = await makeAd();
  const expiring = await makeAd();
  for (const ad of [ready, broken, expiring]) await setAdStatus(ad.id, "archived", seller.id);
  await db.update(s.advertisementTable).set({ archivedAt: null }).where(eq(s.advertisementTable.id, broken.id));
  await db.update(s.advertisementCoinFundingAccountTable)
    .set({ sellerFundingAvailableAmount: "100.00", platformAdvanceOutstandingAmount: "20.00" })
    .where(eq(s.advertisementCoinFundingAccountTable.advertisementId, ready.id));
  const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await db.insert(s.advertisementAssignmentTable).values({
    userId: user.id, advertisementId: expiring.id, sourceSellerId: seller.id,
    assignmentBatchId: randomUUID(), userLocalDate: getLocalDate(past, "Asia/Taipei"),
    timezoneSnapshot: "Asia/Taipei", assignedAt: past,
  });
  const [cycle] = await db.insert(s.treasureBoxRewardCycleTable).values({
    userId: user.id, accountingBusinessDate: getLocalDate(past, "Asia/Taipei"),
    userLocalDate: getLocalDate(past, "Asia/Taipei"), timezoneSnapshot: "Asia/Taipei",
    completedViewCount: 1, claimDeadlineAt: past,
  }).returning();
  await db.insert(s.adViewCountTable).values({ userId: user.id, advertisementId: expiring.id, rewardCycleId: cycle.id });
  const [expiredBox] = await db.insert(s.treasureBoxTable).values({
    userId: user.id, coinsAwarded: 10, accountingStatus: "claimable", claimDeadlineAt: past,
  }).returning();
  const [expiringAccount] = await db.select().from(s.advertisementCoinFundingAccountTable)
    .where(eq(s.advertisementCoinFundingAccountTable.advertisementId, expiring.id));
  await db.insert(s.treasureBoxRewardAllocationTable).values({
    treasureBoxId: expiredBox.id, fundingAccountId: expiringAccount.id, advertisementId: expiring.id,
    sourceSellerId: seller.id, attributedCoinAmount: "10.00",
  });
  // Remove only this suite's minute deduplication entry to simulate the next tick.
  await db.delete(s.coinLedgerJobRunTable).where(eq(s.coinLedgerJobRunTable.jobName, "coin-ledger-maintenance"));
  const tick = await runCoinLedgerMaintenanceJob();
  assert.equal(tick.skipped, false);
  if (tick.skipped) throw new Error("Expected maintenance tick");
  assert.equal(tick.financialClose.failed, 1);
  assert.equal(tick.financialClose.closed, 2);
  assert.equal(tick.financialClose.failures[0].advertisementId, broken.id);
  const [run] = await db.select().from(s.coinLedgerJobRunTable)
    .where(eq(s.coinLedgerJobRunTable.jobName, "coin-ledger-maintenance"));
  assert.deepEqual((run.metadata as { financialClose: unknown }).financialClose, tick.financialClose);
  const [readyStats] = await db.select().from(s.advertisementStatsTable)
    .where(eq(s.advertisementStatsTable.advertisementId, ready.id));
  assert.equal(readyStats.balance, 210); // 100 coins / 10; stays in the ad, no wallet transfer.
  const first = await financiallyCloseAdvertisement(ready.id, seller.id);
  const again = await financiallyCloseAdvertisement(ready.id, seller.id);
  assert.equal(first.financiallyClosedAt!.toISOString(), again.financiallyClosedAt!.toISOString());
  const returns = await db.select().from(s.sellerCoinReturnTransactionTable)
    .where(eq(s.sellerCoinReturnTransactionTable.advertisementId, ready.id));
  assert.equal(returns.length, 1);
  const writeoffs = await db.select().from(s.advertisementCoinFundingTransactionTable)
    .where(eq(s.advertisementCoinFundingTransactionTable.idempotencyKey, `archive-writeoff:${ready.id}`));
  assert.equal(writeoffs.length, 1);
  assert.equal(Number(writeoffs[0].coinAmount), 20);
  await assert.rejects(financiallyCloseAdvertisement(ready.id, randomUUID()),
    (error: unknown) => error instanceof CustomError && error.statusCode === 403);
  await db.update(s.advertisementTable).set({ archivedAt: new Date() }).where(eq(s.advertisementTable.id, broken.id));
  assert.equal((await closeEligibleArchivedAdvertisements()).closed, 1);

  // Force a return to hold the funding account before close takes the ad lock.
  // Its foreign-key insert must still proceed, rather than deadlocking with close.
  const racing = await makeAd();
  await setAdStatus(racing.id, "archived", seller.id);
  await db.update(s.advertisementCoinFundingAccountTable)
    .set({ sellerFundingAvailableAmount: "100.00" })
    .where(eq(s.advertisementCoinFundingAccountTable.advertisementId, racing.id));
  let closeRace: Promise<unknown> | undefined;
  await db.transaction(async (tx) => {
    const [account] = await tx.select().from(s.advertisementCoinFundingAccountTable)
      .where(eq(s.advertisementCoinFundingAccountTable.advertisementId, racing.id)).for("update");
    closeRace = financiallyCloseAdvertisement(racing.id, seller.id).then(
      (closed) => ({ closed }), (error: unknown) => ({ error }));
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await tx.execute(sql`select exists (
        select 1 from pg_stat_activity a
        where a.datname = current_database() and pg_backend_pid() = any(pg_blocking_pids(a.pid))
      ) as waiting`);
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "close should wait for the funding account lock");
    await returnCoinsToSellerWithTx(tx, {
      fundingAccountId: account.id, reason: "unacquired_surplus", coinUnits: 5000,
      idempotencyKey: `close-return-race:${racing.id}`,
    });
    await tx.update(s.advertisementCoinFundingAccountTable)
      .set({ sellerFundingAvailableAmount: "50.00" }).where(eq(s.advertisementCoinFundingAccountTable.id, account.id));
  });
  const raced = await closeRace as { error?: unknown; closed?: s.Advertisement };
  if (raced.error) throw raced.error;
  assert.ok(raced.closed?.financiallyClosedAt);
  const [raceStats] = await db.select().from(s.advertisementStatsTable)
    .where(eq(s.advertisementStatsTable.advertisementId, racing.id));
  assert.equal(raceStats.balance, 210);

  // A whole page of blocked ads must not starve an eligible ad on a later page.
  const [product] = await db.insert(s.productTable).values({ sellerId: seller.id, name: "Paging", description: "Test" }).returning();
  const archivedAt = new Date();
  const ads = await db.insert(s.advertisementTable).values(Array.from({ length: 102 }, (_, index) => ({
    id: `ffffffff-ffff-4fff-8fff-${index.toString(16).padStart(12, "0")}`,
    productId: product.id, title: "Blocked page", video_url: "https://example.test/a.mp4",
    archivedAt, archiveGraceEndsAt: new Date(Date.now() + 86400000),
  }))).returning();
  await db.insert(s.advertisementStatsTable).values(ads.map((ad) => ({ advertisementId: ad.id, status: "archived" as const })));
  await db.insert(s.advertisementAssignmentTable).values(ads.slice(0, 101).map((ad) => ({
    userId: user.id, advertisementId: ad.id, sourceSellerId: seller.id, assignmentBatchId: randomUUID(),
    assignedAt: new Date(archivedAt.getTime() - 1000), userLocalDate: getLocalDate(new Date(), "Asia/Taipei"), timezoneSnapshot: "Asia/Taipei",
  })));
  const scan = await closeEligibleArchivedAdvertisements();
  assert.equal(scan.blocked, 101);
  assert.equal(scan.closed, 1);
  assert.equal(scan.failed, 0);
  const [remaining] = await db.select({ count: sql<number>`count(*)::int` }).from(s.advertisementTable)
    .where(and(eq(s.advertisementTable.productId, product.id), sql`${s.advertisementTable.financiallyClosedAt} is null`));
  assert.equal(remaining.count, 101);
  console.log("automatic advertisement financial-close checks passed");
}
