import { randomUUID } from "crypto";
import { and, asc, eq, gt, inArray, not, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import { getCurrentYYYYMM } from "../lib/general";
import db from "../lib/initDB";
import { spendAdBalanceWithTx } from "./advertisement";
import {
  AD_VIEW_CHARGE,
  AD_VIEW_FUNDED_COINS,
  decimalAmount,
  earlierDate,
  effectiveTimezone,
  fromCoinUnits,
  getEndOfNextLocalMonth,
  getLocalDate,
  getLocalMonth,
  getNextLocalMidnight,
  isCoinLedgerEnabled,
  PLATFORM_TIMEZONE,
  toCoinUnits,
} from "../lib/coinAccounting";
import { reclassifyRepaidPlatformAdvanceWithTx } from "./coinLedger";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Processes a user completing a video watch.
 * It updates their daily stats and awards a treasure box if the conditions are met.
 * @param userId The ID of the user who watched the video.
 */
export async function processVideoCompletion(
  userId: string,
  advertisementId: string,
) {
  if (isCoinLedgerEnabled()) {
    return processVideoCompletionWithLedger(userId, advertisementId);
  }
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .for("update");

    // Step 1: Get or create the user's daily stats for today.
    let [dailyStat] = await tx
      .select()
      .from(schema.userDailyStatTable)
      .where(eq(schema.userDailyStatTable.userId, userId))
      .for("update");

    if (!dailyStat) {
      [dailyStat] = await tx
        .insert(schema.userDailyStatTable)
        .values({ userId })
        .returning();
    }

    // Step 2: Check if the user can watch more videos today.
    if (!dailyStat.canWatchMore) {
      throw new CustomError(
        `User ${userId} cannot watch more videos today.`,
        403,
      );
    }

    // Step 3: Decrement video counters
    let [updatedStat] = await tx
      .update(schema.userDailyStatTable)
      .set({
        totalViews: sql`${schema.userDailyStatTable.totalViews} + 1`,
        remainingViews: sql`${schema.userDailyStatTable.remainingViews} - 1`,
        nextTreasureBoxIn: sql`${schema.userDailyStatTable.nextTreasureBoxIn} - 1`,
        viewedAds: advertisementId
          ? sql`array_append(coalesce(${schema.userDailyStatTable.viewedAds}, '{}'::text[]), ${advertisementId}::text)`
          : dailyStat.viewedAds,
      })
      .where(eq(schema.userDailyStatTable.userId, userId))
      .returning();

    // Step 3.1: Create an ad view record
    if (advertisementId) {
      await tx.insert(schema.adViewCountTable).values({
        userId,
        advertisementId,
      });

      await spendAdBalanceWithTx(tx, { advertisementId, amount: 1.5 });
    }

    if (!updatedStat) {
      throw new CustomError(`User stats for user id "${userId}" not found.`, 404);
    }

    // Step 4: Check if a treasure box should be awarded
    let isAwarded = false;
    if (
      updatedStat.nextTreasureBoxIn <= 0 &&
      updatedStat.treasureBoxesEarned < 10
    ) {
      // Generate random coins for the treasure box
      // const coinsAwarded = getRandomInteger(5, 10);
      const coinsAwarded = Math.min(
        165,
        (updatedStat.groupAdViewsCountYesterday ?? 0) * 0.75,
      );

      // Insert new treasure box
      await tx.insert(schema.treasureBoxTable).values({
        userId,
        coinsAwarded: coinsAwarded,
      });

      // Reset the counter for the next treasure box and increment earned boxes
      [updatedStat] = await tx
        .update(schema.userDailyStatTable)
        .set({
          nextTreasureBoxIn: 2,
          treasureBoxesEarned: sql`${schema.userDailyStatTable.treasureBoxesEarned} + 1`,
        })
        .where(eq(schema.userDailyStatTable.userId, userId))
        .returning();
      isAwarded = true;
    }

    // Step 5: If user has no remaining views, update their status
    if (updatedStat.remainingViews <= 0) {
      [updatedStat] = await tx
        .update(schema.userDailyStatTable)
        .set({ canWatchMore: false })
        .where(eq(schema.userDailyStatTable.userId, userId))
        .returning();
    }
    return updatedStat ? { ...updatedStat, isAwarded } : undefined;
  });
}

