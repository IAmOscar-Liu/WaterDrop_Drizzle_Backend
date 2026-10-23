import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import { createOrder, updateOrderStatus } from "../repository/order";
import { findOrCreateChatRoom, getChatRoomById, listAdminChatRooms, listChatRooms, sendChatMessage } from "../repository/chatroom";
import ecpayController from "../controller/ecpay";
import ecpayService from "../services/ecpay";
import { createDelivery, updateDeliveryWithNotificationContext } from "../repository/delivery";
import { openChatFeed, readChatFeed, readChatSummaries } from "../repository/chatroomSync";
import { adminChatPrincipal, openAdminChatFeed, readAdminChatFeed } from "../repository/adminChatroomSync";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  try {
    const [buyer, otherBuyer] = await db.insert(s.userTable).values([1, 2].map(() => ({
      email: `${randomUUID()}@example.test`, oauthProvider: "other" as const,
      oauthId: randomUUID(), referralCode: randomUUID(),
    }))).returning();
    const [seller, otherSeller] = await db.insert(s.accountTable).values([1, 2].map(() => ({
      role: "seller" as const, email: `${randomUUID()}@example.test`, password: "unused",
      profileCompletedAt: new Date(), emailVerifiedAt: new Date(),
    }))).returning();
    const [product] = await db.insert(s.productTable).values({
      sellerId: seller.id, name: "Chat order fixture", description: "Fixture",
    }).returning();
    const variants = await db.insert(s.productVariantTable).values(
      Array.from({ length: 6 }, (_, i) => ({ productId: product.id, name: `Variant ${i}`, price: 100, stock: 100 })),
    ).returning();
    const roomInput = { userId: buyer.id, accountId: seller.id, productId: product.id, productVariantId: variants[0].id };
    const room = await findOrCreateChatRoom(roomInput);
    await sendChatMessage({ actor: { kind: "user", id: buyer.id }, chatRoomId: room.id, senderType: "user", content: "Before purchase" });
    const messagesBefore = await db.query.chatMessageTable.findMany();
    const unlinkedRooms = await db.insert(s.chatRoomTable).values([
      { ...roomInput, userId: otherBuyer.id },
      { ...roomInput, accountId: otherSeller.id },
      { ...roomInput, productVariantId: variants[1].id },
      { userId: buyer.id }, // Platform support is unrelated to the order.
      { ...roomInput, productVariantId: variants[2].id, status: "inactive" },
    ]).returning();
    const emptyRoom = await findOrCreateChatRoom({ ...roomInput, productVariantId: variants[3].id });
    const before = await openChatFeed(buyer.id);
    const principal = await adminChatPrincipal(seller.id);
    const adminBefore = await openAdminChatFeed(principal);
    const orderInput = (indices: number[], key = randomUUID()) => ({
      orderData: { userId: buyer.id, subTotal: 100 * indices.length, totalAmount: 100 * indices.length },
      items: indices.map((i) => ({ productId: product.id, productVariantId: variants[i].id,
        productNameAtSale: product.name, unitPriceAtSale: 100, quantity: 1 })),
      idempotencyKey: key,
    });
    const input = orderInput([0, 2, 3, 4]);
    const order = (await createOrder(input))!;
    assert.equal(order.orderStatus, "pending");
    const linked = (await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, room.id) }))!;
    assert.equal(linked.orderId, order.id);
    assert.deepEqual(await db.query.chatMessageTable.findMany(), messagesBefore);
    for (const unrelated of unlinkedRooms) {
      assert.equal((await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, unrelated.id) }))!.orderId, null);
    }
    assert.equal((await db.query.chatRoomTable.findMany()).length, unlinkedRooms.length + 2, "No new rooms created");
    const events = await readChatFeed(buyer.id, before.sequence);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.eventType === "chatroom.updated"));
    const updated = events.find((event) => event.chatRoomId === room.id)!.payload.room as any;
    assert.equal(updated.id, room.id);
    assert.equal(updated.orderId, order.id);
    assert.equal(updated.order.id, order.id);
    assert.equal(updated.order.orderStatus, "pending");
    assert.equal(updated.order.delivery, null);
    assert.equal((events.find((event) => event.chatRoomId === emptyRoom.id)!.payload.room as any).listVisible, false);
    assert.equal((await readAdminChatFeed(principal, adminBefore.sequence)).length, 2);
    const legacy = await listChatRooms({ userId: buyer.id });
    assert.equal(legacy.rooms.find((r) => r.id === room.id)!.order!.id, order.id);
    assert.ok(!legacy.rooms.some((r) => r.id === emptyRoom.id));
    const summaries = await db.transaction((tx) => readChatSummaries(tx, buyer.id, [room.id]));
    assert.equal(summaries[0].order!.id, order.id);

    // Neither retries nor a repeat purchase can replace an already-linked order.
    const after = await openChatFeed(buyer.id);
    await assert.rejects(createOrder(input), /Duplicate order request/);
    await createOrder(orderInput([0]));
    assert.equal((await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, room.id) }))!.orderId, order.id);
    assert.deepEqual(await readChatFeed(buyer.id, after.sequence), []);
    assert.equal((await findOrCreateChatRoom({ ...roomInput, orderId: order.id })).id, room.id);

    // Publication failure rolls back the order, stock reserve, idempotency key and association.
    const rollbackRoom = await findOrCreateChatRoom({ ...roomInput, productVariantId: variants[5].id });
    const rollbackInput = orderInput([5]);
    const rollbackHead = await openChatFeed(buyer.id);
    await client.unsafe("CREATE FUNCTION fail_chat_order_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test publication failure'; END $$");
    await client.unsafe("CREATE TRIGGER fail_chat_order_event BEFORE INSERT ON chat_feed_events FOR EACH ROW EXECUTE FUNCTION fail_chat_order_event()");
    try {
      await assert.rejects(createOrder(rollbackInput));
    } finally {
      await client.unsafe("DROP TRIGGER fail_chat_order_event ON chat_feed_events");
      await client.unsafe("DROP FUNCTION fail_chat_order_event()");
    }
    assert.equal((await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, rollbackRoom.id) }))!.orderId, null);
    assert.equal((await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variants[5].id) }))!.reserve, 0);
    assert.equal(await db.query.idempotencyKeyTable.findFirst({ where: eq(s.idempotencyKeyTable.key, rollbackInput.idempotencyKey) }), undefined);
    assert.equal((await db.query.orderTable.findMany()).length, 2);
    assert.deepEqual(await readChatFeed(buyer.id, rollbackHead.sequence), []);

    // Competing checkouts may both succeed, but only one can claim the pre-sale room.
    const concurrent = await Promise.all([createOrder(rollbackInput), createOrder(orderInput([5]))]);
    const winner = (await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, rollbackRoom.id) }))!;
    assert.ok(concurrent.some((o) => o!.id === winner.orderId));
    assert.equal((await readChatFeed(buyer.id, rollbackHead.sequence)).length, 1);

    // A failed payment must clear displayed order/delivery data, including old
    // incorrectly-created logistics, without losing a chat or colliding with a
    // second unlinked room created while checkout was underway.
    const failureRoom = await findOrCreateChatRoom({ ...roomInput, productVariantId: variants[4].id });
    await sendChatMessage({ actor: { kind: "user", id: buyer.id }, chatRoomId: failureRoom.id, senderType: "user", content: "Failure test" });
    const failedInput = orderInput([4]);
    const failedOrder = (await createOrder(failedInput))!;
    const sibling = await findOrCreateChatRoom({ ...roomInput, productVariantId: variants[4].id });
    assert.notEqual(sibling.id, failureRoom.id);
    const [legacyDelivery] = await db.insert(s.deliveryTable).values({
      orderId: failedOrder.id, LogisticsType: "CVS", LogisticsSubType: "UNIMARTC2C",
      GoodsAmount: 100, RtnMsg: "訂單處理中(綠界已收到訂單資料)",
    }).returning();
    await db.update(s.orderItemTable).set({ deliveryId: legacyDelivery.id }).where(eq(s.orderItemTable.orderId, failedOrder.id));
    await db.update(s.orderTable).set({ shippingInfo: {
      cvsPickupGroup: [{ orderId: failedOrder.id }],
      nonCvsPickupGroup: [{ LogisticsType: "HOME", GoodsAmount: 100, products: [] }],
    } }).where(eq(s.orderTable.id, failedOrder.id));
    const failureHead = await openChatFeed(buyer.id);
    const failureAdminHead = await openAdminChatFeed(principal);
    const deliveryCount = (await db.query.deliveryTable.findMany()).length;
    const originalValidate = ecpayService.validateCheckMacValue;
    const originalCreate = ecpayService.createExpressServerReturn;
    let logisticsCalls = 0;
    let acknowledgement: unknown;
    ecpayService.validateCheckMacValue = () => true;
    ecpayService.createExpressServerReturn = async () => { logisticsCalls++; return {} as any; };
    try {
      await ecpayController.handleReturn({ body: {
        CustomField1: failedOrder.id, CustomField2: failedInput.idempotencyKey,
        RtnCode: "10100058", RtnMsg: "付款失敗",
      } } as Request, { send: (value: unknown) => { acknowledgement = value; } } as Response);
    } finally {
      ecpayService.validateCheckMacValue = originalValidate;
      ecpayService.createExpressServerReturn = originalCreate;
    }
    assert.equal(acknowledgement, "1|OK");
    assert.equal(logisticsCalls, 0, "Failed payments must not call ECPay logistics");
    assert.equal((await db.query.deliveryTable.findMany()).length, deliveryCount, "Failed payments must not create home/virtual deliveries");
    assert.equal((await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, failedOrder.id) }))!.orderStatus, "failed");
    const failureEvents = await readChatFeed(buyer.id, failureHead.sequence);
    assert.equal(failureEvents.length, 1);
    for (const event of [...failureEvents, ...await readAdminChatFeed(principal, failureAdminHead.sequence)]) {
      assert.equal(event.eventType, "chatroom.updated");
      assert.equal((event.payload.room as any).orderId, null);
      assert.equal((event.payload.room as any).order, null);
    }
    assert.equal((await getChatRoomById(failureRoom.id, { kind: "user", id: buyer.id }))!.orderId, null);
    for (const list of [await listChatRooms({ userId: buyer.id }), await listAdminChatRooms({ accountId: seller.id })]) {
      const displayed = list.rooms.find((r) => r.id === failureRoom.id)!;
      assert.equal(displayed.orderId, null);
      assert.equal(displayed.order, null);
    }
    assert.equal((await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, failureRoom.id) }))!.orderId, failedOrder.id, "Retain audit reference");
    assert.ok(await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, sibling.id) }));
    const retryHead = await openChatFeed(buyer.id);
    await updateOrderStatus({ orderId: failedOrder.id, status: "failed" });
    assert.deepEqual(await readChatFeed(buyer.id, retryHead.sequence), [], "Repeated failure must not emit another event");

    // Cart contact after failure must return the original conversation, even
    // when an older implementation has already left a second unlinked room.
    const failureLookup = { ...roomInput, productVariantId: variants[4].id };
    const roomCountBeforeContact = (await db.query.chatRoomTable.findMany()).length;
    const reopened = await Promise.all([
      findOrCreateChatRoom(failureLookup), findOrCreateChatRoom(failureLookup),
    ]);
    for (const result of reopened) {
      assert.equal(result.id, failureRoom.id);
      assert.equal(result.orderId, null, "Do not expose the failed order in create/find responses");
    }
    assert.equal((await db.query.chatRoomTable.findMany()).length, roomCountBeforeContact);
    await sendChatMessage({ actor: { kind: "user", id: buyer.id }, chatRoomId: reopened[0].id, senderType: "user", content: "hi again" });
    assert.deepEqual((await db.query.chatMessageTable.findMany({
      where: eq(s.chatMessageTable.chatRoomId, failureRoom.id), orderBy: s.chatMessageTable.createdAt,
    })).map((m) => m.content), ["Failure test", "hi again"]);
    const retryOrder = (await createOrder(orderInput([4])))!;
    assert.equal((await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, failureRoom.id) }))!.orderId, retryOrder.id);
    assert.equal((await db.query.chatRoomTable.findFirst({ where: eq(s.chatRoomTable.id, sibling.id) }))!.orderId, null, "Link only the selected conversation");
    assert.equal((await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, failedOrder.id) }))!.orderStatus, "failed", "Keep failed order history");
    assert.equal((await listChatRooms({ userId: buyer.id })).rooms.find((r) => r.id === failureRoom.id)!.order!.id, retryOrder.id);

    // Fresh failure flow without any duplicate: reopening never creates one.
    const singleRoom = unlinkedRooms[2];
    const singleOrder = (await createOrder(orderInput([1])))!;
    await updateOrderStatus({ orderId: singleOrder.id, status: "failed" });
    const singleReopened = await findOrCreateChatRoom({ ...roomInput, productVariantId: variants[1].id });
    assert.equal(singleReopened.id, singleRoom.id);
    assert.equal(singleReopened.orderId, null);
    assert.equal((await db.query.chatRoomTable.findMany()).length, roomCountBeforeContact);

    // Pending/ATM processing and paid orders keep their existing display contract.
    const paymentHead = await openChatFeed(buyer.id);
    await updateOrderStatus({ orderId: order.id, status: "payment-processing" });
    assert.equal((await listChatRooms({ userId: buyer.id })).rooms.find((r) => r.id === room.id)!.order!.orderStatus, "payment-processing");
    await updateOrderStatus({ orderId: order.id, status: "paid" });
    assert.equal((await listChatRooms({ userId: buyer.id })).rooms.find((r) => r.id === room.id)!.order!.orderStatus, "paid");
    const paymentEvents = (await readChatFeed(buyer.id, paymentHead.sequence)).filter((e) => e.chatRoomId === room.id);
    assert.deepEqual(paymentEvents.map((e) => (e.payload.room as any).order.orderStatus), ["payment-processing", "paid"]);
    assert.equal((paymentEvents[1].payload.room as any).order.delivery, null);
    assert.ok((paymentEvents[1].payload.room as any).version > (paymentEvents[0].payload.room as any).version);
    const paidHead = await openChatFeed(buyer.id);
    await updateOrderStatus({ orderId: order.id, status: "paid" });
    assert.deepEqual(await readChatFeed(buyer.id, paidHead.sequence), [], "Repeated payment status emits no duplicate summary");

    const deliveryAdminHead = await openAdminChatFeed(principal);
    const delivery = await createDelivery({
      orderId: order.id, LogisticsType: "CVS", LogisticsSubType: "UNIMARTC2C",
      GoodsAmount: 100, RtnCode: "300", RtnMsg: "訂單處理中", status: "pending",
    }, [{ productId: product.id, variantId: variants[0].id }], "provider_callback");
    const createdDeliveryEvents = await readChatFeed(buyer.id, paidHead.sequence);
    assert.equal(createdDeliveryEvents.length, 1, "Do not publish unchanged rooms for other order variants");
    assert.equal(createdDeliveryEvents[0].chatRoomId, room.id);
    assert.equal((createdDeliveryEvents[0].payload.room as any).order.delivery.id, delivery.id);
    const adminDeliveryEvents = await readAdminChatFeed(principal, deliveryAdminHead.sequence);
    assert.equal(adminDeliveryEvents.length, 1);
    assert.equal((adminDeliveryEvents[0].payload.room as any).order.delivery.RtnMsg, "訂單處理中");

    const deliveryHead = await openChatFeed(buyer.id);
    await updateDeliveryWithNotificationContext(delivery.id, { status: "shipped", RtnCode: "302", RtnMsg: "運送中" }, undefined, "provider_poll");
    await updateDeliveryWithNotificationContext(delivery.id, { status: "shipped", RtnCode: "302", RtnMsg: "運送中" }, undefined, "provider_callback");
    await updateDeliveryWithNotificationContext(delivery.id, { lastPolledAt: new Date(), metadata: { test: true } });
    const shippingEvents = await readChatFeed(buyer.id, deliveryHead.sequence);
    assert.equal(shippingEvents.length, 1, "Duplicate polls and internal metadata updates must not bump chat revisions");
    assert.equal((shippingEvents[0].payload.room as any).order.delivery.status, "shipped");
    await updateDeliveryWithNotificationContext(delivery.id, { RtnMsg: "配送狀態已更新" }, seller.id);
    const messageOnlyEvents = await readChatFeed(buyer.id, shippingEvents[0].sequence);
    assert.equal(messageOnlyEvents.length, 1, "A displayed delivery text change publishes even without a status change");
    assert.equal((messageOnlyEvents[0].payload.room as any).order.delivery.RtnMsg, "配送狀態已更新");

    // Publication failures must roll back delivery creation/association and updates.
    const beforeRollbackDelivery = await db.query.deliveryTable.findFirst({ where: eq(s.deliveryTable.id, delivery.id) });
    const beforeRollbackItem = await db.query.orderItemTable.findFirst({ where: and(eq(s.orderItemTable.orderId, order.id), eq(s.orderItemTable.productVariantId, variants[0].id)) });
    const beforeRollbackCount = (await db.query.deliveryTable.findMany()).length;
    const deliveryRollbackHead = await openChatFeed(buyer.id);
    await client.unsafe("CREATE FUNCTION fail_chat_delivery_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test delivery publication failure'; END $$");
    await client.unsafe("CREATE TRIGGER fail_chat_delivery_event BEFORE INSERT ON chat_feed_events FOR EACH ROW EXECUTE FUNCTION fail_chat_delivery_event()");
    try {
      await assert.rejects(updateDeliveryWithNotificationContext(delivery.id, { RtnMsg: "Must roll back" }));
      await assert.rejects(createDelivery({ orderId: order.id, LogisticsType: "CVS", GoodsAmount: 100 }, [
        { productId: product.id, variantId: variants[0].id },
      ]));
      await assert.rejects(updateOrderStatus({ orderId: singleOrder.id, status: "expired" }));
    } finally {
      await client.unsafe("DROP TRIGGER fail_chat_delivery_event ON chat_feed_events");
      await client.unsafe("DROP FUNCTION fail_chat_delivery_event()");
    }
    assert.deepEqual(await db.query.deliveryTable.findFirst({ where: eq(s.deliveryTable.id, delivery.id) }), beforeRollbackDelivery);
    assert.deepEqual(await db.query.orderItemTable.findFirst({ where: and(eq(s.orderItemTable.orderId, order.id), eq(s.orderItemTable.productVariantId, variants[0].id)) }), beforeRollbackItem);
    assert.equal((await db.query.deliveryTable.findMany()).length, beforeRollbackCount);
    assert.equal((await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, singleOrder.id) }))!.orderStatus, "failed");
    assert.deepEqual(await readChatFeed(buyer.id, deliveryRollbackHead.sequence), []);
    // Expiry/cancellation through the shared order updater also notify the room.
    await updateOrderStatus({ orderId: retryOrder.id, status: "expired" });
    const expiryEvents = await readChatFeed(buyer.id, deliveryRollbackHead.sequence);
    assert.equal(expiryEvents.length, 1);
    assert.equal((expiryEvents[0].payload.room as any).order.orderStatus, "expired");
    const tradeHead = await openChatFeed(buyer.id);
    await updateOrderStatus({ orderId: order.id, status: "paid", metadata: { MerchantTradeNo: "updated-trade" } });
    const tradeEvents = await readChatFeed(buyer.id, tradeHead.sequence);
    assert.equal((tradeEvents.find((e) => e.chatRoomId === room.id)!.payload.room as any).order.merchantTradeNo, "updated-trade");
    const tradeRetryHead = await openChatFeed(buyer.id);
    await updateOrderStatus({ orderId: order.id, status: "paid", metadata: { MerchantTradeNo: "updated-trade" } });
    assert.deepEqual(await readChatFeed(buyer.id, tradeRetryHead.sequence), []);
    console.log("Order/chat tests passed: association/reuse, live payment and delivery summaries, scoped app/admin events, unchanged-poll suppression, rollback, retries and concurrent purchases.");
  } finally {
    await client.end();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
