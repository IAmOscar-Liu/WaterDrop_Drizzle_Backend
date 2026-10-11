import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { generateToken } from "../lib/token";
import { sendChatMessage } from "../repository/chatroom";
import { openChatFeed, readChatFeed } from "../repository/chatroomSync";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, id: string, method = "GET", body?: unknown) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method, headers: { Authorization: `Bearer ${generateToken({ id })}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() as any : undefined };
  }
  function keys(value: object, expected: string[]) { assert.deepEqual(Object.keys(value).sort(), expected.sort()); }
  const messageKeys = ["id", "chatRoomId", "senderType", "content", "isRead", "createdAt", "updatedAt"];
  const roomKeys = ["id", "userId", "accountId", "productId", "productVariantId", "orderId", "status", "createdAt", "updatedAt"];
  const pageKeys = ["total", "page", "limit", "totalPages"];
  try {
    const [user] = await db.insert(schema.userTable).values({ email: `${randomUUID()}@example.test`, oauthProvider: "other", oauthId: randomUUID(), referralCode: randomUUID() }).returning();
    const [seller, admin] = await db.insert(schema.accountTable).values((["seller", "admin"] as const).map((role) => ({ role, email: `${randomUUID()}@example.test`, password: "unused", realName: "Legacy compatibility", phone: "0900000000" }))).returning();
    const created = await request("/chatroom/create", user.id, "POST", { accountId: seller.id });
    assert.equal(created.status, 200); const room = created.body.data; keys(room, [...roomKeys]);
    const detail = await request(`/chatroom/${room.id}`, user.id); keys(detail.body.data, [...roomKeys, "product", "variant"]);
    const key = randomUUID();
    const body = { senderType: "user", content: "Legacy send", clientMessageId: key };
    const first = await request(`/chatroom/message/${room.id}`, user.id, "POST", body);
    const second = await request(`/chatroom/message/${room.id}`, user.id, "POST", body);
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    keys(first.body.data, [...messageKeys, "attachments"]);
    assert.notEqual(first.body.data.id, second.body.data.id, "Legacy sends must not acquire deduplication");
    const afterSend = await request(`/chatroom/${room.id}`, user.id);
    assert.equal(afterSend.body.data.updatedAt, room.updatedAt, "Internal feed revisions must not change the legacy room timestamp");
    for (const [prefix, id] of [["/chatroom", user.id], ["/admin/chatroom", seller.id]] as const) {
      const history = await request(`${prefix}/history/${room.id}?page=1&limit=9999&before=ignored-legacy-parameter`, id);
      assert.equal(history.status, 200); keys(history.body.data, ["messages", ...pageKeys]);
      assert.equal(history.body.data.messages.length, 2);
      history.body.data.messages.forEach((message: object) => keys(message, [...messageKeys, "attachments"]));
      const list = await request(`${prefix}/list?snapshot=true&listSnapshot=ignored-legacy-parameter`, id);
      assert.equal(list.status, 200); keys(list.body.data, ["rooms", ...pageKeys]);
      const listed = list.body.data.rooms.find((value: any) => value.id === room.id);
      keys(listed, [...roomKeys, "product", "order", "totalUnread", "lastMessage", ...(prefix.includes("admin") ? ["user"] : [])]);
      keys(listed.lastMessage, [...messageKeys, "attachments"]);
    }
    const adminBody = { senderType: "admin", content: "Admin reply", clientMessageId: randomUUID() };
    const reply1 = await request(`/admin/chatroom/message/${room.id}`, admin.id, "POST", adminBody);
    const reply2 = await request(`/admin/chatroom/message/${room.id}`, admin.id, "POST", adminBody);
    keys(reply1.body.data, [...messageKeys, "attachments"]);
    assert.notEqual(reply1.body.data.id, reply2.body.data.id, "Admin sends must not acquire deduplication");
    const beforeRead = await openChatFeed(user.id);
    const read = await request(`/admin/chatroom/message/${room.id}/read`, seller.id, "PUT", { readerType: "seller" });
    assert.equal(read.status, 200); assert.equal(read.body.data.length, 2, "Seller retains the original ability to read admin messages");
    read.body.data.forEach((message: object) => keys(message, [...messageKeys]));
    const events = await readChatFeed(user.id, beforeRead.sequence);
    assert.equal(events[0].eventType, "messages.read");
    assert.equal((events[0].payload.messages as any[])[0].version, 2);

    // Only the new app namespace supports retries, versions and cursor/snapshot metadata.
    const syncBody = { senderType: "user", content: "Sync send", clientMessageId: randomUUID() };
    const sync1 = await request(`/chatroom/sync/message/${room.id}`, user.id, "POST", syncBody);
    const sync2 = await request(`/chatroom/sync/message/${room.id}`, user.id, "POST", syncBody);
    assert.equal(sync1.status, 200); assert.equal(sync1.body.data.id, sync2.body.data.id);
    keys(sync1.body.data, [...messageKeys, "attachments", "version", "clientMessageId"]);
    const syncHistory = await request(`/chatroom/sync/history/${room.id}?limit=1`, user.id);
    assert.equal(syncHistory.status, 200); assert.equal(syncHistory.body.data.hasMore, true); assert.ok(syncHistory.body.data.nextCursor);
    const syncList = await request("/chatroom/sync/list?snapshot=true", user.id);
    assert.equal(syncList.status, 200); assert.ok(syncList.body.data.listSnapshot); assert.ok(syncList.body.data.listState);
    const syncRead = await request(`/chatroom/sync/message/${room.id}/read`, user.id, "PUT", { readerType: "user" });
    assert.equal(syncRead.status, 200);
    assert.equal((await request(`/chatroom/sync/history/${room.id}`, seller.id)).status, 401);
    assert.equal((await request("/chatroom/events", seller.id)).status, 401);
    assert.equal((await request("/admin/chatroom/sync/list", admin.id)).status, 200);
    assert.equal((await request("/admin/chatroom/events", user.id)).status, 403);

    // Large legacy messages still commit; SSE uses a bounded reset marker instead of
    // introducing a new size rejection to the existing write contract.
    const largeBoundary = await openChatFeed(user.id);
    const large = await sendChatMessage({ actor: { kind: "user", id: user.id }, chatRoomId: room.id, senderType: "user", content: "x".repeat(300_000) });
    assert.equal(large.content?.length, 300_000);
    const largeEvents = await readChatFeed(user.id, largeBoundary.sequence);
    assert.equal(largeEvents[0].eventType, "stream.reset");
    assert.ok(JSON.stringify(largeEvents[0].payload).length < 1024);
    console.log("Legacy app/admin contracts preserved: exact response keys, original read behavior/pagination, no new deduplication, app-only sync routes and bounded oversized-event fallback.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await client.end();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
