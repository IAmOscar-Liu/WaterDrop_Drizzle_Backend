import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { client } from "../lib/initDB";
import db from "../lib/initDB";
import { getLocalDate } from "../lib/coinAccounting";
import {
  createAdvertisement,
  financiallyCloseAdvertisement,
  listAdvertisements,
  setAdStatus,
  transferArchivedAdvertisementBalance,
} from "../repository/advertisement";
import {
  expireUnclaimedTreasureBoxes,
  expireUserCoinLots,
  refundOrderCoinsWithTx,
  settleAdvertisementCoinCohorts,
} from "../repository/coinLedger";
import { updateOrderStatus } from "../repository/order";
import {
  openTreasureBox,
  processVideoCompletion,
} from "../repository/treasureBox";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.COIN_LEDGER_ENABLED, "true");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const sellers = await db
    .insert(schema.accountTable)
    .values([0, 1].map((index) => ({
      email: `coin-ledger-${suffix}-${index}@example.test`,
      password: "not-used",
      realName: `Ledger Seller ${index}`,
      phone: `0900${String(Date.now()).slice(-6)}${index}`,
    })))
    .returning();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      email: `coin-ledger-user-${suffix}@example.test`,
      oauthProvider: "other",
      oauthId: `coin-ledger-${suffix}`,
      referralCode: `ledger-${suffix}`,
      timezone: "Asia/Taipei",
    })
    .returning();
  await db.insert(schema.userDailyStatTable).values({
    userId: user.id,
    groupAdViewsCountYesterday: 20,
  });

  const products = await db
    .insert(schema.productTable)
    .values(sellers.map((seller, index) => ({
      sellerId: seller.id,
      name: `Ledger Product ${index}`,
      description: "Integration fixture",
    })))
    .returning();
  const variants = await db
    .insert(schema.productVariantTable)
    .values(products.map((product, index) => ({
      productId: product.id,
      name: "Default",
      sku: `ledger-${suffix}-${index}`,
      price: 10,
      stock: 100,
      reserve: index === 0 ? 1 : 0,
      optionValues: {},
    })))
    .returning();
  const advertisements: schema.Advertisement[] = [];
  for (const [index, product] of products.entries()) {
    const advertisement = await createAdvertisement({
      productId: product.id,
      title: `Ledger Ad ${index}`,
      video_url: "https://example.test/ad.mp4",
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

  const listed = await listAdvertisements({ userId: user.id, limit: 1000 });
  assert.ok(
    advertisements.every((advertisement) =>
      listed.advertisements.some((listedAd) => listedAd.id === advertisement.id),
    ),
  );
  await processVideoCompletion(user.id, advertisements[0].id);
  const completion = await processVideoCompletion(user.id, advertisements[1].id);
  assert.ok(completion);
  assert.equal(completion.isAwarded, true);
  await assert.rejects(
    () => processVideoCompletion(user.id, advertisements[1].id),
    /No valid issued assignment/,
  );

  const [box] = await db
    .select()
    .from(schema.treasureBoxTable)
    .where(eq(schema.treasureBoxTable.userId, user.id));
  assert.equal(box.accountingStatus, "claimable");
  assert.equal(box.coinsAwarded, 15);
  const allocations = await db
    .select()
    .from(schema.treasureBoxRewardAllocationTable)
    .where(eq(schema.treasureBoxRewardAllocationTable.treasureBoxId, box.id));
  assert.deepEqual(
    allocations.map((allocation) => Number(allocation.attributedCoinAmount)).sort(),
    [7.5, 7.5],
  );

  await openTreasureBox(user.id, box.id);
  await assert.rejects(
    () => openTreasureBox(user.id, box.id),
    /already been opened/,
  );
  const lots = await db
    .select()
    .from(schema.userCoinLotTable)
    .where(eq(schema.userCoinLotTable.userId, user.id));
  assert.equal(lots.length, 2);
  assert.equal(
    lots.reduce((sum, lot) => sum + Number(lot.availableAmount), 0),
    15,
  );

  const [order] = await db
    .insert(schema.orderTable)
    .values({
      userId: user.id,
      subTotal: 10,
      totalAmount: 9.575,
      discountCoin: 4.25,
    })
    .returning();
  const [orderItem] = await db
    .insert(schema.orderItemTable)
    .values({
      orderId: order.id,
      productId: products[0].id,
      productVariantId: variants[0].id,
      quantity: 1,
      pendingQuantity: 1,
      unitPriceAtSale: 10,
      productNameAtSale: products[0].name,
      lineTotal: 10,
    })
    .returning();
  await updateOrderStatus({ orderId: order.id, status: "payment-processing" });
  let orderAllocations = await db
    .select()
    .from(schema.orderCoinAllocationTable)
    .where(eq(schema.orderCoinAllocationTable.orderId, order.id));
  assert.equal(
    orderAllocations.reduce(
      (sum, allocation) => sum + Number(allocation.reservedAmount),
      0,
    ),
    4.25,
  );
  await updateOrderStatus({ orderId: order.id, status: "paid" });
  orderAllocations = await db
    .select()
    .from(schema.orderCoinAllocationTable)
    .where(eq(schema.orderCoinAllocationTable.orderId, order.id));
  assert.equal(
    orderAllocations.reduce(
      (sum, allocation) => sum + Number(allocation.consumedAmount),
      0,
    ),
    4.25,
  );

  const [refund] = await db
    .insert(schema.refundItemTable)
    .values({
      orderItemId: orderItem.id,
      quantity: 1,
      reason: "Integration refund",
    })
    .returning();
  const refundSummary = await db.transaction((tx) =>
    refundOrderCoinsWithTx(tx, {
      orderId: order.id,
      userId: user.id,
      refundId: refund.id,
      amount: 1.25,
    }),
  );
  assert.equal(refundSummary.totalCoin, 1.25);
  assert.equal(refundSummary.returnableCoin, 1.25);

  const [secondUser] = await db
    .insert(schema.userTable)
    .values({
      email: `coin-ledger-user-2-${suffix}@example.test`,
      oauthProvider: "other",
      oauthId: `coin-ledger-2-${suffix}`,
      referralCode: `ledger-2-${suffix}`,
      timezone: "Asia/Taipei",
      coins: 5,
    })
    .returning();
  await db.insert(schema.userDailyStatTable).values({ userId: secondUser.id });
  const [firstAccount] = await db
    .select()
    .from(schema.advertisementCoinFundingAccountTable)
    .where(
      eq(
        schema.advertisementCoinFundingAccountTable.advertisementId,
        advertisements[0].id,
      ),
    );
  const [platformLot] = await db
    .insert(schema.userCoinLotTable)
    .values({
      userId: secondUser.id,
      fundingAccountId: firstAccount.id,
      advertisementId: advertisements[0].id,
      sourceSellerId: sellers[0].id,
      currentFunderType: "platform",
      originalAmount: "5.00",
      availableAmount: "5.00",
      timezoneSnapshot: "Asia/Taipei",
      earningLocalMonth: getLocalDate(new Date(), "Asia/Taipei").slice(0, 7),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  await db
    .update(schema.advertisementCoinFundingAccountTable)
    .set({
      platformAdvanceOutstandingAmount: "5.00",
      platformFundedConsumedAmount: "5.00",
    })
    .where(eq(schema.advertisementCoinFundingAccountTable.id, firstAccount.id));
  await db.insert(schema.advertisementAssignmentTable).values({
    userId: secondUser.id,
    advertisementId: advertisements[0].id,
    sourceSellerId: sellers[0].id,
    assignmentBatchId: randomUUID(),
    userLocalDate: getLocalDate(new Date(), "Asia/Taipei"),
    timezoneSnapshot: "Asia/Taipei",
  });
  const [thirdUser] = await db
    .insert(schema.userTable)
    .values({
      email: `coin-ledger-user-3-${suffix}@example.test`,
      oauthProvider: "other",
      oauthId: `coin-ledger-3-${suffix}`,
      referralCode: `ledger-3-${suffix}`,
      timezone: "Asia/Taipei",
    })
    .returning();
  await db.insert(schema.userDailyStatTable).values({
    userId: thirdUser.id,
    groupAdViewsCountYesterday: 20,
  });
  await db.insert(schema.advertisementAssignmentTable).values(
    advertisements.map((advertisement, index) => ({
      userId: thirdUser.id,
      advertisementId: advertisement.id,
      sourceSellerId: sellers[index].id,
      assignmentBatchId: randomUUID(),
      userLocalDate: getLocalDate(new Date(), "Asia/Taipei"),
      timezoneSnapshot: "Asia/Taipei",
    })),
  );
  await setAdStatus(advertisements[0].id, "archived");
  const afterArchiveList = await listAdvertisements({
    userId: secondUser.id,
    limit: 1000,
  });
  assert.equal(
    afterArchiveList.advertisements.some(
      (advertisement) => advertisement.id === advertisements[0].id,
    ),
    false,
  );
  await processVideoCompletion(secondUser.id, advertisements[0].id);
  const [reclassifiedLot] = await db
    .select()
    .from(schema.userCoinLotTable)
    .where(eq(schema.userCoinLotTable.id, platformLot.id));
  assert.equal(reclassifiedLot.currentFunderType, "seller");
  const [repaidAccount] = await db
    .select()
    .from(schema.advertisementCoinFundingAccountTable)
    .where(eq(schema.advertisementCoinFundingAccountTable.id, firstAccount.id));
  assert.equal(Number(repaidAccount.platformAdvanceOutstandingAmount), 0);
  await processVideoCompletion(thirdUser.id, advertisements[0].id);
  await processVideoCompletion(thirdUser.id, advertisements[1].id);
  const [unclaimedBox] = await db
    .select()
    .from(schema.treasureBoxTable)
    .where(eq(schema.treasureBoxTable.userId, thirdUser.id));
  await db
    .update(schema.treasureBoxTable)
    .set({ claimDeadlineAt: new Date(Date.now() - 1000) })
    .where(eq(schema.treasureBoxTable.id, unclaimedBox.id));
  await expireUnclaimedTreasureBoxes();
  const [expiredBox] = await db
    .select()
    .from(schema.treasureBoxTable)
    .where(eq(schema.treasureBoxTable.id, unclaimedBox.id));
  assert.equal(expiredBox.accountingStatus, "unacquired");
  await db
    .update(schema.userCoinLotTable)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.userCoinLotTable.id, platformLot.id));

  const [firstLot] = await db
    .select()
    .from(schema.userCoinLotTable)
    .where(eq(schema.userCoinLotTable.id, orderAllocations[0].lotId));
  await db
    .update(schema.userCoinLotTable)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.userCoinLotTable.id, firstLot.id));
  await expireUserCoinLots();
  const [expiredLot] = await db
    .select()
    .from(schema.userCoinLotTable)
    .where(eq(schema.userCoinLotTable.id, firstLot.id));
  assert.equal(expiredLot.status, "expired");

  await db
    .update(schema.advertisementCoinSettlementCohortTable)
    .set({ claimSettlementAt: new Date(Date.now() - 1000) })
    .where(
      inArray(
        schema.advertisementCoinSettlementCohortTable.fundingAccountId,
        allocations.map((allocation) => allocation.fundingAccountId!),
      ),
    );
  await settleAdvertisementCoinCohorts();
  const sellerReturns = await db
    .select()
    .from(schema.sellerCoinReturnTransactionTable)
    .where(
      inArray(
        schema.sellerCoinReturnTransactionTable.advertisementId,
        advertisements.map((advertisement) => advertisement.id),
      ),
    );
  assert.ok(sellerReturns.length >= 3);
  await expireUserCoinLots();
  await settleAdvertisementCoinCohorts();
  const [{ returnCountAfterRetry }] = await db
    .select({ returnCountAfterRetry: sql<number>`count(*)` })
    .from(schema.sellerCoinReturnTransactionTable)
    .where(
      inArray(
        schema.sellerCoinReturnTransactionTable.advertisementId,
        advertisements.map((advertisement) => advertisement.id),
      ),
    );
  assert.equal(Number(returnCountAfterRetry), sellerReturns.length);

  await db
    .update(schema.advertisementTable)
    .set({ archiveGraceEndsAt: new Date(Date.now() - 1000) })
    .where(eq(schema.advertisementTable.id, advertisements[0].id));
  await financiallyCloseAdvertisement(advertisements[0].id);
  const replacement = await createAdvertisement({
    productId: products[0].id,
    title: "Replacement Ledger Ad",
    video_url: "https://example.test/replacement.mp4",
  });
  assert.equal(
    replacement.replacementOfAdvertisementId,
    advertisements[0].id,
  );
  const transferKey = `integration-transfer-${suffix}`;
  const transfer = await transferArchivedAdvertisementBalance({
    sourceAdvertisementId: advertisements[0].id,
    destinationAdvertisementId: replacement.id,
    amount: 1.25,
    idempotencyKey: transferKey,
  });
  const transferRetry = await transferArchivedAdvertisementBalance({
    sourceAdvertisementId: advertisements[0].id,
    destinationAdvertisementId: replacement.id,
    amount: 1.25,
    idempotencyKey: transferKey,
  });
  assert.equal(transferRetry.id, transfer.id);

  const [{ control }] = await db.select({
    control: sql<number>`count(*) filter (where original_amount <> available_amount + reserved_amount + consumed_amount + expired_amount + returned_amount)`,
  }).from(schema.userCoinLotTable).where(eq(schema.userCoinLotTable.userId, user.id));
  assert.equal(Number(control), 0);
  console.log("coin-ledger integration test passed", {
    boxId: box.id,
    orderId: order.id,
    refundId: refund.id,
    sellerReturnCount: sellerReturns.length,
  });
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
