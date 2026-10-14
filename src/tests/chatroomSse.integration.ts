import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { and, eq, sql } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { decodeChatCursor, encodeChatCursor } from "../lib/chatCursor";
import { findOrCreateChatRoom, getSyncChatHistory as getChatHistory, listSyncChatRooms as listChatRooms, markMessagesAsRead, markSyncMessagesAsRead, sendChatMessage as sendLegacyChatMessage, sendSyncChatMessage, sendSystemChatMessage } from "../repository/chatroom";
import { appendChatEvent, lockChatFeed, openChatFeed, pruneChatSyncData, readChatFeed, setChatRoomStatus } from "../repository/chatroomSync";

const sendChatMessage = async (input: Parameters<typeof sendSyncChatMessage>[0]) => (await sendSyncChatMessage(input)).message;

const controllers: AbortController[] = [];
async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  assert.equal(process.env.NO_CRON, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (process.argv.includes("--stream-child")) {
    process.send?.({ baseUrl });
    process.once("message", async () => { server.closeAllConnections(); server.close(); await client.end(); process.exit(0); });
    return;
  }
  const child = fork(__filename, ["--stream-child"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const childUrl = await new Promise<string>((resolve, reject) => {
    child.once("message", (message: any) => resolve(message.baseUrl));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Child exited early: ${code}`)));
  });
  const request = async (path: string, id: string, method = "GET", body?: unknown, host = baseUrl) => {
    const response = await fetch(`${host}/api${path}`, { method, headers: { Authorization: `Bearer ${await fixtureToken({ id })}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const connect = async (id: string, cursor?: string, token?: string) => {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${baseUrl}/api/chatroom/events`, { signal: controller.signal, headers: { Authorization: `Bearer ${token ?? await fixtureToken({ id })}`, ...(cursor ? { "Last-Event-ID": cursor } : {}) } });
    if (response.status !== 200) return { status: response.status, error: await response.json() as any, close: () => controller.abort(), next: async (): Promise<any> => { throw new Error("Not a stream"); } };
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder(); let buffer = "";
    const nextFrame = async (): Promise<any> => {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
          if (!event) continue;
          const id = block.split("\n").find((line) => line.startsWith("id: "))?.slice(4);
          const data = JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
          return { event, id, data };
        }
        const part = await reader.read();
        if (part.done) throw new Error("Stream ended before expected frame");
        buffer += decoder.decode(part.value, { stream: true });
      }
    };
    return { status: 200, error: undefined, close: () => controller.abort(), next: async () => {
      let timer: NodeJS.Timeout | undefined;
      try { return await Promise.race([nextFrame(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("SSE event timeout")); }, 8000); })]); }
      finally { clearTimeout(timer); }
    } };
  };
  try {
    const users = await db.insert(schema.userTable).values([1, 2, 3].map(() => ({ email: `${randomUUID()}@example.test`, oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID() }))).returning();
    const [user, other, historyUser] = users;
    const [seller, admin] = await db.insert(schema.accountTable).values((["seller", "admin"] as const).map((role) => ({ profileCompletedAt: new Date(), role, email: `${randomUUID()}@example.test`, password: "unused", realName: "SSE fixture", phone: "0900000000" }))).returning();
    const actor = { kind: "user" as const, id: user.id };
    const room = await findOrCreateChatRoom({ userId: user.id, accountId: seller.id });
    const empty = await findOrCreateChatRoom({ userId: user.id });
    assert.equal((await listChatRooms({ userId: user.id, snapshot: true })).total, 0);
    assert.equal((await listChatRooms({ userId: user.id })).total, 0);
    const fresh = await connect(user.id);
    const ready = await fresh.next();
    assert.equal(ready.event, "stream.ready"); assert.equal(ready.id, undefined);
    const start = decodeChatCursor(ready.data.cursor, "feed").sequence;
    const clientMessageId = randomUUID();
    const input = { actor, chatRoomId: room.id, senderType: "user" as const, content: "你好 👋", clientMessageId, attachments: [{ url: "https://example.test/photo.jpg", name: "相片" }] };
    const duplicate = await Promise.all([sendChatMessage(input), sendChatMessage(input)]);
    assert.equal(duplicate[0].id, duplicate[1].id);
    assert.equal(duplicate[0].clientMessageId, clientMessageId);
    assert.equal(duplicate[0].version, 1);
    assert.equal("senderIdentity" in duplicate[0], false);
    const created = await fresh.next();
    assert.equal(created.event, "message.created"); assert.equal(created.data.message.content, "你好 👋");
    const summary = await fresh.next(); assert.equal(summary.event, "chatroom.updated");
    assert.equal(summary.data.room.listVisible, true); assert.equal(summary.data.listState.totalRooms, 1);
    assert.equal((await readChatFeed(user.id, start)).length, 2);
    await assert.rejects(sendChatMessage({ ...input, content: "different" }), (error: any) => error.code === "CLIENT_MESSAGE_ID_CONFLICT");
    await sendChatMessage({ ...input, attachments: [{ url: "https://example.test/photo.jpg", name: "相片", size: null, mimeType: null }] });
    assert.equal((await readChatFeed(user.id, start)).length, 2);

    // A second API process commits; the first process's stream reads the shared journal.
    const reply = await request(`/admin/chatroom/message/${room.id}`, seller.id, "POST", { senderType: "seller", content: "From second process", clientMessageId: randomUUID() }, childUrl);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal((await fresh.next()).event, "message.created");
    const read = await fresh.next(); assert.equal(read.event, "messages.read");
    assert.deepEqual(read.data.messages, [{ id: duplicate[0].id, version: 2, isRead: true }]);
    await fresh.next();
    const retried = await sendChatMessage(input); assert.equal(retried.version, 2); assert.equal(retried.isRead, true);
    fresh.close();
    const replay = await connect(user.id, summary.id);
    const replayReady = await replay.next(); assert.equal(replayReady.data.cursor, summary.id);
    assert.equal((await replay.next()).event, "message.created"); replay.close();
    assert.equal((await connect(other.id, summary.id)).status, 403);
    const malformed = await connect(user.id, "broken"); assert.equal(malformed.status, 400); assert.equal(malformed.error.code, "CHAT_STREAM_CURSOR_INVALID");

    // Existing admin read/send behavior is unchanged: other support roles are read too.
    const adminMessage = await sendLegacyChatMessage({ actor: { kind: "account", id: admin.id }, chatRoomId: room.id, senderType: "admin", content: "Support" });
    const supportReads = await markMessagesAsRead(room.id, "seller", { kind: "account", id: seller.id });
    assert.equal(supportReads.length, 1); assert.equal(supportReads[0].id, adminMessage.id);
    assert.equal("version" in supportReads[0], false);
    const beforeNoop = await openChatFeed(user.id);
    assert.equal((await markMessagesAsRead(room.id, "seller", { kind: "account", id: seller.id })).length, 0);
    assert.equal((await openChatFeed(user.id)).sequence, beforeNoop.sequence);
    const unreadSupport = await sendLegacyChatMessage({ actor: { kind: "account", id: admin.id }, chatRoomId: room.id, senderType: "admin", content: "Unread support" });
    const reads = await markSyncMessagesAsRead(room.id, actor);
    assert.equal(reads.length, 1); assert.equal(reads[0].id, unreadSupport.id); assert.equal(reads[0].version, 2);
    const afterRead = await openChatFeed(user.id);
    await markSyncMessagesAsRead(room.id, actor);
    assert.equal((await openChatFeed(user.id)).sequence, afterRead.sequence);
    const readHistory = await getChatHistory({ actor, chatRoomId: room.id });
    assert.ok(readHistory.messages.every((message) => message.isRead));
    assert.equal(readHistory.messages.find((message) => message.id === adminMessage.id)?.version, 2);

    // Empty rooms join automatically when their first message is written by automation.
    const system = await sendSystemChatMessage({ chatRoomId: empty.id, senderType: "admin", content: "Refund automation" });
    assert.ok(system);
    const firstSnapshot = await listChatRooms({ userId: user.id, limit: 1, snapshot: true });
    assert.ok("listSnapshot" in firstSnapshot);
    if (!("listSnapshot" in firstSnapshot) || typeof firstSnapshot.listSnapshot !== "string") throw new Error("Missing snapshot");
    const snapshotToken = firstSnapshot.listSnapshot;
    const firstRoomId = firstSnapshot.rooms[0].id;
    const secondBefore = await listChatRooms({ userId: user.id, limit: 1, page: 2, listSnapshot: snapshotToken });
    const secondRoomId = secondBefore.rooms[0].id;
    await sendSystemChatMessage({ chatRoomId: secondRoomId, senderType: "admin", content: "Move second room to top" });
    const secondAfter = await listChatRooms({ userId: user.id, limit: 1, page: 2, listSnapshot: snapshotToken });
    assert.equal(secondAfter.rooms[0].id, secondRoomId); assert.notEqual(secondRoomId, firstRoomId);
    await assert.rejects(listChatRooms({ userId: other.id, limit: 1, listSnapshot: snapshotToken }), (error: any) => error.code === "CHATROOM_LIST_SNAPSHOT_INVALID");
    await assert.rejects(listChatRooms({ userId: user.id, limit: 2, listSnapshot: snapshotToken }), (error: any) => error.code === "CHATROOM_LIST_SNAPSHOT_INVALID");
    const beforeRemoval = await openChatFeed(user.id);
    await setChatRoomStatus(secondRoomId, "inactive");
    const removals = await readChatFeed(user.id, beforeRemoval.sequence); assert.equal(removals[0].eventType, "chatroom.removed");
    assert.equal((await listChatRooms({ userId: user.id, limit: 1, page: 2, listSnapshot: snapshotToken })).rooms.length, 0);
    await assert.rejects(readChatFeed(user.id, start), (error: any) => error.code === "CHAT_STREAM_ACCESS_CHANGED");
    await setChatRoomStatus(secondRoomId, "active");
    assert.equal((await listChatRooms({ userId: user.id, limit: 1, page: 2, listSnapshot: snapshotToken })).rooms.length, 0);
    const snap = decodeChatCursor(snapshotToken, "list");
    await db.update(schema.chatListSnapshotTable).set({ expiresAt: new Date(0) }).where(eq(schema.chatListSnapshotTable.id, snap.id));
    await assert.rejects(listChatRooms({ userId: user.id, limit: 1, listSnapshot: snapshotToken }), (error: any) => error.code === "CHATROOM_LIST_SNAPSHOT_EXPIRED");

    // Preserve PostgreSQL microseconds and ID tie-breaker through every older page.
    const historyRoom = await findOrCreateChatRoom({ userId: historyUser.id });
    const fixtures = await db.insert(schema.chatMessageTable).values(Array.from({ length: 43 }, (_, index) => ({ chatRoomId: historyRoom.id, senderType: "user" as const, content: String(index) }))).returning();
    await db.execute(sql`update ${schema.chatMessageTable} set created_at = '2026-10-01T00:00:00.123456Z'::timestamptz where chat_room_id = ${historyRoom.id}`);
    await db.execute(sql`update ${schema.chatMessageTable} set created_at = '2026-10-01T00:00:00.123455Z'::timestamptz where id = ${fixtures[0].id}`);
    const historyActor = { kind: "user" as const, id: historyUser.id };
    const ids: string[] = []; let before: string | undefined;
    do {
      const page = await getChatHistory({ actor: historyActor, chatRoomId: historyRoom.id, limit: 20, before });
      ids.push(...page.messages.map((message) => message.id)); before = page.nextCursor ?? undefined;
      if (page.hasMore) assert.ok(before);
    } while (before);
    assert.equal(ids.length, 43); assert.equal(new Set(ids).size, 43); assert.equal(ids[42], fixtures[0].id);
    assert.equal((await getChatHistory({ actor: historyActor, chatRoomId: historyRoom.id, limit: 9999 })).messages.length, 43);
    const page = await getChatHistory({ actor: historyActor, chatRoomId: historyRoom.id, limit: 20 });
    const mixed = await request(`/chatroom/sync/history/${historyRoom.id}?page=1&before=${encodeURIComponent(page.nextCursor!)}`, historyUser.id);
    assert.equal(mixed.status, 400); assert.equal(mixed.body.code, "CHAT_HISTORY_CURSOR_INVALID");
    await assert.rejects(getChatHistory({ actor, chatRoomId: room.id, before: page.nextCursor! }), (error: any) => error.code === "CHAT_HISTORY_CURSOR_INVALID");
    const historyForeign = await request(`/chatroom/sync/history/${historyRoom.id}`, user.id); assert.equal(historyForeign.status, 404);

    const largeHistoryRoom = await findOrCreateChatRoom({ userId: historyUser.id, accountId: seller.id });
    await db.execute(sql`insert into chat_messages (chat_room_id, sender_type, content, created_at) select ${largeHistoryRoom.id}::uuid, 'user', n::text, '2026-10-01T00:00:00.123456Z'::timestamptz from generate_series(1, 10001) n`);
    const largePage = await getChatHistory({ actor: historyActor, chatRoomId: largeHistoryRoom.id, limit: 9999 });
    assert.equal(largePage.messages.length, 9999); assert.equal(largePage.hasMore, true);
    const largeTail = await getChatHistory({ actor: historyActor, chatRoomId: largeHistoryRoom.id, limit: 20, before: largePage.nextCursor! });
    assert.equal(largeTail.messages.length, 2); assert.equal(largeTail.hasMore, false);
    assert.equal(new Set([...largePage.messages, ...largeTail.messages].map((message) => message.id)).size, 10001);

    // Rollback cannot leave either the message or its journal entry/head.
    const head = await openChatFeed(user.id);
    const rolledBackId = randomUUID();
    await assert.rejects(db.transaction(async (tx) => {
      await lockChatFeed(tx, user.id);
      const [message] = await tx.insert(schema.chatMessageTable).values({ id: rolledBackId, chatRoomId: room.id, senderType: "user", content: "rollback" }).returning();
      const storedRoom = (await tx.query.chatRoomTable.findFirst({ where: eq(schema.chatRoomTable.id, room.id) }))!;
      await appendChatEvent(tx, storedRoom, "message.created", { message });
      throw new Error("rollback fixture");
    }));
    assert.equal((await openChatFeed(user.id)).sequence, head.sequence);
    assert.equal(await db.query.chatMessageTable.findFirst({ where: eq(schema.chatMessageTable.id, rolledBackId) }), undefined);
    await db.update(schema.chatFeedEventTable).set({ createdAt: new Date(Date.now() - 49 * 60 * 60_000) }).where(eq(schema.chatFeedEventTable.userId, user.id));
    await pruneChatSyncData();
    await assert.rejects(openChatFeed(user.id, summary.id), (error: any) => error.code === "CHAT_STREAM_CURSOR_EXPIRED");
    // Deduplication survives event pruning.
    assert.equal((await sendChatMessage(input)).id, duplicate[0].id);
    assert.equal((await openChatFeed(user.id)).sequence, head.sequence);
    const retained = encodeChatCursor({ kind: "feed", userId: user.id, sequence: head.sequence });
    assert.equal((await openChatFeed(user.id, retained)).sequence, head.sequence);

    // Replay crosses multiple batches and transitions to a concurrently extended live feed.
    for (let index = 0; index < 21; index++) await sendSystemChatMessage({ chatRoomId: room.id, senderType: "admin", content: `Replay batch ${index}` });
    const batched = await connect(user.id, retained); await batched.next();
    const firstBatchFrame = await batched.next();
    assert.equal(decodeChatCursor(firstBatchFrame.id, "feed").sequence, head.sequence + 1);
    await sendSystemChatMessage({ chatRoomId: room.id, senderType: "admin", content: "Arrived during replay" });
    for (let offset = 2; offset <= 44; offset++) assert.equal(decodeChatCursor((await batched.next()).id, "feed").sequence, head.sequence + offset);
    batched.close();

    // Stream closes on JWT expiry, independently of events.
    const shortToken = jwt.sign({ data: { id: other.id } }, process.env.JWT_SECRET!, { expiresIn: 2 });
    const expiring = await connect(other.id, undefined, shortToken); await expiring.next();
    const reset = await expiring.next(); assert.equal(reset.event, "stream.reset"); assert.equal(reset.data.reason, "auth_expired"); expiring.close();
    const streams = await Promise.all([connect(other.id), connect(other.id), connect(other.id)]);
    assert.ok(streams.every((stream) => stream.status === 200));
    assert.equal((await connect(other.id)).status, 429); streams.forEach((stream) => stream.close());
    console.log("Chat SSE integration passed: two processes, replay, deduplication, legacy read semantics, app-only sync routes, hidden empty rooms, snapshots, access changes, precision history, retention, rollback, token expiry and limits.");
  } finally {
    controllers.forEach((controller) => controller.abort());
    child.send("stop");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await client.end();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
