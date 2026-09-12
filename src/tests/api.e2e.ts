import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import * as schema from "../db/schema";
import { getLocalDate, getLocalMonth } from "../lib/coinAccounting";
import db, { client } from "../lib/initDB";
import { generateToken } from "../lib/token";
import { expireUserCoinLots } from "../repository/coinLedger";
import ecpayService from "../services/ecpay";

type ApiEnvelope = {
  success: boolean;
  statusCode?: number;
  message?: unknown;
  data?: any;
};

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.NO_CRON, "true");
  assert.equal(process.env.COIN_LEDGER_ENABLED, "true");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(
    route: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token
          ? { authorization: `Bearer ${options.token}` }
          : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const json = (await response.json()) as ApiEnvelope;
    return { status: response.status, json };
  }

  function expectSuccess(
    result: Awaited<ReturnType<typeof request>>,
    expectedStatus = 200,
  ) {
    assert.equal(result.status, expectedStatus, JSON.stringify(result.json));
    assert.equal(result.json.success, true, JSON.stringify(result.json));
    return result.json.data;
  }

  async function waitFor(
    predicate: () => Promise<boolean>,
    description: string,
  ) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  async function login(label: string) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: {
        name: `API User ${label}`,
        email: `api-${label}@example.test`,
        oauthProvider: "other",
        oauthId: `api-${label}`,
        timezone: "Asia/Taipei",
      },
    });
    const data = expectSuccess(result);
    assert.equal(typeof data.token, "string");
    return data as { token: string; user: schema.User; isNewUser: boolean };
  }

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [seller] = await db
      .insert(schema.accountTable)
      .values({
        email: `api-seller-${suffix}@example.test`,
        password: "not-used",
        realName: "API Test Seller",
        role: "seller",
        phone: "0900000000",
      })
      .returning();
    const sellerToken = generateToken(seller);
    assert.ok(sellerToken);

    const products = await db
      .insert(schema.productTable)
      .values([0, 1].map((index) => ({
        sellerId: seller.id,
        name: `API Product ${suffix} ${index}`,
        description: "Disposable API test fixture",
      })))
      .returning();
    await db.insert(schema.productVariantTable).values(
      products.map((product, index) => ({
        productId: product.id,
        name: "Default",
        sku: `api-${suffix}-${index}`,
        price: 20,
        stock: 100,
        optionValues: {},
      })),
    );

    expectSuccess(await request("/api/test"));
    const unauthenticatedProfile = await request("/api/auth/profile");
    assert.equal(unauthenticatedProfile.status, 401);
    assert.equal(unauthenticatedProfile.json.success, false);

    const advertisements: schema.Advertisement[] = [];
    for (const [index, product] of products.entries()) {
      const created = expectSuccess(
        await request("/api/admin/advertisement/create", {
          method: "POST",
          token: sellerToken,
          body: {
            productId: product.id,
            title: `API Ad ${suffix} ${index}`,
            video_url: "https://example.test/ad.mp4",
          },
        }),
      ) as schema.Advertisement;
      advertisements.push(created);
      expectSuccess(
        await request(`/api/admin/advertisement/deposit/${created.id}`, {
          method: "PUT",
          token: sellerToken,
          body: { amount: 200 },
        }),
      );
      expectSuccess(
        await request(`/api/admin/advertisement/status/${created.id}`, {
          method: "PUT",
          token: sellerToken,
          body: { status: "active" },
        }),
      );
    }

    const user = await login(`reward-${suffix}`);
    const profile = expectSuccess(
      await request("/api/auth/profile", { token: user.token }),
    ) as schema.User;
    assert.equal(profile.id, user.user.id);

    const validationFailure = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: user.token,
        body: {},
      },
    );
    assert.equal(validationFailure.status, 400);

    const adList = expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: user.token,
      }),
    );
    assert.ok(
      advertisements.every((advertisement) =>
        adList.advertisements.some(
          (listed: schema.Advertisement) => listed.id === advertisement.id,
        ),
      ),
    );

    expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: user.token,
      }),
    );
    const reusedAssignments = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        and(
          eq(schema.advertisementAssignmentTable.userId, user.user.id),
          inArray(
            schema.advertisementAssignmentTable.advertisementId,
            advertisements.map((advertisement) => advertisement.id),
          ),
        ),
      );
    assert.equal(reusedAssignments.length, advertisements.length);

    const staleLocalDate = getLocalDate(
      new Date(Date.now() - 24 * 60 * 60 * 1_000),
      "Asia/Taipei",
    );
    const staleAssignedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [staleAssignment] = await db
      .insert(schema.advertisementAssignmentTable)
      .values({
        userId: user.user.id,
        advertisementId: advertisements[0].id,
        sourceSellerId: seller.id,
        assignmentBatchId: randomUUID(),
        userLocalDate: staleLocalDate,
        timezoneSnapshot: "Asia/Taipei",
        assignedAt: staleAssignedAt,
      })
      .returning();

    const firstCompletion = expectSuccess(
      await request("/api/treasureBox/video-complete", {
        method: "POST",
        token: user.token,
        body: { advertisementId: advertisements[0].id },
      }),
    );
    assert.equal(firstCompletion.isAwarded, false);
    const [stillIssuedStaleAssignment] = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(eq(schema.advertisementAssignmentTable.id, staleAssignment.id));
    assert.equal(stillIssuedStaleAssignment.status, "issued");
    const secondCompletion = expectSuccess(
      await request("/api/treasureBox/video-complete", {
        method: "POST",
        token: user.token,
        body: { advertisementId: advertisements[1].id },
      }),
    );
    assert.equal(secondCompletion.isAwarded, true);

    const duplicateCompletion = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: user.token,
        body: { advertisementId: advertisements[1].id },
      },
    );
    assert.equal(duplicateCompletion.status, 409);

    const boxes = expectSuccess(
      await request("/api/treasureBox/list", { token: user.token }),
    ) as schema.TreasureBox[];
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].coinsAwarded, 15);
    expectSuccess(
      await request(`/api/treasureBox/open/${boxes[0].id}`, {
        method: "POST",
        token: user.token,
      }),
    );
    const duplicateOpen = await request(
      `/api/treasureBox/open/${boxes[0].id}`,
      { method: "POST", token: user.token },
    );
    assert.equal(duplicateOpen.status, 400);

    const rewardedProfile = expectSuccess(
      await request("/api/auth/profile", { token: user.token }),
    ) as schema.User;
    assert.equal(rewardedProfile.coins, 15);

    const ledger = expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/coin-ledger`,
        { token: sellerToken },
      ),
    );
    assert.equal(
      ledger.fundingAccount.advertisementId,
      advertisements[0].id,
    );
    const forbiddenLedger = await request(
      `/api/admin/advertisement/${advertisements[0].id}/coin-ledger`,
      { token: user.token },
    );
    assert.equal(forbiddenLedger.status, 403);

    const lateUser = await login(`expired-completion-${suffix}`);
    await db
      .update(schema.userDailyStatTable)
      .set({ groupAdViewsCountYesterday: 20 })
      .where(eq(schema.userDailyStatTable.userId, lateUser.user.id));
    expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: lateUser.token,
      }),
    );
    const lateAssignments = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        and(
          eq(schema.advertisementAssignmentTable.userId, lateUser.user.id),
          inArray(
            schema.advertisementAssignmentTable.advertisementId,
            advertisements.map((advertisement) => advertisement.id),
          ),
        ),
      );
    assert.equal(lateAssignments.length, advertisements.length);
    await db
      .update(schema.advertisementAssignmentTable)
      .set({ status: "expired", userLocalDate: staleLocalDate })
      .where(
        inArray(
          schema.advertisementAssignmentTable.id,
          lateAssignments.map((assignment) => assignment.id),
        ),
      );
    const spendBeforeLateCompletion = await db
      .select({
        advertisementId: schema.advertisementStatsTable.advertisementId,
        balance: schema.advertisementStatsTable.balance,
        totalSpent: schema.advertisementStatsTable.totalSpent,
      })
      .from(schema.advertisementStatsTable)
      .where(
        inArray(
          schema.advertisementStatsTable.advertisementId,
          advertisements.map((advertisement) => advertisement.id),
        ),
      );

    const firstLateCompletion = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: lateUser.token,
        body: { advertisementId: advertisements[0].id },
      },
    );
    assert.equal(firstLateCompletion.status, 409);
    const secondLateCompletion = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: lateUser.token,
        body: { advertisementId: advertisements[1].id },
      },
    );
    assert.equal(secondLateCompletion.status, 409);
    const [unchangedLateDailyStat] = await db
      .select()
      .from(schema.userDailyStatTable)
      .where(eq(schema.userDailyStatTable.userId, lateUser.user.id));
    assert.equal(unchangedLateDailyStat.totalViews, 0);

    const spendAfterLateCompletion = await db
      .select({
        advertisementId: schema.advertisementStatsTable.advertisementId,
        balance: schema.advertisementStatsTable.balance,
        totalSpent: schema.advertisementStatsTable.totalSpent,
      })
      .from(schema.advertisementStatsTable)
      .where(
        inArray(
          schema.advertisementStatsTable.advertisementId,
          advertisements.map((advertisement) => advertisement.id),
        ),
      );
    assert.deepEqual(spendAfterLateCompletion, spendBeforeLateCompletion);
    const lateViews = await db
      .select()
      .from(schema.adViewCountTable)
      .where(
        inArray(
          schema.adViewCountTable.assignmentId,
          lateAssignments.map((assignment) => assignment.id),
        ),
      );
    assert.equal(lateViews.length, 0);
    const lateBoxes = expectSuccess(
      await request("/api/treasureBox/list", { token: lateUser.token }),
    ) as schema.TreasureBox[];
    assert.equal(lateBoxes.length, 0);

    const expiredBoxUser = await login(`expired-box-${suffix}`);
    const expiredDeadline = new Date(Date.now() - 1_000);
    const [expiredBox] = await db
      .insert(schema.treasureBoxTable)
      .values({
        userId: expiredBoxUser.user.id,
        coinsAwarded: 15,
        accountingStatus: "unacquired",
        isActive: false,
        timezoneSnapshot: "Asia/Taipei",
        userLocalDate: staleLocalDate,
        localClaimDeadlineAt: expiredDeadline,
        claimDeadlineAt: expiredDeadline,
      })
      .returning();
    const expiredBoxOpen = await request(
      `/api/treasureBox/open/${expiredBox.id}`,
      { method: "POST", token: expiredBoxUser.token },
    );
    assert.equal(expiredBoxOpen.status, 410);
    const [unchangedExpiredBoxUser] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, expiredBoxUser.user.id));
    assert.equal(unchangedExpiredBoxUser.coins, 0);
    const [unchangedExpiredBox] = await db
      .select()
      .from(schema.treasureBoxTable)
      .where(eq(schema.treasureBoxTable.id, expiredBox.id));
    assert.equal(unchangedExpiredBox.isOpened, false);
    assert.equal(unchangedExpiredBox.accountingStatus, "unacquired");

    const graceUser = await login(`grace-${suffix}`);
    const graceList = expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: graceUser.token,
      }),
    );
    assert.ok(
      graceList.advertisements.some(
        (listed: schema.Advertisement) => listed.id === advertisements[0].id,
      ),
    );
    expectSuccess(
      await request(
        `/api/admin/advertisement/status/${advertisements[0].id}`,
        {
          method: "PUT",
          token: sellerToken,
          body: { status: "archived" },
        },
      ),
    );

    const postArchiveUser = await login(`post-archive-${suffix}`);
    const postArchiveList = expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: postArchiveUser.token,
      }),
    );
    assert.equal(
      postArchiveList.advertisements.some(
        (listed: schema.Advertisement) => listed.id === advertisements[0].id,
      ),
      false,
    );
    expectSuccess(
      await request("/api/treasureBox/video-complete", {
        method: "POST",
        token: graceUser.token,
        body: { advertisementId: advertisements[0].id },
      }),
    );

    const earlyClose = await request(
      `/api/admin/advertisement/${advertisements[0].id}/financial-close`,
      { method: "POST", token: sellerToken },
    );
    assert.equal(earlyClose.status, 409);

    await db
      .update(schema.advertisementTable)
      .set({ archiveGraceEndsAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.advertisementTable.id, advertisements[0].id));
    expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/financial-close`,
        { method: "POST", token: sellerToken },
      ),
    );

    const replacement = expectSuccess(
      await request("/api/admin/advertisement/create", {
        method: "POST",
        token: sellerToken,
        body: {
          productId: products[0].id,
          title: `API Replacement ${suffix}`,
          video_url: "https://example.test/replacement.mp4",
        },
      }),
    ) as schema.Advertisement;
    assert.equal(
      replacement.replacementOfAdvertisementId,
      advertisements[0].id,
    );

    const idempotencyKey = `api-transfer-${suffix}`;
    const transferBody = {
      destinationAdvertisementId: replacement.id,
      amount: 1.25,
      idempotencyKey,
    };
    const firstTransfer = expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/balance-transfer`,
        { method: "POST", token: sellerToken, body: transferBody },
      ),
    );
    const repeatedTransfer = expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/balance-transfer`,
        { method: "POST", token: sellerToken, body: transferBody },
      ),
    );
    assert.equal(repeatedTransfer.id, firstTransfer.id);

    const orderUser = await login(`order-${suffix}`);
    const currentMonth = getLocalMonth(new Date(), "Asia/Taipei");
    const previousMonth = getLocalMonth(
      new Date(Date.now() - 32 * 24 * 60 * 60 * 1_000),
      "Asia/Taipei",
    );
    assert.notEqual(previousMonth, currentMonth);
    await db
      .update(schema.userTable)
      .set({ coins: 50 })
      .where(eq(schema.userTable.id, orderUser.user.id));
    await db.insert(schema.userMonthlyCoinStatTable).values([
      {
        userId: orderUser.user.id,
        month: previousMonth,
        coinsEarned: 2,
      },
      {
        userId: orderUser.user.id,
        month: currentMonth,
        coinsEarned: 48,
      },
    ]);
    await db.insert(schema.userCoinLotTable).values([
      {
        userId: orderUser.user.id,
        currentFunderType: "platform",
        legacySource: "api-test",
        originalAmount: "2.00",
        availableAmount: "2.00",
        timezoneSnapshot: "Asia/Taipei",
        earningLocalMonth: previousMonth,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      },
      {
        userId: orderUser.user.id,
        currentFunderType: "platform",
        legacySource: "api-test",
        originalAmount: "48.00",
        availableAmount: "48.00",
        timezoneSnapshot: "Asia/Taipei",
        earningLocalMonth: currentMonth,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000),
      },
    ]);

    const [virtualProduct] = await db
      .insert(schema.productTable)
      .values({
        sellerId: seller.id,
        name: `API Virtual Product ${suffix}`,
        description: "Virtual order/refund API fixture",
        type: "virtual",
      })
      .returning();
    const [virtualVariant] = await db
      .insert(schema.productVariantTable)
      .values({
        productId: virtualProduct.id,
        name: "Virtual",
        sku: `api-virtual-${suffix}`,
        price: 100,
        stock: 100,
        optionValues: {},
      })
      .returning();
    const orderIdempotencyKey = `api-order-${suffix}`;
    const order = expectSuccess(
      await request("/api/order", {
        method: "POST",
        token: orderUser.token,
        body: {
          idempotencyKey: orderIdempotencyKey,
          items: [
            {
              productId: virtualProduct.id,
              productVariantId: virtualVariant.id,
              quantity: 1,
              unitPriceAtSale: 100,
              productNameAtSale: virtualProduct.name,
            },
          ],
          subTotal: 100,
          totalAmount: 95,
          discountCoin: 50,
          shippingCost: 0,
          shippingCostDeduction: 0,
          transactionFee: 0,
          orderPayment: "Credit",
        },
      }),
    );
    assert.equal(order.orderStatus, "pending");
    assert.equal(order.coinInfo, null);

    const callbackData = {
      MerchantID: process.env.MERCHANTID!,
      MerchantTradeNo: `API${Date.now()}`,
      RtnCode: "1",
      RtnMsg: "Succeeded",
      TradeAmt: "95",
      TradeNo: `MOCK${Date.now()}`,
      PaymentDate: "2026/09/12 12:00:00",
      PaymentType: "Credit_CreditCard",
      PaymentTypeChargeFee: "0",
      TradeDate: "2026/09/12 11:59:00",
      SimulatePaid: "0",
      CustomField1: order.id,
      CustomField2: orderIdempotencyKey,
      CustomField3: "",
      CustomField4: "",
    };
    const checkMacValue = ecpayService.generateCheckValue(
      callbackData,
      process.env.HASHKEY!,
      process.env.HASHIV!,
    );
    const callbackResponse = await fetch(`${baseUrl}/api/ecpay/return`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...callbackData,
        CheckMacValue: checkMacValue,
      }),
    });
    assert.equal(callbackResponse.status, 200);
    assert.equal(await callbackResponse.text(), "1|OK");

    const paidOrder = expectSuccess(
      await request(`/api/order/${order.id}`, { token: orderUser.token }),
    );
    assert.equal(paidOrder.orderStatus, "paid");
    assert.deepEqual(paidOrder.coinInfo, {
      [previousMonth]: 2,
      [currentMonth]: 48,
    });
    const paidUser = expectSuccess(
      await request("/api/auth/profile", { token: orderUser.token }),
    ) as schema.User;
    assert.equal(paidUser.coins, 0);

    const [virtualDelivery] = await db
      .insert(schema.deliveryTable)
      .values({
        orderId: order.id,
        status: "delivered",
        LogisticsType: "virtual",
        GoodsAmount: 100,
      })
      .returning();
    await db
      .update(schema.orderItemTable)
      .set({ deliveryId: virtualDelivery.id })
      .where(eq(schema.orderItemTable.id, order.items[0].id));

    const refund = expectSuccess(
      await request("/api/refund", {
        method: "POST",
        token: orderUser.token,
        body: {
          orderItemId: order.items[0].id,
          accountId: seller.id,
          quantity: 1,
          refundAmount: 99.5,
          extraRefundAmount: 0.72,
          reason: "API refund coin restoration test",
        },
      }),
    );
    assert.equal(refund.paidRefundAmount, 94.53);
    assert.equal(refund.cashRefundAmount, 95);
    assert.equal(refund.cashRemainderCoins, 2.5);
    await waitFor(async () => {
      const chatRoom = await db.query.chatRoomTable.findFirst({
        where: eq(schema.chatRoomTable.orderId, order.id),
        with: { messages: true },
      });
      return Boolean(chatRoom?.messages.length);
    }, "refund chat message");
    const refundChatRoom = await db.query.chatRoomTable.findFirst({
      where: eq(schema.chatRoomTable.orderId, order.id),
      with: { messages: true },
    });
    const refundMessages = refundChatRoom?.messages ?? [];
    const refundChatContent =
      refundMessages[refundMessages.length - 1]?.content ?? "";
    assert.match(refundChatContent, /退款金額：NT\$ 95/);
    assert.match(refundChatContent, /退還金幣：52\.25/);
    assert.match(
      refundChatContent,
      /退款金額的小數部分將依 NT\$1 = 10 金幣轉換/,
    );
    assert.doesNotMatch(refundChatContent, /原始現金退款|實際現金退款/);
    const completedRefund = expectSuccess(
      await request(`/api/admin/refund/${refund.id}/status`, {
        method: "PATCH",
        token: sellerToken,
        body: {
          status: "completed",
          message: "API test refund completed",
        },
      }),
    );
    assert.equal(completedRefund.paidRefundAmount, 94.53);
    assert.equal(completedRefund.extraRefundAmount, 0.72);
    assert.equal(completedRefund.cashRefundAmount, 95);
    assert.equal(completedRefund.cashRemainderCoins, 2.5);
    assert.equal(completedRefund.coins, 49.75);
    assert.equal(completedRefund.returnableCoins, 52.25);
    assert.equal(completedRefund.summary.originalReturnableCoin, 49.75);
    assert.equal(completedRefund.summary.cashRemainderCoin, 2.5);
    assert.equal(
      completedRefund.summary.cashRemainderSourceSellerId,
      seller.id,
    );
    assert.deepEqual(completedRefund.summary.coinByMonth, {
      [previousMonth]: { coin: 2, expired: false, returnedCoin: 2 },
      [currentMonth]: { coin: 47.75, expired: false, returnedCoin: 47.75 },
    });
    const terminalExtraUpdate = await request(
      `/api/admin/refund/${refund.id}/status`,
      {
        method: "PATCH",
        token: sellerToken,
        body: { extraRefundAmount: 1 },
      },
    );
    assert.equal(terminalExtraUpdate.status, 400);
    const [conversionLot] = await db
      .select()
      .from(schema.userCoinLotTable)
      .where(eq(schema.userCoinLotTable.sourceRefundId, refund.id));
    assert.ok(conversionLot);
    assert.equal(conversionLot.sourceSellerId, seller.id);
    assert.equal(conversionLot.originalAmount, "2.50");
    const [conversionTransaction] = await db
      .select()
      .from(schema.userCoinTransactionTable)
      .where(eq(schema.userCoinTransactionTable.lotId, conversionLot.id));
    assert.equal(conversionTransaction.type, "cash_refund_conversion");
    const refundedUser = expectSuccess(
      await request("/api/auth/profile", { token: orderUser.token }),
    ) as schema.User;
    assert.equal(refundedUser.coins, 52.25);

    await db
      .update(schema.userCoinLotTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.userCoinLotTable.id, conversionLot.id));
    const expiredConversionLots = await expireUserCoinLots();
    assert.ok(expiredConversionLots.includes(conversionLot.id));
    const [sellerReturn] = await db
      .select()
      .from(schema.productSellerCoinReturnTransactionTable)
      .where(
        eq(
          schema.productSellerCoinReturnTransactionTable.userCoinLotId,
          conversionLot.id,
        ),
      );
    assert.equal(sellerReturn.sourceSellerId, seller.id);
    assert.equal(sellerReturn.reason, "expired_unused");
    assert.equal(sellerReturn.coinAmount, "2.50");
    const userAfterConversionExpiry = expectSuccess(
      await request("/api/auth/profile", { token: orderUser.token }),
    ) as schema.User;
    assert.equal(userAfterConversionExpiry.coins, 49.75);

    console.log("API end-to-end tests passed");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
