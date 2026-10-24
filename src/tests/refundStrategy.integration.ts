import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { createRefundWithChatContext, updateRefundItemStatus } from "../repository/refund";
import { createDelivery, updateDeliveryWithNotificationContext, getDeliveryById } from "../repository/delivery";
import { getOrderById, updateOrderStatus } from "../repository/order";
import { refundEligibility, getRefundWindowMs, getRefundExtensionMs, REFUND_WINDOW_MS, REFUND_EXTENSION_MS } from "../lib/refundEligibility";
import { swaggerSpec } from "../lib/swagger";
import ecpayService from "../services/ecpay";

async function run() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const [buyer, stranger] = await db.insert(s.userTable).values([1, 2].map(() => ({ email: `${randomUUID()}@example.test`, oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID() }))).returning();
    const accounts = await db.insert(s.accountTable).values((["seller", "seller", "admin", "employee"] as const).map(role => ({ role, email: `${randomUUID()}@example.test`, password: "unused", realName: "Refund test", phone: "0900000000", profileCompletedAt: new Date(), emailVerifiedAt: new Date() }))).returning();
    const [seller, foreignSeller, admin, employee] = accounts;
    const [group] = await db.insert(s.accountGroupTable).values({ parentId: seller.id }).returning();
    await db.update(s.accountTable).set({ accountGroupId: group.id }).where(eq(s.accountTable.id, employee.id));
    const [product] = await db.insert(s.productTable).values({ sellerId: seller.id, name: "Refund strategy", description: "Fixture" }).returning();
    const [variant] = await db.insert(s.productVariantTable).values({ productId: product.id, price: 100, stock: 30 }).returning();
    async function fixture(quantity = 2) {
      const [order] = await db.insert(s.orderTable).values({ userId: buyer.id, subTotal: quantity * 100, totalAmount: quantity * 100, orderStatus: "paid", completedAt: new Date(), discountCoin: 0 }).returning();
      const [item] = await db.insert(s.orderItemTable).values({ orderId: order.id, productId: product.id, productVariantId: variant.id, quantity, unitPriceAtSale: 100, lineTotal: quantity * 100, productNameAtSale: product.name }).returning();
      const delivery = await createDelivery({ orderId: order.id, LogisticsType: "CVS", LogisticsSubType: "UNIMARTC2C", GoodsAmount: quantity * 100, status: "delivered", RtnCode: "2073", RtnMsg: "Store arrival" }, [{ productId: product.id, variantId: variant.id }], "provider_callback");
      return { order, item, delivery };
    }
    async function request(path: string, id: string, method = "GET", body?: unknown) {
      const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${await fixtureToken({ id })}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, data };
    }
    async function picked(f: Awaited<ReturnType<typeof fixture>>) {
      await updateDeliveryWithNotificationContext(f.delivery.id, { status: "delivered", RtnCode: "2067", RtnMsg: "Picked up" }, undefined, "provider_poll");
      return (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, f.item.id) }))!;
    }
    const f = await fixture();
    assert.equal(f.delivery.receivedAt, null);
    assert.equal(f.delivery.status, "ready_for_pickup");
    assert.equal((await request("/api/refund", buyer.id, "POST", { orderItemId: f.item.id, quantity: 1 })).status, 409);
    let item = await picked(f);
    assert.equal(item.refundDeadlineAt!.getTime() - item.refundWindowStartsAt!.getTime(), REFUND_WINDOW_MS);
    assert.deepEqual((await picked(f)).refundDeadlineAt, item.refundDeadlineAt);
    await updateDeliveryWithNotificationContext(f.delivery.id, { status: "delivered", RtnCode: "2073" }, undefined, "provider_callback");
    assert.deepEqual((await picked(f)).refundDeadlineAt, item.refundDeadlineAt);
    assert.equal(refundEligibility("paid", item, [], item.refundDeadlineAt!).canRefund, false);
    assert.equal(refundEligibility("paid", item, [], new Date(item.refundDeadlineAt!.getTime() - 1)).canRefund, true);
    for (const body of [{ extraRefundAmount: 0 }, { refundAmount: 1 }, { status: "completed" }, { metadata: { audit: true } }]) {
      assert.equal((await request("/api/refund", buyer.id, "POST", { orderItemId: item.id, quantity: 1, ...body })).status, 400);
    }
    for (const actor of accounts) {
      assert.equal((await request("/api/admin/refund", actor.id, "POST", { orderItemId: item.id, quantity: 1 })).status, 404);
      const denied = await request("/api/refund", actor.id, "POST", { orderItemId: item.id, quantity: 1 });
      assert.ok([401, 403].includes(denied.status));
    }
    assert.equal((await request("/api/refund", stranger.id, "POST", { orderItemId: item.id, quantity: 1 })).status, 404);
    await assert.rejects(createRefundWithChatContext({ orderItemId: item.id, quantity: 1, reason: "x", actor: { kind: "account", id: admin.id } }));
    await assert.rejects(createRefundWithChatContext({ orderItemId: item.id, quantity: 1, reason: "x", actor: { kind: "user", id: buyer.id }, extraRefundAmount: 100 } as any));
    const key = randomUUID();
    const payload = { orderItemId: item.id, quantity: 2, reason: "Please refund", clientRequestId: key };
    const [one, two] = await Promise.all([request("/api/refund", buyer.id, "POST", payload), request("/api/refund", buyer.id, "POST", payload)]);
    assert.equal(one.status, 200, JSON.stringify(one)); assert.equal(two.status, 200, JSON.stringify(two));
    const refund = one.data.data; assert.equal(refund.id, two.data.data.id); assert.equal(refund.extraRefundAmount, 0); assert.equal(refund.originalRequest.quantity, 2);
    assert.equal((await request("/api/refund", buyer.id, "POST", { ...payload, quantity: 1 })).status, 409);
    assert.equal((await request("/api/refund", buyer.id, "POST", { orderItemId: item.id, quantity: 1 })).status, 400);
    const patch = `/api/admin/refund/${refund.id}/status`;
    for (const actor of [buyer, stranger, foreignSeller, employee]) assert.notEqual((await request(patch, actor.id, "PATCH", { status: "processing" })).status, 200);
    assert.equal((await request(`/api/refund/${refund.id}/status`, buyer.id, "PATCH", { status: "completed" })).status, 404);
    assert.equal((await request(patch, seller.id, "PATCH", { quantity: 1 })).status, 409);
    const changed = await request(patch, seller.id, "PATCH", { quantity: 1, extraRefundAmount: 10, agreement: { confirmed: true, note: "Buyer agreed in order chat" } });
    assert.equal(changed.status, 200, JSON.stringify(changed)); assert.equal(changed.data.data.quantity, 1); assert.equal(changed.data.data.originalRequest.quantity, 2);
    const adjustmentLogs = await db.query.refundLogTable.findMany({ where: eq(s.refundLogTable.refundItemId, refund.id) });
    const adjustment = adjustmentLogs.find(log => (log.audit as any)?.agreement);
    assert.equal(adjustment?.actorAccountId, seller.id);
    assert.equal((adjustment?.audit as any).before.quantity, 2);
    assert.equal((adjustment?.audit as any).after.quantity, 1);
    assert.equal((await request(patch, seller.id, "PATCH", { status: "rejected" })).status, 400);
    assert.equal((await request(patch, seller.id, "PATCH", { status: "rejected", rejectionReason: "x", quantity: 1 })).status, 400);
    const rejection = { status: "rejected", rejectionReason: "Unable to agree" };
    // Move the effective window to an already elapsed original deadline; accepted requests survive.
    const oldStart = new Date(Date.now() - 12 * 86400000), oldDeadline = new Date(oldStart.getTime() + REFUND_WINDOW_MS);
    await db.update(s.orderItemTable).set({ refundWindowStartsAt: oldStart, originalRefundDeadlineAt: oldDeadline, refundDeadlineAt: oldDeadline }).where(eq(s.orderItemTable.id, item.id));
    assert.equal((await request("/api/refund", buyer.id, "POST", payload)).status, 200); // replay after expiry
    const rejected = await request(patch, seller.id, "PATCH", rejection); assert.equal(rejected.status, 200, JSON.stringify(rejected));
    const rejectedData = rejected.data.data;
    assert.equal(new Date(rejectedData.rejectionDeadlineAfter).getTime() - new Date(rejectedData.rejectedAt).getTime(), REFUND_EXTENSION_MS);
    const logsBefore = await db.query.refundLogTable.findMany({ where: eq(s.refundLogTable.refundItemId, refund.id) });
    assert.equal((await request(patch, seller.id, "PATCH", rejection)).status, 200);
    assert.equal((await db.query.refundLogTable.findMany({ where: eq(s.refundLogTable.refundItemId, refund.id) })).length, logsBefore.length);
    assert.equal((await request(patch, admin.id, "PATCH", { status: "completed" })).status, 409);
    const again = await request("/api/refund", buyer.id, "POST", { orderItemId: item.id, quantity: 2 }); assert.equal(again.status, 200, JSON.stringify(again));
    const againPatch = `/api/admin/refund/${again.data.data.id}/status`;
    assert.equal((await request(againPatch, admin.id, "PATCH", rejection)).status, 200);
    const repeated = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, item.id) }))!;
    assert.ok(repeated.refundDeadlineAt!.getTime() >= new Date(rejectedData.rejectionDeadlineAfter).getTime());
    const detail = await getOrderById(f.order.id, { userId: buyer.id, includeUser: false });
    assert.equal(detail!.items[0].remainingRefundQuantity, 2); assert.equal(detail!.items[0].canRefund, true);
    assert.equal((await getDeliveryById(f.delivery.id))!.items[0].canRefund, true);
    // Early rejection cannot shorten a later deadline.
    const early = await fixture(1); const earlyItem = await picked(early);
    const earlyRefund = await createRefundWithChatContext({ orderItemId: earlyItem.id, quantity: 1, reason: "x", actor: { kind: "user", id: buyer.id } });
    await updateRefundItemStatus(earlyRefund.refundItem.id, { status: "rejected", rejectionReason: "x" }, seller.id);
    assert.deepEqual((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, earlyItem.id) }))!.refundDeadlineAt, earlyItem.refundDeadlineAt);
    // Agreed partial completion does not extend and never refunds the completed unit again.
    const partial = await fixture(2); const partialItem = await picked(partial);
    const partialRefund = await createRefundWithChatContext({ orderItemId: partialItem.id, quantity: 2, reason: "x", actor: { kind: "user", id: buyer.id } });
    const partialUpdates = { quantity: 1, status: "completed" as const, extraRefundAmount: 2, agreement: { confirmed: true as const, note: "Chat agreement" } };
    const complete = await updateRefundItemStatus(partialRefund.refundItem.id, partialUpdates, admin.id);
    assert.equal(complete.refundItem.cashRefundAmount, 102);
    const stockAfter = (await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!.stock;
    await updateRefundItemStatus(partialRefund.refundItem.id, partialUpdates, admin.id);
    assert.equal((await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!.stock, stockAfter);
    const finalPartial = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, partialItem.id) }))!;
    assert.deepEqual(finalPartial.refundDeadlineAt, partialItem.refundDeadlineAt);
    const rest = await createRefundWithChatContext({ orderItemId: partialItem.id, quantity: 1, reason: "Remaining unit", actor: { kind: "user", id: buyer.id } });
    await updateRefundItemStatus(rest.refundItem.id, { status: "cancelled" }, seller.id);
    assert.deepEqual((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, partialItem.id) }))!.refundDeadlineAt, partialItem.refundDeadlineAt);
    // Unkeyed concurrent requests still cannot claim more than the purchased quantity.
    const race = await fixture(1);
    await picked(race);
    const raced = await Promise.all([1, 2].map(() => request("/api/refund", buyer.id, "POST", { orderItemId: race.item.id, quantity: 1 })));
    assert.deepEqual(raced.map(result => result.status).sort(), [200, 400]);

    // An accepted request can finish after expiry; a new request or quantity increase cannot.
    const late = await fixture(2);
    await picked(late);
    const lateRefund = await createRefundWithChatContext({ orderItemId: late.item.id, quantity: 1, reason: "x", actor: { kind: "user", id: buyer.id } });
    await db.update(s.orderItemTable).set({ refundWindowStartsAt: oldStart, originalRefundDeadlineAt: oldDeadline, refundDeadlineAt: oldDeadline }).where(eq(s.orderItemTable.id, late.item.id));
    const lateNew = await request("/api/refund", buyer.id, "POST", { orderItemId: late.item.id, quantity: 1 });
    assert.equal(lateNew.status, 409);
    assert.equal(lateNew.data.code, "REFUND_WINDOW_EXPIRED");
    await assert.rejects(updateRefundItemStatus(lateRefund.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Agreed" } }, seller.id), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");
    await updateRefundItemStatus(lateRefund.refundItem.id, { status: "completed" }, seller.id);
    assert.equal((await getOrderById(late.order.id))!.items[0].canRefund, false);

    // Signed callback creation and duplicate updates both initialize/preserve the window.
    const callback = await fixture(1);
    const tradeNo = randomUUID().replace(/-/g, "").slice(0, 20);
    await db.insert(s.merchantTradeTable).values({ orderId: callback.order.id, merchantTradeNo: tradeNo, productIds: [product.id], variantIds: [variant.id] });
    async function sendCallback(merchantTradeNo: string, code: string, valid = true) {
      const body = { MerchantTradeNo: merchantTradeNo, LogisticsType: "CVS", LogisticsSubType: "UNIMARTC2C", RtnCode: code, RtnMsg: "Fixture", AllPayLogisticsID: "123456789", GoodsAmount: "100" };
      const mac = valid ? ecpayService.generateCheckValue(body, process.env.LOGISTICS_HASH_KEY!, process.env.LOGISTICS_HASH_IV!, "md5") : "invalid";
      return fetch(base + "/api/ecpay/express/server-reply", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...body, CheckMacValue: mac }) });
    }
    assert.equal((await sendCallback(tradeNo, "2067", false)).status, 400);
    assert.equal((await sendCallback(tradeNo, "2073")).status, 200);
    assert.equal((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, callback.item.id) }))!.refundDeadlineAt, null);
    assert.equal((await sendCallback(tradeNo, "2067")).status, 200);
    const callbackItem = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, callback.item.id) }))!;
    assert.ok(callbackItem.refundWindowStartsAt);
    assert.equal((await sendCallback(tradeNo, "2067")).status, 200);
    assert.deepEqual((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, callback.item.id) }))!.refundDeadlineAt, callbackItem.refundDeadlineAt);
    assert.equal((await sendCallback("unknown-trade", "2067")).status, 500);

    // Manual delivery status edits cannot manufacture receipt evidence; historical delivered logs remain unknown.
    const unknown = await fixture(1);
    await updateDeliveryWithNotificationContext(unknown.delivery.id, { status: "delivered", RtnCode: "2067" }, seller.id);
    await updateDeliveryWithNotificationContext(unknown.delivery.id, { status: "delivered", RtnCode: "2067" }, undefined, "provider_poll");
    assert.equal((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, unknown.item.id) }))!.refundDeadlineAt, null);
    assert.equal((await getOrderById(unknown.order.id))!.items[0].refundWindowStatus, "unknown");
    const noLog = await fixture(1);
    await db.update(s.deliveryTable).set({ status: "delivered", RtnCode: "2067" }).where(eq(s.deliveryTable.id, noLog.delivery.id));
    await db.delete(s.deliveryLogTable).where(eq(s.deliveryLogTable.deliveryId, noLog.delivery.id));
    await updateDeliveryWithNotificationContext(noLog.delivery.id, { status: "delivered", RtnCode: "2067" }, undefined, "provider_poll");
    assert.equal((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, noLog.item.id) }))!.refundDeadlineAt, null);

    // Newly created receipt captures the window for its linked items in the same transaction.
    const fresh = await fixture(1);
    await createDelivery({ orderId: fresh.order.id, LogisticsType: "home_delivery", GoodsAmount: 100, status: "delivered" }, [{ productId: product.id, variantId: variant.id }], "provider_callback");
    assert.ok((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, fresh.item.id) }))!.refundDeadlineAt);
    // Only explicit local/development environments relax receipt checks; DB remains disposable.
    const originalEnvironment = process.env.NODE_ENV;
    try {
      for (const environment of ["local", "development"]) {
        process.env.NODE_ENV = environment;
        assert.equal(getRefundWindowMs(), 24 * 60 * 60 * 1000);
        assert.equal(getRefundExtensionMs(), 12 * 60 * 60 * 1000);
        const receiptTesting = await fixture(1);
        const receiptItem = await picked(receiptTesting);
        assert.equal(receiptItem.refundDeadlineAt!.getTime() - receiptItem.refundWindowStartsAt!.getTime(), 24 * 60 * 60 * 1000);
        assert.deepEqual((await picked(receiptTesting)).refundDeadlineAt, receiptItem.refundDeadlineAt);
        const earlyRequest = await createRefundWithChatContext({ orderItemId: receiptItem.id, quantity: 1, reason: "Receipt-window test", actor: { kind: "user", id: buyer.id } });
        const earlyRejection = await updateRefundItemStatus(earlyRequest.refundItem.id, { status: "rejected", rejectionReason: "Early rejection" }, seller.id);
        assert.deepEqual(earlyRejection.refundItem.rejectionDeadlineAfter, receiptItem.refundDeadlineAt);
        const testing = await fixture(3);
        const paidAt = new Date(Date.now() - 20 * 60 * 60 * 1000);
        const createdAt = new Date(Date.now() - 20 * 86400000);
        await db.update(s.orderTable).set({ completedAt: paidAt, createdAt }).where(eq(s.orderTable.id, testing.order.id));
        await db.update(s.orderItemTable).set({ deliveryId: null }).where(eq(s.orderItemTable.id, testing.item.id));
        const prePickup = (await getOrderById(testing.order.id))!.items[0];
        assert.equal(prePickup.canRefund, true);
        assert.equal(prePickup.refundReceiptChecksBypassed, true);
        assert.equal(prePickup.refundWindowSource, "payment_for_testing");
        assert.equal(prePickup.refundWindowStartsAt!.getTime(), paidAt.getTime());
        assert.equal(prePickup.originalRefundDeadlineAt!.getTime(), paidAt.getTime() + 24 * 60 * 60 * 1000);
        assert.equal(prePickup.refundWindowStatus, "open");
        assert.equal(prePickup.remainingRefundQuantity, 3);
        assert.equal(refundEligibility("paid", testing.item, [], prePickup.refundDeadlineAt!, undefined, paidAt).canRefund, false);
        assert.equal(refundEligibility("paid", testing.item, [], new Date(prePickup.refundDeadlineAt!.getTime() - 1), undefined, paidAt).canRefund, true);
        // A duplicate payment confirmation cannot restart the 24-hour window.
        await updateOrderStatus({ orderId: testing.order.id, status: "paid" });
        assert.equal((await getOrderById(testing.order.id))!.completedAt!.getTime(), paidAt.getTime());
        const input = { orderItemId: testing.item.id, quantity: 1, reason: "Pre-pickup testing", actor: { kind: "user" as const, id: buyer.id } };
        const testingRefund = await createRefundWithChatContext(input);
        await updateRefundItemStatus(testingRefund.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Buyer agreement" } }, seller.id);
        await assert.rejects(createRefundWithChatContext({ ...input, quantity: 2 }), (error: any) => error.statusCode === 400);
        await assert.rejects(createRefundWithChatContext({ ...input, actor: { kind: "user", id: stranger.id } }), (error: any) => error.statusCode === 404);
        await assert.rejects(updateRefundItemStatus(testingRefund.refundItem.id, { status: "rejected", rejectionReason: "Test" }, foreignSeller.id), (error: any) => error.statusCode === 404);
        const testingRejection = await updateRefundItemStatus(testingRefund.refundItem.id, { status: "rejected", rejectionReason: "Test" }, seller.id);
        assert.equal(testingRejection.refundItem.rejectionDeadlineBefore!.getTime(), prePickup.refundDeadlineAt!.getTime());
        assert.equal(testingRejection.refundItem.rejectionDeadlineAfter!.getTime(), testingRejection.refundItem.rejectedAt!.getTime() + 12 * 60 * 60 * 1000);
        const repeated = await updateRefundItemStatus(testingRefund.refundItem.id, { status: "rejected", rejectionReason: "Test" }, seller.id);
        assert.deepEqual(repeated.refundItem.rejectionDeadlineAfter, testingRejection.refundItem.rejectionDeadlineAfter);
        assert.deepEqual((await getOrderById(testing.order.id))!.items[0].refundDeadlineAt, testingRejection.refundItem.rejectionDeadlineAfter);
        const stored = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, testing.item.id) }))!;
        assert.equal(stored.refundWindowStartsAt, null);
        assert.equal(stored.refundDeadlineAt, null);
        await createRefundWithChatContext(input);

        await db.update(s.orderTable).set({ orderStatus: "pending" }).where(eq(s.orderTable.id, testing.order.id));
        assert.equal((await getOrderById(testing.order.id))!.items[0].refundBlockReason, "ORDER_NOT_PAID");
        await assert.rejects(createRefundWithChatContext(input), (error: any) => error.code === "ORDER_NOT_PAID");
        await db.update(s.orderTable).set({ orderStatus: "paid" }).where(eq(s.orderTable.id, testing.order.id));
        // A real pickup window takes precedence, even over a later testing rejection.
        await db.update(s.orderItemTable).set({ deliveryId: testing.delivery.id, refundWindowStartsAt: oldStart, originalRefundDeadlineAt: oldDeadline, refundDeadlineAt: oldDeadline }).where(eq(s.orderItemTable.id, testing.item.id));
        const expiredTesting = (await getOrderById(testing.order.id))!.items[0];
        assert.equal(expiredTesting.refundWindowSource, "receipt");
        assert.equal(expiredTesting.refundWindowStatus, "expired");
        assert.equal(expiredTesting.canRefund, false);
        assert.equal((await getDeliveryById(testing.delivery.id))!.items[0].canRefund, false);
        await assert.rejects(createRefundWithChatContext(input), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");

        const paymentWindow = await fixture(3);
        const paymentInput = { ...input, orderItemId: paymentWindow.item.id, clientRequestId: randomUUID() };
        const accepted = await createRefundWithChatContext(paymentInput);
        await db.update(s.orderTable).set({ completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(s.orderTable.id, paymentWindow.order.id));
        const expiredPayment = (await getOrderById(paymentWindow.order.id))!.items[0];
        assert.equal(expiredPayment.refundWindowStatus, "expired");
        assert.equal(expiredPayment.canRefund, false);
        assert.equal((await getDeliveryById(paymentWindow.delivery.id))!.items[0].canRefund, false);
        await assert.rejects(createRefundWithChatContext({ ...paymentInput, clientRequestId: randomUUID() }), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");
        await assert.rejects(updateRefundItemStatus(accepted.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Too late" } }, seller.id), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");
        assert.equal((await createRefundWithChatContext(paymentInput)).refundItem.id, accepted.refundItem.id);
        // Accepted requests remain reviewable after expiry; rejection opens a persisted 12-hour window.
        const lateRejection = await updateRefundItemStatus(accepted.refundItem.id, { status: "rejected", rejectionReason: "Reviewed after deadline" }, seller.id);
        const renewed = (await getOrderById(paymentWindow.order.id))!.items[0];
        assert.equal(renewed.canRefund, true);
        assert.equal(lateRejection.refundItem.rejectionDeadlineAfter!.getTime() - lateRejection.refundItem.rejectedAt!.getTime(), 12 * 60 * 60 * 1000);
        assert.deepEqual(renewed.refundDeadlineAt, lateRejection.refundItem.rejectionDeadlineAfter);
        assert.deepEqual((await getDeliveryById(paymentWindow.delivery.id))!.items[0].refundDeadlineAt, renewed.refundDeadlineAt);
        await createRefundWithChatContext({ ...paymentInput, clientRequestId: randomUUID() });
        // Legacy paid rows with missing payment time cannot use creation/deployment time as a substitute.
        const missingPayment = await fixture(1);
        await db.update(s.orderTable).set({ completedAt: null }).where(eq(s.orderTable.id, missingPayment.order.id));
        assert.equal((await getOrderById(missingPayment.order.id))!.items[0].refundBlockReason, "PAYMENT_TIME_UNKNOWN");
        await assert.rejects(createRefundWithChatContext({ ...input, orderItemId: missingPayment.item.id }), (error: any) => error.code === "PAYMENT_TIME_UNKNOWN");
        // First payment confirmation initializes the existing payment timestamp, then keeps it stable.
        const confirmed = await updateOrderStatus({ orderId: missingPayment.order.id, status: "paid" });
        assert.ok(confirmed!.completedAt);
        const confirmedAgain = await updateOrderStatus({ orderId: missingPayment.order.id, status: "paid" });
        assert.deepEqual(confirmedAgain!.completedAt, confirmed!.completedAt);

      }
      for (const environment of ["stg", "production", "test", "unknown", undefined]) {
        if (environment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = environment;
        assert.equal(getRefundWindowMs(), 240 * 60 * 60 * 1000);
        assert.equal(getRefundExtensionMs(), 120 * 60 * 60 * 1000);
        const noReceipt = { ...f.item, deliveryId: null };
        assert.equal(refundEligibility("paid", noReceipt, [], new Date(), undefined, new Date()).canRefund, false);
        assert.equal(refundEligibility("paid", noReceipt, []).refundReceiptChecksBypassed, false);
        assert.equal(refundEligibility("paid", item, [], item.refundDeadlineAt!).canRefund, false);
        await assert.rejects(createRefundWithChatContext({ orderItemId: unknown.item.id, quantity: 1, reason: "No receipt", actor: { kind: "user", id: buyer.id } }), (error: any) => error.code === "RECEIPT_TIME_UNKNOWN");
      }
    } finally {
      if (originalEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnvironment;
    }
    const spec = swaggerSpec as any; assert.equal(spec.paths["/api/admin/refund"]?.post, undefined); assert.equal(spec.paths["/api/refund"], undefined);
    console.log("Refund strategy integration passed: pickup windows, permissions, partial completion, unlimited rejection renewal, quantity safety, audit, retry and expiry.");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await client.end({ timeout: 5 }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
