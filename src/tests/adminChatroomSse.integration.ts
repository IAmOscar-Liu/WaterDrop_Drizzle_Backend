import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { decodeAdminChatCursor, encodeAdminChatCursor } from "../lib/adminChatCursor";
import { adminChatPrincipal, openAdminChatFeed, readAdminChatFeed, pruneAdminChatSyncData, canDeliverAdminChatEvent } from "../repository/adminChatroomSync";
import { findOrCreateChatRoom, sendSyncChatMessage, sendSystemChatMessage } from "../repository/chatroom";
import { appendChatEvent, lockChatFeed, openChatFeed, setChatRoomStatus } from "../repository/chatroomSync";

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
    const response = await fetch(`${baseUrl}/api/admin/chatroom/events`, { signal: controller.signal, headers: { Authorization: `Bearer ${token ?? await fixtureToken({ id })}`, ...(cursor ? { "Last-Event-ID": cursor } : {}) } });
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
    const [user, other] = await db.insert(schema.userTable).values([1, 2].map(() => ({ email: `${randomUUID()}@example.test`, oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID() }))).returning();
    const [admin, seller, foreignSeller] = await db.insert(schema.accountTable).values((["admin", "seller", "seller"] as const).map((role) => ({ profileCompletedAt: new Date(), emailVerifiedAt: new Date(), role, email: `${randomUUID()}@example.test`, password: "unused", realName: "Admin SSE fixture", phone: "0900000000" }))).returning();
    const [group] = await db.insert(schema.accountGroupTable).values({ parentId: seller.id }).returning();
    const [employee] = await db.insert(schema.accountTable).values({ profileCompletedAt: new Date(), emailVerifiedAt: new Date(), role: "employee", accountGroupId: group.id, email: `${randomUUID()}@example.test`, password: "unused", realName: "Employee", phone: "0900000000" }).returning();
    const room = await findOrCreateChatRoom({ userId: user.id, accountId: seller.id });
    const otherRoom = await findOrCreateChatRoom({ userId: other.id, accountId: foreignSeller.id });
    const supportRoom = await findOrCreateChatRoom({ userId: user.id });
    const principal = await adminChatPrincipal(admin.id);
    const fresh = await connect(admin.id), sellerStream = await connect(seller.id);
    const ready = await fresh.next(), sellerReady = await sellerStream.next();
    assert.equal(ready.event, "stream.ready"); assert.equal(ready.id, undefined);
    assert.equal((await request("/admin/chatroom/sync/list?snapshot=true", seller.id)).body.data.total, 0);
    assert.equal((await connect(user.id)).status, 403);
    const created = await request(`/chatroom/sync/message/${room.id}`, user.id, "POST", { senderType: "user", content: "From app on another process", clientMessageId: randomUUID() }, childUrl);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal((await fresh.next()).data.message.id, created.body.data.id);
    const summary = await fresh.next();
    assert.equal(summary.event, "chatroom.updated"); assert.equal(summary.data.room.totalUnread, 1);
    assert.equal(summary.data.room.user.id, user.id); assert.equal(summary.data.listState.totalUnread, 1);
    assert.equal((await sellerStream.next()).event, "message.created");
    assert.equal((await sellerStream.next()).data.room.id, room.id);
    fresh.close(); sellerStream.close();
    await request(`/chatroom/message/${otherRoom.id}`, other.id, "POST", { senderType: "user", content: "Foreign seller" }, childUrl);
    await sendSystemChatMessage({ chatRoomId: supportRoom.id, senderType: "admin", content: "General support" });
    const events = await readAdminChatFeed(principal, decodeAdminChatCursor(summary.id, "feed").sequence);
    assert.ok(events.some((e) => e.chatRoomId === otherRoom.id)); assert.ok(events.some((e) => e.chatRoomId === supportRoom.id));
    const sellerEvents = await readAdminChatFeed(await adminChatPrincipal(seller.id), decodeAdminChatCursor(sellerReady.data.cursor, "feed").sequence);
    assert.ok(sellerEvents.every((e) => e.chatRoomId === room.id));
    assert.equal((await connect(seller.id, summary.id)).status, 403);
    assert.equal((await connect(admin.id, "invalid")).status, 400);
    const replay = await connect(admin.id, summary.id);
    assert.equal((await replay.next()).data.cursor, summary.id);
    assert.equal((await replay.next()).data.chatRoomId, otherRoom.id); replay.close();
    const employeeList = await request("/admin/chatroom/sync/list", employee.id);
    assert.equal(employeeList.status, 200); assert.deepEqual(employeeList.body.data.rooms.map((r: any) => r.id), [room.id]);
    assert.equal((await request(`/admin/chatroom/sync/history/${otherRoom.id}`, employee.id)).status, 404);
    assert.equal((await request(`/admin/chatroom/sync/message/${otherRoom.id}`, seller.id, "POST", { content: "Denied" })).status, 404);
    assert.equal((await request("/admin/chatroom/sync/list?supportOnly=true", seller.id)).status, 403);
    const supportList = await request("/admin/chatroom/sync/list?supportOnly=true", admin.id);
    assert.deepEqual(supportList.body.data.rooms.map((r: any) => r.id), [supportRoom.id]);
    assert.equal((await request("/admin/chatroom/sync/list?status=inactive", admin.id)).status, 400);
    assert.equal((await request("/admin/chatroom/sync/list?snapshot=true&page=2", admin.id)).status, 400);
    const snap = (await request("/admin/chatroom/sync/list?snapshot=true&limit=1", admin.id)).body.data;
    assert.equal(snap.total, 3); assert.ok(snap.listSnapshot);
    const firstRoom = snap.rooms[0].id;
    await request(`/chatroom/sync/message/${room.id}`, user.id, "POST", { senderType: "user", content: "Reorder room", clientMessageId: randomUUID() });
    const frozen = (await request(`/admin/chatroom/sync/list?limit=1&listSnapshot=${snap.listSnapshot}`, admin.id)).body.data;
    assert.equal(frozen.rooms[0].id, firstRoom);
    assert.equal((await request(`/admin/chatroom/sync/list?limit=2&listSnapshot=${snap.listSnapshot}`, admin.id)).status, 400);
    assert.equal((await request(`/admin/chatroom/sync/list?limit=1&listSnapshot=${snap.listSnapshot}`, seller.id)).status, 400);
    const sendInput = { content: "Seller sync response", clientMessageId: randomUUID() };
    const replies = await Promise.all([1, 2].map(() => request(`/admin/chatroom/sync/message/${room.id}`, employee.id, "POST", sendInput)));
    assert.equal(replies[0].status, 200); assert.equal(replies[0].body.data.id, replies[1].body.data.id);
    assert.equal(replies[0].body.data.senderType, "seller"); assert.equal(replies[0].body.data.version, 1);
    assert.equal((await request(`/admin/chatroom/sync/message/${room.id}`, employee.id, "POST", { ...sendInput, content: "Conflict" })).status, 409);
    assert.equal((await request(`/admin/chatroom/sync/message/${room.id}`, employee.id, "POST", { content: "Spoof", senderType: "admin" })).status, 403);
    const history = (await request(`/admin/chatroom/sync/history/${room.id}?limit=1`, admin.id)).body.data;
    assert.ok(history.hasMore); assert.ok(history.nextCursor);
    const older = (await request(`/admin/chatroom/sync/history/${room.id}?limit=1&before=${history.nextCursor}`, seller.id)).body.data;
    assert.notEqual(older.messages[0].id, history.messages[0].id);
    assert.equal((await request(`/admin/chatroom/sync/history/${room.id}?before=${history.nextCursor}&page=1`, admin.id)).status, 400);
    const appMessage = await sendChatMessage({ actor: { kind: "user", id: user.id }, chatRoomId: room.id, senderType: "user", content: "Unread" });
    const read = await request(`/admin/chatroom/sync/message/${room.id}/read`, employee.id, "PUT", {});
    assert.equal(read.status, 200); assert.ok(read.body.data.some((m: any) => m.id === appMessage.id && m.version === 2 && m.isRead));
    const head = (await openAdminChatFeed(principal)).sequence;
    await request(`/admin/chatroom/sync/message/${room.id}/read`, employee.id, "PUT", {});
    assert.equal((await openAdminChatFeed(principal)).sequence, head);
    // A rollback must remove both the app and admin journal writes.
    await assert.rejects(db.transaction(async (tx) => {
      await lockChatFeed(tx, user.id);
      await appendChatEvent(tx, (await tx.query.chatRoomTable.findFirst({ where: eq(schema.chatRoomTable.id, room.id) }))!, "message.created", { message: { content: "rollback" } });
      throw new Error("rollback");
    }), /rollback/);
    assert.equal((await openAdminChatFeed(principal)).sequence, head);
    // Concurrent commits across different users remain contiguous in the admin feed.
    await Promise.all([room, otherRoom].map((r) => sendSystemChatMessage({ chatRoomId: r.id, senderType: "admin", content: "Concurrent" })));
    const concurrent = await readAdminChatFeed(principal, head);
    concurrent.forEach((e, i) => assert.equal(e.sequence, head + i + 1));
    const accessBoundary = await openAdminChatFeed(principal);
    await sendSystemChatMessage({ chatRoomId: room.id, senderType: "admin", content: "Before revoke" });
    const beforeRevoke = await readAdminChatFeed(principal, accessBoundary.sequence);
    await setChatRoomStatus(room.id, "inactive");
    assert.equal(await canDeliverAdminChatEvent(beforeRevoke[0]), false);
    const revoked = await connect(admin.id, accessBoundary.cursor); await revoked.next();
    assert.equal((await revoked.next()).event, "stream.reset"); revoked.close();
    await setChatRoomStatus(room.id, "active");
    assert.equal(await canDeliverAdminChatEvent(beforeRevoke[0]), false);
    // Frozen page boundaries leave holes after revocation, without restoring old access.
    const scopeSnapshot = (await request("/admin/chatroom/sync/list?snapshot=true", seller.id)).body.data;
    await setChatRoomStatus(room.id, "inactive");
    const hole = (await request(`/admin/chatroom/sync/list?listSnapshot=${scopeSnapshot.listSnapshot}`, seller.id)).body.data;
    assert.equal(hole.total, 1); assert.equal(hole.rooms.length, 0);
    await setChatRoomStatus(room.id, "active");
    assert.equal((await request(`/admin/chatroom/sync/list?listSnapshot=${scopeSnapshot.listSnapshot}`, seller.id)).body.data.rooms.length, 0);
    await db.update(schema.adminChatListSnapshotTable).set({ expiresAt: new Date(0) }).where(eq(schema.adminChatListSnapshotTable.accountId, seller.id));
    assert.equal((await request(`/admin/chatroom/sync/list?listSnapshot=${scopeSnapshot.listSnapshot}`, seller.id)).status, 410);
    for (let i = 0; i < 5; i++) assert.equal((await request("/admin/chatroom/sync/list?snapshot=true", seller.id)).status, 200);
    assert.equal((await request("/admin/chatroom/sync/list?snapshot=true", seller.id)).status, 429);
    const quotaStreams = await Promise.all([1, 2, 3].map(() => connect(foreignSeller.id)));
    await Promise.all(quotaStreams.map((stream) => stream.next()));
    assert.equal((await connect(foreignSeller.id)).status, 429);
    quotaStreams.forEach((stream) => stream.close());
    const appCursor = (await openChatFeed(user.id)).cursor;
    assert.equal((await connect(admin.id, appCursor)).status, 400);
    const employeePrincipal = await adminChatPrincipal(employee.id);
    const employeeBoundary = await openAdminChatFeed(employeePrincipal);
    const oldScopeSnapshot = (await request("/admin/chatroom/sync/list?snapshot=true", employee.id)).body.data;
    const reassigned = await connect(employee.id); await reassigned.next();
    await db.update(schema.accountGroupTable).set({ parentId: foreignSeller.id }).where(eq(schema.accountGroupTable.id, group.id));
    assert.equal((await reassigned.next()).event, "stream.reset"); reassigned.close();
    assert.equal((await connect(employee.id, employeeBoundary.cursor)).status, 403);
    assert.equal((await request(`/admin/chatroom/sync/list?listSnapshot=${oldScopeSnapshot.listSnapshot}`, employee.id)).status, 400);
    assert.deepEqual((await request("/admin/chatroom/sync/list", employee.id)).body.data.rooms.map((r: any) => r.id), [otherRoom.id]);
    // Disable/reassignment must close an already connected stream even without new events.
    const employeeStream = await connect(employee.id); await employeeStream.next();
    await db.update(schema.accountTable).set({ status: "inactive" }).where(eq(schema.accountTable.id, employee.id));
    assert.equal((await employeeStream.next()).event, "stream.reset"); employeeStream.close();
    const shortPayload = jwt.decode(await fixtureToken({ id: admin.id })) as jwt.JwtPayload;
    delete shortPayload.exp; delete shortPayload.iat;
    const short = jwt.sign(shortPayload, process.env.JWT_SECRET!, { expiresIn: 2 });
    const expiring = await connect(admin.id, undefined, short); await expiring.next();
    assert.equal((await expiring.next()).data.reason, "auth_expired"); expiring.close();
    const tooLarge = await openAdminChatFeed(principal);
    await sendSystemChatMessage({ chatRoomId: room.id, senderType: "admin", content: "x".repeat(300_000) });
    const oversized = await readAdminChatFeed(principal, tooLarge.sequence);
    assert.equal(oversized[0].eventType, "stream.reset");
    await db.update(schema.adminChatFeedEventTable).set({ createdAt: new Date(Date.now() - 49 * 3600_000) });
    await pruneAdminChatSyncData();
    assert.equal((await connect(admin.id, ready.data.cursor)).status, 410);
    assert.equal((await connect(admin.id, encodeAdminChatCursor({ kind: "feed", principal, sequence: 99999999 }))).status, 400);
    console.log("Admin chat SSE: cross-process live/replay, role scopes, canonical REST, deduplication, snapshots, authorization resets, expiry, retention and atomic publication passed.");
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