async function processVideoCompletionWithLedger(
  userId: string,
  advertisementId: string,
) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const [user] = await tx
      .select({ id: schema.userTable.id, timezone: schema.userTable.timezone })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .for("update");
    if (!user) throw new CustomError("User not found.", 404);

    const [assignment] = await tx
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        and(
          eq(schema.advertisementAssignmentTable.userId, userId),
          eq(schema.advertisementAssignmentTable.advertisementId, advertisementId),
          eq(schema.advertisementAssignmentTable.status, "issued"),
          sql`${schema.advertisementAssignmentTable.userLocalDate} = (${nowIso}::timestamptz at time zone ${schema.advertisementAssignmentTable.timezoneSnapshot})::date`,
        ),
      )
      .orderBy(asc(schema.advertisementAssignmentTable.assignedAt))
      .limit(1)
      .for("update");
    if (!assignment) {
      throw new CustomError(
        "No valid issued assignment exists for this advertisement.",
        409,
      );
    }

    const [advertisement] = await tx
      .select({
        archivedAt: schema.advertisementTable.archivedAt,
        archiveGraceEndsAt: schema.advertisementTable.archiveGraceEndsAt,
      })
      .from(schema.advertisementTable)
      .where(eq(schema.advertisementTable.id, advertisementId))
      .for("update");
    if (!advertisement) throw new CustomError("Advertisement not found.", 404);
    if (
      advertisement.archivedAt &&
      (assignment.assignedAt >= advertisement.archivedAt ||
        !advertisement.archiveGraceEndsAt ||
        now >= advertisement.archiveGraceEndsAt)
    ) {
      throw new CustomError("The archived advertisement grace period has ended.", 409);
    }

    let [dailyStat] = await tx
      .select()
      .from(schema.userDailyStatTable)
      .where(eq(schema.userDailyStatTable.userId, userId))
      .for("update");
    if (!dailyStat) {
      [dailyStat] = await tx
        .insert(schema.userDailyStatTable)
        .values({ userId })
        .returning();
    }
    if (!dailyStat.canWatchMore || dailyStat.remainingViews <= 0) {
      throw new CustomError(`User ${userId} cannot watch more videos today.`, 403);
    }

    const timezone = effectiveTimezone(
      assignment.timezoneSnapshot || user.timezone,
    );
    const userLocalDate = getLocalDate(now, timezone);
    if (assignment.userLocalDate !== userLocalDate) {
      throw new CustomError("The advertisement assignment is no longer valid today.", 409);
    }
    const localDeadline = getNextLocalMidnight(now, timezone);
    const claimDeadline = earlierDate(
      localDeadline,
      advertisement.archiveGraceEndsAt,
    );
    const businessDate = getLocalDate(now, PLATFORM_TIMEZONE);
    const claimDeadlineIso = claimDeadline.toISOString();

    let [fundingAccount] = await tx
      .insert(schema.advertisementCoinFundingAccountTable)
      .values({
        advertisementId,
        sourceSellerId: assignment.sourceSellerId,
      })
      .onConflictDoNothing()
      .returning();
    if (!fundingAccount) {
      [fundingAccount] = await tx
        .select()
        .from(schema.advertisementCoinFundingAccountTable)
        .where(
          eq(
            schema.advertisementCoinFundingAccountTable.advertisementId,
            advertisementId,
          ),
        )
        .for("update");
    }
    if (!fundingAccount) throw new CustomError("Funding account not found.", 500);

    let [cohort] = await tx
      .insert(schema.advertisementCoinSettlementCohortTable)
      .values({
        fundingAccountId: fundingAccount.id,
        businessDate,
        claimSettlementAt: claimDeadline,
        openingPlatformAdvanceAmount:
          fundingAccount.platformAdvanceOutstandingAmount,
      })
      .onConflictDoNothing()
      .returning();
    if (!cohort) {
      [cohort] = await tx
        .select()
        .from(schema.advertisementCoinSettlementCohortTable)
        .where(
          and(
            eq(
              schema.advertisementCoinSettlementCohortTable.fundingAccountId,
              fundingAccount.id,
            ),
            eq(
              schema.advertisementCoinSettlementCohortTable.businessDate,
              businessDate,
            ),
          ),
        )
        .for("update");
    }
    if (!cohort) throw new CustomError("Settlement cohort not found.", 500);

    let [cycle] = await tx
      .select()
      .from(schema.treasureBoxRewardCycleTable)
      .where(
        and(
          eq(schema.treasureBoxRewardCycleTable.userId, userId),
          eq(schema.treasureBoxRewardCycleTable.status, "collecting"),
          eq(schema.treasureBoxRewardCycleTable.userLocalDate, userLocalDate),
        ),
      )
      .orderBy(asc(schema.treasureBoxRewardCycleTable.createdAt))
      .limit(1)
      .for("update");
    if (!cycle) {
      [cycle] = await tx
        .insert(schema.treasureBoxRewardCycleTable)
        .values({
          userId,
          accountingBusinessDate: businessDate,
          userLocalDate,
          timezoneSnapshot: timezone,
          claimDeadlineAt: claimDeadline,
        })
        .returning();
    }

    const completionIdempotencyKey = `assignment:${assignment.id}`;
    const [adView] = await tx
      .insert(schema.adViewCountTable)
      .values({
        userId,
        advertisementId,
        assignmentId: assignment.id,
        rewardCycleId: cycle.id,
        fundingAccountId: fundingAccount.id,
        settlementCohortId: cohort.id,
        viewChargeAmount: AD_VIEW_CHARGE.toFixed(2),
        fundedCoinAmount: AD_VIEW_FUNDED_COINS.toFixed(2),
        coinToCurrencyRate: "10.000000",
        completionIdempotencyKey,
      })
      .returning();

    const spent = await spendAdBalanceWithTx(tx, {
      advertisementId,
      amount: AD_VIEW_CHARGE,
      allowInactive: true,
      sourceSellerId: assignment.sourceSellerId,
      adViewCountId: adView.id,
      coinAmount: AD_VIEW_FUNDED_COINS,
      idempotencyKey: `view-debit:${adView.id}`,
    });
    await tx
      .update(schema.adViewCountTable)
      .set({ advertisementTransactionId: spent.advertisementTransactionId })
      .where(eq(schema.adViewCountTable.id, adView.id));

    const fundedUnits = toCoinUnits(AD_VIEW_FUNDED_COINS);
    const outstandingUnits = toCoinUnits(
      fundingAccount.platformAdvanceOutstandingAmount,
    );
    const repaidUnits = Math.min(fundedUnits, outstandingUnits);
    const availableUnits = fundedUnits - repaidUnits;
    await tx
      .update(schema.advertisementCoinFundingAccountTable)
      .set({
        sellerFundingAvailableAmount: sql`${schema.advertisementCoinFundingAccountTable.sellerFundingAvailableAmount} + ${fromCoinUnits(availableUnits)}`,
        platformAdvanceOutstandingAmount: sql`${schema.advertisementCoinFundingAccountTable.platformAdvanceOutstandingAmount} - ${fromCoinUnits(repaidUnits)}`,
      })
      .where(eq(schema.advertisementCoinFundingAccountTable.id, fundingAccount.id));
    await tx
      .update(schema.advertisementCoinSettlementCohortTable)
      .set({
        sellerFundedAmount: sql`${schema.advertisementCoinSettlementCohortTable.sellerFundedAmount} + ${AD_VIEW_FUNDED_COINS.toFixed(2)}`,
        advanceRepaidAmount: sql`${schema.advertisementCoinSettlementCohortTable.advanceRepaidAmount} + ${fromCoinUnits(repaidUnits)}`,
        claimSettlementAt: sql`greatest(coalesce(${schema.advertisementCoinSettlementCohortTable.claimSettlementAt}, ${claimDeadlineIso}::timestamptz), ${claimDeadlineIso}::timestamptz)`,
      })
      .where(eq(schema.advertisementCoinSettlementCohortTable.id, cohort.id));
    await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
      fundingAccountId: fundingAccount.id,
      settlementCohortId: cohort.id,
      type: "view_funded",
      coinAmount: AD_VIEW_FUNDED_COINS.toFixed(2),
      currencyEquivalent: AD_VIEW_CHARGE.toFixed(2),
      coinToCurrencyRate: "10.000000",
      adViewCountId: adView.id,
      idempotencyKey: `view-funded:${adView.id}`,
    });
    if (repaidUnits > 0) {
      await tx.insert(schema.advertisementCoinFundingTransactionTable).values({
        fundingAccountId: fundingAccount.id,
        settlementCohortId: cohort.id,
        type: "platform_advance_repaid",
        coinAmount: fromCoinUnits(repaidUnits),
        currencyEquivalent: (repaidUnits / 1000).toFixed(2),
        coinToCurrencyRate: "10.000000",
        adViewCountId: adView.id,
        idempotencyKey: `advance-repaid:${adView.id}`,
      });
      await reclassifyRepaidPlatformAdvanceWithTx(tx, {
        fundingAccountId: fundingAccount.id,
        settlementCohortId: cohort.id,
        adViewCountId: adView.id,
        repaidUnits,
        coinToCurrencyRate: "10.000000",
      });
    }

    [cycle] = await tx
      .update(schema.treasureBoxRewardCycleTable)
      .set({
        completedViewCount: sql`${schema.treasureBoxRewardCycleTable.completedViewCount} + 1`,
        claimDeadlineAt: sql`least(coalesce(${schema.treasureBoxRewardCycleTable.claimDeadlineAt}, ${claimDeadlineIso}::timestamptz), ${claimDeadlineIso}::timestamptz)`,
      })
      .where(eq(schema.treasureBoxRewardCycleTable.id, cycle.id))
      .returning();

    let [updatedStat] = await tx
      .update(schema.userDailyStatTable)
      .set({
        totalViews: sql`${schema.userDailyStatTable.totalViews} + 1`,
        remainingViews: sql`${schema.userDailyStatTable.remainingViews} - 1`,
        nextTreasureBoxIn: sql`${schema.userDailyStatTable.nextTreasureBoxIn} - 1`,
        viewedAds: sql`array_append(coalesce(${schema.userDailyStatTable.viewedAds}, '{}'::text[]), ${advertisementId}::text)`,
      })
      .where(eq(schema.userDailyStatTable.userId, userId))
      .returning();

    let isAwarded = false;
    if (
      cycle.completedViewCount === cycle.requiredViewCount &&
      updatedStat.treasureBoxesEarned < 10
    ) {
      const coinsAwarded = Math.min(
        165,
        (updatedStat.groupAdViewsCountYesterday ?? 0) * 0.75,
      );
      const boxClaimDeadline = cycle.claimDeadlineAt ?? claimDeadline;
      const [box] = await tx
        .insert(schema.treasureBoxTable)
        .values({
          userId,
          coinsAwarded,
          rewardCycleId: cycle.id,
          accountingStatus: coinsAwarded > 0 ? "claimable" : "zero_reward",
          timezoneSnapshot: timezone,
          userLocalDate,
          localClaimDeadlineAt: localDeadline,
          archiveGraceDeadlineAt:
            boxClaimDeadline < localDeadline ? boxClaimDeadline : null,
          claimDeadlineAt: boxClaimDeadline,
          rewardRuleVersion: "group-views-v1",
          rewardInputSnapshot: {
            groupAdViewsCountYesterday: updatedStat.groupAdViewsCountYesterday ?? 0,
            completedViewCount: cycle.completedViewCount,
          },
        })
        .returning();

      const cycleViews = await tx
        .select({
          advertisementId: schema.adViewCountTable.advertisementId,
          fundingAccountId: schema.adViewCountTable.fundingAccountId,
          settlementCohortId: schema.adViewCountTable.settlementCohortId,
          sourceSellerId: schema.advertisementAssignmentTable.sourceSellerId,
        })
        .from(schema.adViewCountTable)
        .innerJoin(
          schema.advertisementAssignmentTable,
          eq(
            schema.adViewCountTable.assignmentId,
            schema.advertisementAssignmentTable.id,
          ),
        )
        .where(eq(schema.adViewCountTable.rewardCycleId, cycle.id))
        .orderBy(asc(schema.adViewCountTable.createdAt));
      const grouped = new Map<string, typeof cycleViews>();
      for (const view of cycleViews) {
        const entries = grouped.get(view.advertisementId) ?? [];
        entries.push(view);
        grouped.set(view.advertisementId, entries);
      }
      const groups = [...grouped.entries()];
      const rewardUnits = toCoinUnits(coinsAwarded);
      for (let index = 0; index < groups.length; index += 1) {
        const [sourceAdvertisementId, views] = groups[index];
        const attributedUnits =
          groups.length === 1
            ? rewardUnits
            : index === 0
              ? Math.floor(rewardUnits / 2)
              : rewardUnits - Math.floor(rewardUnits / 2);
        if (attributedUnits <= 0) continue;
        const view = views[0];
        await tx.insert(schema.treasureBoxRewardAllocationTable).values({
          treasureBoxId: box.id,
          fundingAccountId: view.fundingAccountId,
          settlementCohortId: view.settlementCohortId,
          advertisementId: sourceAdvertisementId,
          sourceSellerId: view.sourceSellerId,
          attributedCoinAmount: fromCoinUnits(attributedUnits),
        });
      }
      await tx
        .update(schema.treasureBoxRewardCycleTable)
        .set({ status: "completed", completedAt: now, treasureBoxId: box.id })
        .where(eq(schema.treasureBoxRewardCycleTable.id, cycle.id));
      [updatedStat] = await tx
        .update(schema.userDailyStatTable)
        .set({
          nextTreasureBoxIn: 2,
          treasureBoxesEarned: sql`${schema.userDailyStatTable.treasureBoxesEarned} + 1`,
        })
        .where(eq(schema.userDailyStatTable.userId, userId))
        .returning();
      isAwarded = true;
    }

    if (updatedStat.remainingViews <= 0) {
      [updatedStat] = await tx
        .update(schema.userDailyStatTable)
        .set({ canWatchMore: false })
        .where(eq(schema.userDailyStatTable.userId, userId))
        .returning();
    }
    await tx
      .update(schema.advertisementAssignmentTable)
      .set({
        status: "completed",
        completedAt: now,
        completionIdempotencyKey,
      })
      .where(eq(schema.advertisementAssignmentTable.id, assignment.id));
    return { ...updatedStat, isAwarded };
  });
}

