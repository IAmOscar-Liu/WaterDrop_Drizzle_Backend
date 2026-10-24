import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import { paymentProcessingExpiryCutoff } from "../lib/orderExpiry";
import { createOrder, expirePaymentProcessingOrders, updateOrderStatus } from "../repository/order";
import { findOrCreateChatRoom, sendChatMessage } from "../repository/chatroom";
import { openChatFeed, readChatFeed } from "../repository/chatroomSync";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  try {
    for (const [now, expected] of [
      ["2026-10-24T15:58:59.999Z", "2026-10-22T16:00:00.000Z"],
      ["2026-10-24T15:59:59.999Z", "2026-10-22T16:00:00.000Z"],
      ["2026-10-24T16:00:00.000Z", "2026-10-23T16:00:00.000Z"],
      ["2027-01-01T16:00:00.000Z", "2026-12-31T16:00:00.000Z"],
      ["2028-03-01T16:00:00.000Z", "2028-02-29T16:00:00.000Z"],
    ]) {
      assert.equal(paymentProcessingExpiryCutoff(new Date(now)).toISOString(), expected);
    }
    const [buyer] = await db.insert(s.userTable).values({
      email: `${randomUUID()}@example.test`, oauthProvider: "other",
      oauthId: randomUUID(), referralCode: randomUUID(),
    }).returning();
    const [seller] = await db.insert(s.accountTable).values({
      role: "seller", email: `${randomUUID()}@example.test`, password: "unused",
      profileCompletedAt: new Date(), emailVerifiedAt: new Date(),
    }).returning();
    const [product] = await db.insert(s.productTable).values({
      sellerId: seller.id, name: "Order expiry fixture", description: "Fixture",
    }).returning();
    const [variant] = await db.insert(s.productVariantTable).values({
      productId: product.id, price: 100, stock: 10,
    }).returning();
    const room = await findOrCreateChatRoom({
      userId: buyer.id, accountId: seller.id, productId: product.id, productVariantId: variant.id,
    });
    await sendChatMessage({ actor: { kind: "user", id: buyer.id }, chatRoomId: room.id, senderType: "user", content: "Expiry test" });
    const order = (await createOrder({
      orderData: { userId: buyer.id, subTotal: 100, totalAmount: 100 },
      items: [{ productId: product.id, productVariantId: variant.id,
        productNameAtSale: product.name, unitPriceAtSale: 100, quantity: 1 }],
      idempotencyKey: randomUUID(),
    }))!;
    await updateOrderStatus({ orderId: order.id, status: "payment-processing" });
    await db.update(s.orderTable).set({ createdAt: new Date("2026-10-23T11:34:40Z") }).where(eq(s.orderTable.id, order.id));
    const head = await openChatFeed(buyer.id);
    assert.equal((await expirePaymentProcessingOrders(new Date("2026-10-24T15:59:59.999Z"))).length, 0);

    // Midnight starts a different calendar date; paid/failed/pending are excluded.
    const controls = await db.insert(s.orderTable).values([
      { orderStatus: "payment-processing" as const, createdAt: new Date("2026-10-23T16:00:00Z") },
      ...(["paid", "failed", "pending"] as const).map((orderStatus) => ({ orderStatus, createdAt: new Date("2026-10-01T00:00:00Z") })),
    ].map((row) => ({ ...row, userId: buyer.id, subTotal: 100, totalAmount: 100 }))).returning();
    const deadline = new Date("2026-10-24T16:00:00Z");
    const results = await Promise.all([expirePaymentProcessingOrders(deadline), expirePaymentProcessingOrders(deadline)]);
    assert.deepEqual(results.flat().map((row) => row.id), [order.id], "Concurrent workers expire only once");
    const expired = (await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, order.id), with: { items: true } }))!;
    assert.equal(expired.orderStatus, "expired");
    assert.equal(expired.items[0].pendingQuantity, 0);
    const stock = (await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!;
    assert.equal(stock.reserve, 0);
    assert.equal(stock.stock, 10);
    const events = await readChatFeed(buyer.id, head.sequence);
    assert.equal(events.length, 1);
    assert.equal((events[0].payload.room as any).order.orderStatus, "expired");
    for (const control of controls) {
      assert.equal((await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, control.id) }))!.orderStatus, control.orderStatus);
    }
    // Simulate a stale worker candidate after the payment has already committed.
    assert.equal(await updateOrderStatus({ orderId: controls[1].id, status: "expired" }, {
      status: "payment-processing", createdBefore: paymentProcessingExpiryCutoff(deadline),
    }), undefined);
    assert.equal((await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, controls[1].id) }))!.orderStatus, "paid");
    assert.equal((await expirePaymentProcessingOrders(deadline)).length, 0);
    assert.deepEqual((await expirePaymentProcessingOrders(new Date("2026-10-26T00:00:00Z"))).map((row) => row.id), [controls[0].id], "Catch up after downtime");
    console.log("Order expiry: Taiwan calendar boundaries, concurrent workers, paid-order guard, stock release and SSE passed.");
  } finally {
    await client.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
