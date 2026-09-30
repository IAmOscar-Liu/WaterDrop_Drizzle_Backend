import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import app from "../app";
import * as schema from "../db/schema";
import db, { client } from "../lib/initDB";
import { generateToken } from "../lib/token";
import { createRefundWithChatContext, updateRefundItemStatus } from "../repository/refund";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  assert.equal(process.env.NO_CRON, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const [user, otherUser] = await db.insert(schema.userTable).values([1, 2].map(() => ({
      email: `${randomUUID()}@example.test`, oauthProvider: "other" as const,
      oauthId: randomUUID(), referralCode: randomUUID(),
    }))).returning();
    const [seller, otherSeller, admin, employee] = await db.insert(schema.accountTable).values(
      (["seller", "seller", "admin", "employee"] as const).map((role) => ({
        role, email: `${randomUUID()}@example.test`, password: "unused",
        realName: "Refund authorization fixture", phone: "0900000000",
      })),
    ).returning();
    const [group] = await db.insert(schema.accountGroupTable).values({ parentId: seller.id }).returning();
    await db.update(schema.accountTable).set({ accountGroupId: group.id }).where(eq(schema.accountTable.id, employee.id));
    const products = await db.insert(schema.productTable).values([seller, otherSeller].map((owner) => ({
      sellerId: owner.id, name: "Refund fixture", description: "Test only",
    }))).returning();
    const variants = await db.insert(schema.productVariantTable).values(products.map((product) => ({
      productId: product.id, price: 10, stock: 10,
    }))).returning();
    const [order] = await db.insert(schema.orderTable).values({
      userId: user.id, subTotal: 200, totalAmount: 200, orderStatus: "paid", discountCoin: 0,
    }).returning();
    const [delivery] = await db.insert(schema.deliveryTable).values({
      orderId: order.id, LogisticsType: "virtual", GoodsAmount: 200, status: "delivered",
    }).returning();
    // Both sellers are in the same order; authorization must use each product.
    const items = await db.insert(schema.orderItemTable).values(products.map((product, index) => ({
      orderId: order.id, productId: product.id, productVariantId: variants[index].id,
      deliveryId: delivery.id, quantity: 10, unitPriceAtSale: 10, lineTotal: 100,
      productNameAtSale: product.name,
    }))).returning();
    const refunds = await db.insert(schema.refundItemTable).values(items.map((item) => ({
      orderItemId: item.id, quantity: 1, reason: "Existing request", refundAmount: 10,
      paidRefundAmount: 10, cashRefundAmount: 10, cashRemainderCoins: 0, coins: 0,
    }))).returning();
    const refund = refunds[0];
    async function request(path: string, id?: string, method = "GET", body?: unknown) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(id ? { authorization: `Bearer ${generateToken({ id })}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as any };
    }
    function expect(result: Awaited<ReturnType<typeof request>>, status = 200) {
      assert.equal(result.status, status, JSON.stringify(result.body));
      assert.equal(result.body.success, status === 200);
      return result.body.data;
    }
    async function state() {
      return {
        refunds: await db.query.refundItemTable.findMany({ orderBy: (t, { asc }) => [asc(t.id)] }),
        logs: await db.query.refundLogTable.findMany(),
        variants: await db.query.productVariantTable.findMany({ orderBy: (t, { asc }) => [asc(t.id)] }),
        users: await db.query.userTable.findMany({ orderBy: (t, { asc }) => [asc(t.id)] }),
        coinTransactions: await db.query.userCoinTransactionTable.findMany(),
        messages: await db.query.chatMessageTable.findMany(),
        activities: await db.query.adminActivityEventTable.findMany(),
      };
    }
    const before = await state();
    const createBody = { orderItemId: items[0].id, quantity: 1, reason: "Authorization test" };
    for (const [id, status] of [[otherSeller.id, 404], [employee.id, 403]] as const) {
      expect(await request("/api/admin/refund", id, "POST", {
        ...createBody, accountId: admin.id, userId: user.id, actor: { kind: "account", id: admin.id },
      }), status);
      for (const patch of [
        { status: "pending" }, // No-op must still authorize.
        { status: "processing" },
        { status: "completed" },
        { status: "cancelled" },
        { quantity: 2, refundAmount: 5, extraRefundAmount: 1 },
        { note: "Unauthorized", message: "Unauthorized log", metadata: { unauthorized: true } },
      ]) {
        expect(await request(`/api/admin/refund/${refund.id}/status`, id, "PATCH", {
          ...patch, actorAccountId: admin.id,
        }), status);
      }
    }
    expect(await request(`/api/admin/refund/${refund.id}`, otherSeller.id), 404);
    expect(await request("/api/admin/refund", user.id, "POST", createBody), 403);
    expect(await request(`/api/admin/refund/${refund.id}/status`, user.id, "PATCH", { status: "completed" }), 403);
    expect(await request("/api/admin/refund", undefined, "POST", createBody), 401);
    expect(await request("/api/refund", otherUser.id, "POST", { ...createBody, accountId: seller.id }), 400);
    expect(await request("/api/refund", user.id, "POST", { ...createBody, accountId: otherSeller.id }), 400);
    // Check the repository boundary as well as HTTP middleware.
    await assert.rejects(updateRefundItemStatus(refund.id, { status: "pending" }, ""), /Unauthorized/);
    await assert.rejects(createRefundWithChatContext({
      ...createBody, actor: { kind: "account", id: employee.id },
    }), /Only admins and sellers/);
    assert.deepEqual(await state(), before, "Denied writes must leave refund, log, stock, coin and chat state unchanged");

    // Readers keep their existing seller scope; employees have no write access.
    expect(await request(`/api/admin/refund/${refund.id}`, seller.id));
    expect(await request(`/api/admin/refund/${refund.id}`, employee.id));
    expect(await request(`/api/admin/refund/${refund.id}`, admin.id));
    expect(await request(`/api/admin/refund/${refunds[1].id}`, employee.id), 404);
    const sellerList = expect(await request("/api/admin/refund/list", seller.id));
    assert.equal(sellerList.total, 1);
    const adminList = expect(await request("/api/admin/refund/list", admin.id));
    assert.equal(adminList.total, 2);
    // A different line of the same order belongs to the other seller.
    expect(await request(`/api/admin/refund/${refunds[1].id}/status`, seller.id, "PATCH", { status: "completed" }), 404);

    expect(await request(`/api/admin/refund/${refund.id}/status`, seller.id, "PATCH", { status: "processing" }));
    const completed = expect(await request(`/api/admin/refund/${refund.id}/status`, seller.id, "PATCH", { status: "completed" }));
    assert.equal(completed.status, "completed");
    const variantAfter = await db.query.productVariantTable.findFirst({ where: eq(schema.productVariantTable.id, variants[0].id) });
    assert.equal(variantAfter?.stock, 11);
    // Repeat completion cannot apply stock return twice.
    expect(await request(`/api/admin/refund/${refund.id}/status`, seller.id, "PATCH", { status: "completed" }));
    assert.equal((await db.query.productVariantTable.findFirst({ where: eq(schema.productVariantTable.id, variants[0].id) }))?.stock, 11);
    expect(await request(`/api/admin/refund/${refunds[1].id}/status`, admin.id, "PATCH", { status: "completed" }));

    const createdSeller = expect(await request("/api/admin/refund", seller.id, "POST", { ...createBody, reason: "seller-created" }));
    const createdAdmin = expect(await request("/api/admin/refund", admin.id, "POST", { ...createBody, reason: "admin-created" }));
    const createdUser = expect(await request("/api/refund", user.id, "POST", {
      ...createBody, accountId: seller.id, reason: "user-requested", status: "completed",
    }));
    assert.equal(createdSeller.status, "pending");
    assert.equal(createdAdmin.status, "pending");
    assert.equal(createdUser.status, "pending");
    // These follow-up writes are asynchronous. Verify actual messages, not just successful POSTs.
    let chatMessages: schema.ChatMessage[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const room = await db.query.chatRoomTable.findFirst({
        where: eq(schema.chatRoomTable.orderId, order.id), with: { messages: true },
      });
      if (room) {
        assert.equal(room.accountId, seller.id);
        assert.equal(room.userId, user.id);
        chatMessages = room.messages;
        if (["seller-created", "admin-created", "user-requested"].every((reason) => chatMessages.some((message) => message.content?.includes(reason)))) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for (const [reason, role] of [["seller-created", "seller"], ["admin-created", "admin"], ["user-requested", "user"]]) {
      assert.ok(chatMessages.some((message) => message.content?.includes(reason) && message.senderType === role), `Missing ${reason} chat message`);
    }
    for (const change of [{ status: "inactive" as const }, { status: "active" as const, deletedAt: new Date() }]) {
      await db.update(schema.accountTable).set(change).where(eq(schema.accountTable.id, seller.id));
      expect(await request("/api/admin/refund", seller.id, "POST", createBody), 403);
      expect(await request(`/api/admin/refund/${createdSeller.id}/status`, seller.id, "PATCH", { status: "completed" }), 403);
    }
    console.log("Refund authorization integration tests passed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await client.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