/**
 * Opens a treasure box for a user, adds the awarded coins to their balance,
 * and marks the box as opened.
 * @param userId The ID of the user opening the box.
 * @param treasureBoxId The ID of the treasure box to open.
 */
export async function openTreasureBox(userId: string, treasureBoxId: string) {
  if (isCoinLedgerEnabled()) {
    return openTreasureBoxWithLedger(userId, treasureBoxId);
  }
  return db.transaction(async (tx) => {
    // Step 1: Find the treasure box and ensure it belongs to the user and is not opened.
    let [treasureBox] = await tx
      .select()
      .from(schema.treasureBoxTable)
      .where(
        and(
          eq(schema.treasureBoxTable.id, treasureBoxId),
          eq(schema.treasureBoxTable.userId, userId),
        ),
      );

    if (!treasureBox) {
      throw new CustomError(
        "Treasure box not found or you don't have permission to open it.",
        404,
      );
    }

    if (treasureBox.isOpened) {
      throw new CustomError("This treasure box has already been opened.", 400);
    }

    if (
      treasureBox.isActive === false ||
      treasureBox.accountingStatus === "unacquired" ||
      (treasureBox.claimDeadlineAt && new Date() >= treasureBox.claimDeadlineAt)
    ) {
      throw new CustomError("This treasure box has expired.", 410);
    }

    // Step 2: Update the user's coin balance.
    const [updatedUser] = await tx
      .update(schema.userTable)
      .set({
        coins: sql`${schema.userTable.coins} + ${treasureBox.coinsAwarded}`,
      })
      .where(eq(schema.userTable.id, userId))
      .returning({
        id: schema.userTable.id,
        name: schema.userTable.name,
        coins: schema.userTable.coins,
        timezone: schema.userTable.timezone,
      });

    if (!updatedUser) {
      // This should theoretically not happen if the user exists for the treasure box
      throw new CustomError("User not found.", 404);
    }

    // Step 3: Mark the treasure box as opened.
    [treasureBox] = await tx
      .update(schema.treasureBoxTable)
      .set({
        isOpened: true,
        openedAt: new Date(),
      })
      .where(eq(schema.treasureBoxTable.id, treasureBoxId))
      .returning();

    // Step 4: Update coinsEarned in userMonthlyCoinStatTable (create a row if it doesn't exist)
    await tx
      .insert(schema.userMonthlyCoinStatTable)
      .values({
        userId: userId,
        month: getCurrentYYYYMM(updatedUser.timezone ?? "UTC"),
        coinsEarned: treasureBox.coinsAwarded,
      })
      .onConflictDoUpdate({
        target: [
          schema.userMonthlyCoinStatTable.userId,
          schema.userMonthlyCoinStatTable.month,
        ],
        set: {
          coinsEarned: sql`${schema.userMonthlyCoinStatTable.coinsEarned} + ${treasureBox.coinsAwarded}`,
        },
      });

    return treasureBox;
  });
}

