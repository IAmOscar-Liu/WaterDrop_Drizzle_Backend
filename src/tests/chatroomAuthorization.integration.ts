import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import app from "../app";
import * as schema from "../db/schema";
import db, { client } from "../lib/initDB";
import { generateToken } from "../lib/token";
import { sendSystemChatMessage } from "../repository/chatroom";

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
    const users = await db.insert(schema.userTable).values([1, 2].map(() => ({
      email: `${randomUUID()}@example.test`, oauthProvider: "other" as const,
      oauthId: randomUUID(), referralCode: randomUUID(),
    }))).returning();
    const accounts = await db.insert(schema.accountTable).values(
      (["seller", "seller", "admin", "employee"] as const).map((role) => ({
        role, email: `${randomUUID()}@example.test`, password: "unused",
        realName: "Chat auth fixture", phone: "0900000000",
      })),
    ).returning();
    const [seller, otherSeller, admin, employee] = accounts;
    const [group] = await db.insert(schema.accountGroupTable).values({ parentId: seller.id }).returning();
    await db.update(schema.accountTable).set({ accountGroupId: group.id }).where(eq(schema.accountTable.id, employee.id));
    const products = await db.insert(schema.productTable).values([seller, otherSeller].map((owner) => ({
      sellerId: owner.id, name: "Chat auth product", description: "Fixture",
    }))).returning();
    const variants = await db.insert(schema.productVariantTable).values(products.map((product) => ({
      productId: product.id, price: 10, stock: 10,
    }))).returning();
    const orders = await db.insert(schema.orderTable).values(users.map((user) => ({
      userId: user.id, subTotal: 10, totalAmount: 10, orderStatus: "paid" as const,
    }))).returning();
    await db.insert(schema.orderItemTable).values(orders.map((order) => ({
      orderId: order.id, productId: products[0].id, productVariantId: variants[0].id,
      quantity: 1, unitPriceAtSale: 10, lineTotal: 10, productNameAtSale: "Fixture",
    })));
    const [room, otherRoom, support, inactive] = await db.insert(schema.chatRoomTable).values([
      { userId: users[0].id, accountId: seller.id, productId: products[0].id, productVariantId: variants[0].id },
      { userId: users[1].id, accountId: otherSeller.id, productId: products[1].id, productVariantId: variants[1].id },
      { userId: users[0].id },
      { userId: users[1].id, accountId: seller.id, status: "inactive" as const },
    ]).returning();
    await db.insert(schema.chatMessageTable).values([
      { chatRoomId: room.id, senderType: "user", content: "Owner secret" },
      { chatRoomId: room.id, senderType: "seller", content: "Seller secret" },
      { chatRoomId: otherRoom.id, senderType: "user", content: "Other secret" },
      { chatRoomId: support.id, senderType: "user", content: "Support secret" },
      { chatRoomId: inactive.id, senderType: "user", content: "Inactive secret" },
    ]);
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
    const storedMessages = () => db.query.chatMessageTable.findMany({
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    const before = await storedMessages();
    for (const target of [room.id, randomUUID()]) {
      expect(await request(`/api/chatroom/${target}`, users[1].id), 404);
      expect(await request(`/api/chatroom/history/${target}`, users[1].id), 404);
      expect(await request(`/api/chatroom/message/${target}`, users[1].id, "POST", {
        senderType: "user", content: "Unauthorized", attachments: [{ url: "https://example.test/attachment" }],
      }), 404);
      expect(await request(`/api/chatroom/message/${target}/read`, users[1].id, "PUT", { readerType: "user" }), 404);
      expect(await request(`/api/admin/chatroom/history/${target}`, otherSeller.id), 404);
      expect(await request(`/api/admin/chatroom/message/${target}`, otherSeller.id, "POST", { senderType: "seller", content: "Unauthorized" }), 404);
      expect(await request(`/api/admin/chatroom/message/${target}/read`, otherSeller.id, "PUT", { readerType: "seller" }), 404);
    }
    for (const target of [otherRoom.id, support.id]) {
      expect(await request(`/api/admin/chatroom/history/${target}`, employee.id), 404);
    }
    for (const id of [seller.id, employee.id]) {
      expect(await request(`/api/admin/chatroom/message/${room.id}`, id, "POST", { senderType: "admin", content: "Impersonation" }), 403);
      expect(await request(`/api/admin/chatroom/message/${room.id}/read`, id, "PUT", { readerType: "admin" }), 403);
    }
    expect(await request(`/api/chatroom/message/${room.id}`, users[0].id, "POST", { senderType: "seller", content: "Impersonation" }), 400);
    expect(await request(`/api/chatroom/message/${room.id}/read`, users[0].id, "PUT", { readerType: "seller" }), 400);
    expect(await request(`/api/chatroom/history/${room.id}`), 401);
    expect(await request(`/api/chatroom/history/${room.id}`, seller.id), 401);
    expect(await request(`/api/admin/chatroom/history/${room.id}`, users[0].id), 403);
    expect(await request(`/api/chatroom/history/${room.id}`, randomUUID()), 401);
    for (const [prefix, id, role] of [["/api/chatroom", users[1].id, "user"], ["/api/admin/chatroom", admin.id, "admin"]]) {
      expect(await request(`${prefix}/history/${inactive.id}`, id), 404);
      expect(await request(`${prefix}/message/${inactive.id}`, id, "POST", { senderType: role, content: "Inactive" }), 404);
      expect(await request(`${prefix}/message/${inactive.id}/read`, id, "PUT", { readerType: role }), 404);
    }
    assert.deepEqual(await storedMessages(), before, "Denied writes must not insert messages or mark anything read");
    assert.deepEqual(await db.query.chatMessageAttachmentTable.findMany(), []);

    expect(await request(`/api/chatroom/${room.id}`, users[0].id));
    assert.equal(expect(await request(`/api/chatroom/history/${room.id}`, users[0].id)).total, 2);
    for (const id of [seller.id, employee.id, admin.id]) {
      assert.equal(expect(await request(`/api/admin/chatroom/history/${room.id}`, id)).total, 2);
    }
    expect(await request(`/api/admin/chatroom/history/${support.id}`, admin.id));
    expect(await request(`/api/admin/chatroom/history/${otherRoom.id}`, admin.id));
    const list = expect(await request("/api/admin/chatroom/list?status=active", employee.id));
    assert.deepEqual(list.rooms.map((entry: any) => entry.id), [room.id]);
    const ownerList = expect(await request("/api/chatroom/list", users[0].id));
    assert.deepEqual(new Set(ownerList.rooms.map((entry: any) => entry.id)), new Set([room.id, support.id]));
    const sent = expect(await request(`/api/chatroom/message/${room.id}`, users[0].id, "POST", {
      senderType: "user", content: "Allowed", attachments: [{ url: "https://example.test/allowed" }],
    }));
    assert.equal(sent.senderType, "user");
    assert.equal(sent.attachments.length, 1);
    const read = expect(await request(`/api/admin/chatroom/message/${room.id}/read`, employee.id, "PUT", { readerType: "seller" }));
    assert.ok(read.some((message: any) => message.id === sent.id && message.isRead));
    assert.equal(expect(await request(`/api/admin/chatroom/message/${room.id}`, employee.id, "POST", { senderType: "seller", content: "Employee reply" })).senderType, "seller");
    assert.equal(expect(await request(`/api/admin/chatroom/message/${support.id}`, admin.id, "POST", { senderType: "admin", content: "Support reply" })).senderType, "admin");
    expect(await request(`/api/chatroom/message/${room.id}/read`, users[0].id, "PUT", { readerType: "user" }));

    const roomBefore = await db.query.chatRoomTable.findFirst({ where: eq(schema.chatRoomTable.id, room.id) });
    const create = (body: unknown) => request("/api/chatroom/create", users[0].id, "POST", body);
    const productBody = { productId: products[0].id, productVariantId: variants[0].id };
    expect(await create({ ...productBody, accountId: otherSeller.id }), 400);
    expect(await create({ ...productBody, productVariantId: variants[1].id }), 404);
    expect(await create({ ...productBody, orderId: orders[1].id }), 404);
    expect(await create({ orderId: orders[1].id }), 404);
    expect(await create({ productId: products[1].id, productVariantId: variants[1].id, orderId: orders[0].id }), 400);
    expect(await create({ accountId: otherSeller.id, orderId: orders[0].id }), 400);
    expect(await create({ accountId: randomUUID() }), 404);
    expect(await create({ accountId: employee.id }), 404);
    assert.deepEqual(await db.query.chatRoomTable.findFirst({ where: eq(schema.chatRoomTable.id, room.id) }), roomBefore);
    const associated = expect(await create({ ...productBody, orderId: orders[0].id }));
    assert.equal(associated.accountId, seller.id);
    assert.equal(associated.orderId, orders[0].id);
    assert.equal(associated.id, room.id);
    expect(await create({}));
    await db.update(schema.accountTable).set({ status: "inactive" }).where(eq(schema.accountTable.id, seller.id));
    expect(await create(productBody), 404);
    expect(await request(`/api/admin/chatroom/history/${room.id}`, seller.id), 403);
    expect(await request(`/api/admin/chatroom/history/${room.id}`, employee.id), 403);
    await db.update(schema.accountTable).set({ status: "active" }).where(eq(schema.accountTable.id, seller.id));
    const systemMessage = await sendSystemChatMessage({ chatRoomId: room.id, senderType: "seller", content: "Refund automation" });
    assert.equal(systemMessage?.content, "Refund automation");
    console.log("Chatroom authorization integration tests passed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await client.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