async function openTreasureBoxWithLedger(userId: string, treasureBoxId: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    let [box] = await tx
      .select()
      .from(schema.treasureBoxTable)
      .where(
        and(
          eq(schema.treasureBoxTable.id, treasureBoxId),
          eq(schema.treasureBoxTable.userId, userId),
        ),
      )
      .for("update");
    if (!box) throw new CustomError("Treasure box not found.", 404);
    if (box.isOpened || box.accountingStatus === "acquired") {
      throw new CustomError("This treasure box has already been opened.", 400);
    }
    if (box.accountingStatus === "unacquired" || box.isActive === false) {
      throw new CustomError("This treasure box has expired.", 410);
    }
    if (box.claimDeadlineAt && now >= box.claimDeadlineAt) {
      throw new CustomError("This treasure box has expired.", 410);
    }

    const [user] = await tx
      .select({ timezone: schema.userTable.timezone })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .for("update");
    if (!user) throw new CustomError("User not found.", 404);
    const timezone = effectiveTimezone(box.timezoneSnapshot || user.timezone);
    const earningLocalMonth = getLocalMonth(now, timezone);
    const expiresAt = getEndOfNextLocalMonth(now, timezone);
    const allocations = await tx
      .select()
      .from(schema.treasureBoxRewardAllocationTable)
      .where(eq(schema.treasureBoxRewardAllocationTable.treasureBoxId, box.id))
      .orderBy(asc(schema.treasureBoxRewardAllocationTable.createdAt));

    const fundingAccountIds = [
      ...new Set(
        allocations
          .map((allocation) => allocation.fundingAccountId)
          .filter((id): id is string => id !== null),
      ),
    ].sort();
    const fundingAccounts = fundingAccountIds.length
      ? await tx
          .select()
          .from(schema.advertisementCoinFundingAccountTable)
          .where(
            inArray(
              schema.advertisementCoinFundingAccountTable.id,
              fundingAccountIds,
            ),
          )
          .orderBy(asc(schema.advertisementCoinFundingAccountTable.id))
          .for("update")
      : [];
    if (fundingAccounts.length !== fundingAccountIds.length) {
      throw new CustomError("Funding account not found.", 500);
    }

    const accountsById = new Map(
      fundingAccounts.map((account) => [account.id, account]),
    );
    const sellerUnitsRemaining = new Map(
      fundingAccounts.map((account) => [
        account.id,
        toCoinUnits(account.sellerFundingAvailableAmount),
      ]),
    );
    const accountAdjustments = new Map<
      string,
      { sellerUnits: number; platformUnits: number }
    >();
    const cohortAdjustments = new Map<
      string,
      { acquiredUnits: number; platformUnits: number }
    >();
    const lots: schema.NewUserCoinLot[] = [];
    const userTransactions: schema.NewUserCoinTransaction[] = [];
    const fundingTransactions: schema.NewAdvertisementCoinFundingTransaction[] = [];
    let creditedUnits = 0;

    const addLot = (
      lot: schema.NewUserCoinLot & { id: string },
      idempotencyKey: string,
      fundingTransaction?: schema.NewAdvertisementCoinFundingTransaction,
    ) => {
      lots.push(lot);
      userTransactions.push({
        userId,
        lotId: lot.id,
        type: "acquire",
        direction: "credit",
        amount: lot.originalAmount,
        idempotencyKey,
      });
      if (fundingTransaction) fundingTransactions.push(fundingTransaction);
    };

    for (const allocation of allocations) {
      const attributedUnits = toCoinUnits(allocation.attributedCoinAmount);
      if (attributedUnits <= 0) continue;
      creditedUnits += attributedUnits;

      if (!allocation.fundingAccountId) {
        const amount = fromCoinUnits(attributedUnits);
        const lotId = randomUUID();
        addLot(
          {
            id: lotId,
            userId,
            rewardAllocationId: allocation.id,
            legacySource: allocation.legacySource ?? "legacy_unattributed",
            currentFunderType: "platform",
            originalAmount: amount,
            availableAmount: amount,
            timezoneSnapshot: timezone,
            earningLocalMonth,
            expiresAt,
          },
          `box-acquire:${box.id}:legacy-allocation:${allocation.id}`,
        );
        await tx
          .update(schema.treasureBoxRewardAllocationTable)
          .set({
            acquiredCoinAmount: amount,
            platformAdvancedCoinAmount: amount,
            status: "acquired",
            acquiredAt: now,
          })
          .where(eq(schema.treasureBoxRewardAllocationTable.id, allocation.id));
        continue;
      }

      const account = accountsById.get(allocation.fundingAccountId);
      if (!account) throw new CustomError("Funding account not found.", 500);
      const availableSellerUnits =
        sellerUnitsRemaining.get(account.id) ?? 0;
      const sellerUnits = Math.min(attributedUnits, availableSellerUnits);
      const platformUnits = attributedUnits - sellerUnits;
      sellerUnitsRemaining.set(account.id, availableSellerUnits - sellerUnits);

      const accountAdjustment = accountAdjustments.get(account.id) ?? {
        sellerUnits: 0,
        platformUnits: 0,
      };
      accountAdjustment.sellerUnits += sellerUnits;
      accountAdjustment.platformUnits += platformUnits;
      accountAdjustments.set(account.id, accountAdjustment);

      if (allocation.settlementCohortId) {
        const cohortAdjustment = cohortAdjustments.get(
          allocation.settlementCohortId,
        ) ?? { acquiredUnits: 0, platformUnits: 0 };
        cohortAdjustment.acquiredUnits += attributedUnits;
        cohortAdjustment.platformUnits += platformUnits;
        cohortAdjustments.set(
          allocation.settlementCohortId,
          cohortAdjustment,
        );
      }

      await tx
        .update(schema.treasureBoxRewardAllocationTable)
        .set({
          acquiredCoinAmount: allocation.attributedCoinAmount,
          sellerFundedCoinAmount: fromCoinUnits(sellerUnits),
          platformAdvancedCoinAmount: fromCoinUnits(platformUnits),
          status: "acquired",
          acquiredAt: now,
        })
        .where(eq(schema.treasureBoxRewardAllocationTable.id, allocation.id));

      for (const portion of [
        { type: "seller" as const, units: sellerUnits },
        { type: "platform" as const, units: platformUnits },
      ]) {
        if (portion.units <= 0) continue;
        const amount = fromCoinUnits(portion.units);
        const lotId = randomUUID();
        addLot(
          {
            id: lotId,
            userId,
            rewardAllocationId: allocation.id,
            fundingAccountId: account.id,
            advertisementId: allocation.advertisementId,
            sourceSellerId: allocation.sourceSellerId,
            currentFunderType: portion.type,
            originalAmount: amount,
            availableAmount: amount,
            timezoneSnapshot: timezone,
            earningLocalMonth,
            expiresAt,
          },
          `box-acquire:${box.id}:${lotId}`,
          {
            fundingAccountId: account.id,
            settlementCohortId: allocation.settlementCohortId,
            type:
              portion.type === "seller"
                ? "reward_acquired_seller_funded"
                : "platform_advance_created",
            coinAmount: amount,
            currencyEquivalent: (portion.units / 1000).toFixed(2),
            coinToCurrencyRate: account.coinToCurrencyRate,
            treasureBoxRewardAllocationId: allocation.id,
            userCoinLotId: lotId,
            idempotencyKey: `box-funding:${box.id}:${lotId}`,
          },
        );
      }
    }

    if (allocations.length === 0 && box.coinsAwarded > 0) {
      const amount = decimalAmount(box.coinsAwarded);
      creditedUnits = toCoinUnits(amount);
      const lotId = randomUUID();
      addLot(
        {
          id: lotId,
          userId,
          legacySource: "legacy_unattributed",
          currentFunderType: "platform",
          originalAmount: amount,
          availableAmount: amount,
          timezoneSnapshot: timezone,
          earningLocalMonth,
          expiresAt,
        },
        `box-acquire:${box.id}:legacy`,
      );
    }

    for (const [accountId, adjustment] of accountAdjustments) {
      await tx
        .update(schema.advertisementCoinFundingAccountTable)
        .set({
          sellerFundingAvailableAmount: sql`${schema.advertisementCoinFundingAccountTable.sellerFundingAvailableAmount} - ${fromCoinUnits(adjustment.sellerUnits)}`,
          platformAdvanceOutstandingAmount: sql`${schema.advertisementCoinFundingAccountTable.platformAdvanceOutstandingAmount} + ${fromCoinUnits(adjustment.platformUnits)}`,
          platformFundedConsumedAmount: sql`${schema.advertisementCoinFundingAccountTable.platformFundedConsumedAmount} + ${fromCoinUnits(adjustment.platformUnits)}`,
        })
        .where(eq(schema.advertisementCoinFundingAccountTable.id, accountId));
    }
    for (const [cohortId, adjustment] of cohortAdjustments) {
      await tx
        .update(schema.advertisementCoinSettlementCohortTable)
        .set({
          acquiredRewardAmount: sql`${schema.advertisementCoinSettlementCohortTable.acquiredRewardAmount} + ${fromCoinUnits(adjustment.acquiredUnits)}`,
          advanceCreatedAmount: sql`${schema.advertisementCoinSettlementCohortTable.advanceCreatedAmount} + ${fromCoinUnits(adjustment.platformUnits)}`,
        })
        .where(eq(schema.advertisementCoinSettlementCohortTable.id, cohortId));
    }
    if (lots.length > 0) {
      await tx.insert(schema.userCoinLotTable).values(lots);
      await tx.insert(schema.userCoinTransactionTable).values(userTransactions);
    }
    if (fundingTransactions.length > 0) {
      await tx
        .insert(schema.advertisementCoinFundingTransactionTable)
        .values(fundingTransactions);
    }

    const credited = fromCoinUnits(creditedUnits);
    await tx
      .update(schema.userTable)
      .set({ coins: sql`${schema.userTable.coins} + ${credited}` })
      .where(eq(schema.userTable.id, userId));
    await tx
      .insert(schema.userMonthlyCoinStatTable)
      .values({ userId, month: earningLocalMonth, coinsEarned: Number(credited) })
      .onConflictDoUpdate({
        target: [
          schema.userMonthlyCoinStatTable.userId,
          schema.userMonthlyCoinStatTable.month,
        ],
        set: {
          coinsEarned: sql`${schema.userMonthlyCoinStatTable.coinsEarned} + ${credited}`,
        },
      });
    [box] = await tx
      .update(schema.treasureBoxTable)
      .set({
        isOpened: true,
        openedAt: now,
        acquiredAt: now,
        accountingStatus: "acquired",
      })
      .where(eq(schema.treasureBoxTable.id, box.id))
      .returning();
    return box;
  });
}

/**
 * Retrieves all treasure boxes for a given user, sorted by most recently earned.
 * @param userId The ID of the user.
 * @returns A promise that resolves to an array of treasure boxes.
 */
export async function getTreasureBoxesByUserId(userId: string) {
  const treasureBoxes = await db.query.treasureBoxTable.findMany({
    where: and(
      eq(schema.treasureBoxTable.userId, userId),
      eq(schema.treasureBoxTable.isActive, true),
    ),
    orderBy: (treasureBoxes, { desc }) => [desc(treasureBoxes.earnedAt)],
  });

  return treasureBoxes;
}

export async function resetDailyStats(userId: string) {
  return db.transaction(async (tx) => {
    const resetData = {
      totalViews: 0,
      remainingViews: 20,
      viewedAds: [],
      nextTreasureBoxIn: 2,
      treasureBoxesEarned: 0,
      canWatchMore: true,
    };

    // const [updatedStat] = await tx
    //   .update(schema.userDailyStatTable)
    //   .set(resetData)
    //   .where(eq(schema.userDailyStatTable.userId, userId))
    //   .returning();

    // if (!updatedStat) {
    //   throw new CustomError(
    //     `User stats for user id "${userId}" not found.`,
    //     404,
    //   );
    // }

    const [[updatedStat]] = await Promise.all([
      tx
        .update(schema.userDailyStatTable)
        .set(resetData)
        .where(eq(schema.userDailyStatTable.userId, userId))
        .returning(),
      tx
        // .delete(schema.treasureBoxTable)
        .update(schema.treasureBoxTable)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.treasureBoxTable.userId, userId),
            not(eq(schema.treasureBoxTable.isActive, false)),
          ),
        ),
    ]);

    if (!updatedStat) {
      throw new CustomError(
        `User stats for user id "${userId}" not found.`,
        404,
      );
    }

    return updatedStat;
  });
}
