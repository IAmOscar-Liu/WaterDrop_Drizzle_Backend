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
import { encodeChatCursor } from "../lib/chatCursor";
import { decodeNotificationCursor, encodeNotificationCursor } from "../lib/notificationCursor";
import { createNotification } from "../repository/notification";
import { createNotificationRecord, getSyncNotification, getSyncNotificationStats, listSyncNotifications, mutateNotifications, updateNotificationRecord, openNotificationFeed, readNotificationFeed, canDeliverNotificationEvent, pruneNotificationSyncData } from "../repository/notificationSync";

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
    const response = await fetch(`${baseUrl}/api/notification/events`, { signal: controller.signal, headers: { Authorization: `Bearer ${token ?? await fixtureToken({ id })}`, ...(cursor ? { "Last-Event-ID": cursor } : {}) } });
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
    async function newUser() {
      const [user] = await db.insert(schema.userTable).values({ email: `${randomUUID()}@example.test`, oauthProvider: "other", oauthId: randomUUID(), referralCode: randomUUID() }).returning();
      return user;
    }
    const user = await newUser(), other = await newUser();
    const [account] = await db.insert(schema.accountTable).values({ role: "admin", email: `${randomUUID()}@example.test`, password: "unused", realName: "Fixture", phone: "0900000000" }).returning();
    const write = (userId: string, title = "測試 Notice", type: schema.UserNotification["type"] = "system_alert") => createNotificationRecord({ userId, title, body: "通知內容 Hello", type });
    const initial = await request("/notification/sync/stats", user.id);
    assert.deepEqual(initial.body.data, { version: 1, total: 0, system_alert: 0, order_status: 0, promotion: 0, coins_earned: 0, chat_message: 0, other: 0 });
    assert.equal((await request("/notification/sync/stats", account.id)).status, 401);
    assert.equal((await connect(account.id)).status, 401);
    const stream = await connect(user.id);
    const ready = await stream.next(); assert.equal(ready.event, "stream.ready"); assert.equal(ready.id, undefined);
    const legacyCreated = await createNotification({ userId: user.id, title: "訂單更新", body: "Paid", type: "order_status" });
    assert.equal("version" in legacyCreated, false); assert.equal("deletedAt" in legacyCreated, false);
    const created = await stream.next();
    assert.equal(created.event, "notification.created"); assert.equal(created.data.notification.id, legacyCreated.id);
    assert.equal(created.data.notification.version, 1); assert.equal(created.data.stats.order_status, 1);
    assert.equal("deletedAt" in created.data.notification, false);
    assert.equal((await request(`/notification/${legacyCreated.id}`, other.id)).status, 404);
    assert.equal((await request(`/notification/sync/${legacyCreated.id}`, other.id)).status, 404);
    const legacyList = await request("/notification/list", user.id);
    assert.deepEqual(Object.keys(legacyList.body.data).sort(), ["notifications", "total", "page", "limit", "totalPages"].sort());
    assert.equal("version" in legacyList.body.data.notifications[0], false);
    assert.equal((await request("/notification/stats", user.id)).body.data.order_status, 1);
    // A second API process performs the legacy read; the first streams its journal event.
    const read = await request("/notification/mark-as-read", user.id, "POST", { notificationIds: [legacyCreated.id] }, childUrl);
    assert.equal(read.status, 200); assert.equal("version" in read.body.data[0], false);
    const update = await stream.next(); assert.equal(update.event, "notification.updated");
    assert.equal(update.data.notification.isRead, true); assert.equal(update.data.notification.version, 2); assert.equal(update.data.stats.total, 0);
    const deleteResult = await request("/notification/sync", user.id, "DELETE", { notificationIds: [legacyCreated.id] });
    assert.deepEqual(deleteResult.body.data.deleted, [{ id: legacyCreated.id, version: 3 }]);
    const deletion = await stream.next(); assert.equal(deletion.event, "notification.deleted");
    assert.equal("notification" in deletion.data, false); assert.equal(deletion.data.version, 3);
    const beforeRetry = await openNotificationFeed(user.id);
    assert.deepEqual((await mutateNotifications(user.id, [legacyCreated.id], "delete")).deleted, deleteResult.body.data.deleted);
    assert.equal((await mutateNotifications(user.id, [legacyCreated.id], "read")).notifications.length, 0);
    assert.equal((await openNotificationFeed(user.id)).sequence, beforeRetry.sequence);
    assert.equal((await request(`/notification/${legacyCreated.id}`, user.id)).status, 404);
    const tombstone = await db.query.userNotificationTable.findFirst({ where: eq(schema.userNotificationTable.id, legacyCreated.id) });
    assert.equal(tombstone?.title, ""); assert.equal(tombstone?.body, "");
    await assert.rejects(createNotificationRecord({ id: legacyCreated.id, userId: user.id, title: "reuse", body: "bad" }));
    stream.close();
    // Deleted historical content is not exposed by replay; clients bootstrap instead.
    const stale = await connect(user.id, ready.data.cursor); await stale.next();
    assert.equal((await stale.next()).event, "stream.reset"); stale.close();
    assert.equal((await connect(other.id, deletion.id)).status, 403);
    assert.equal((await connect(user.id, encodeChatCursor({ kind: "feed", userId: user.id, sequence: 0 }))).status, 403);
    assert.equal((await connect(user.id, "bad")).status, 400);

    const owned = await write(user.id), foreign = await write(other.id);
    const beforeDenied = await openNotificationFeed(user.id);
    for (const path of ["/notification", "/notification/sync"]) {
      assert.equal((await request(path, user.id, "DELETE", { notificationIds: [owned.id, foreign.id] })).status, 404);
    }
    assert.equal((await request("/notification/sync/mark-as-read", user.id, "POST", { notificationIds: [owned.id, randomUUID()] })).status, 404);
    assert.equal((await getSyncNotification(user.id, owned.id)).isRead, false);
    assert.equal((await openNotificationFeed(user.id)).sequence, beforeDenied.sequence);
    assert.equal((await request("/notification/sync/mark-as-read", user.id, "POST", { notificationIds: [] })).status, 400);
    assert.equal((await request("/notification/sync/mark-as-read", user.id, "POST", { notificationIds: [owned.id, owned.id] })).status, 400);
    assert.equal((await request("/notification/sync", user.id, "DELETE", { notificationIds: Array.from({ length: 201 }, () => randomUUID()) })).status, 400);
    const second = await write(user.id);
    const batchStart = await openNotificationFeed(user.id);
    const races = await Promise.all([mutateNotifications(user.id, [owned.id, second.id], "read"), mutateNotifications(user.id, [owned.id, second.id], "read")]);
    assert.equal(races.reduce((n, result) => n + result.notifications.length, 0), 2);
    const batchEvents = await readNotificationFeed(user.id, batchStart.sequence);
    assert.equal(batchEvents.length, 2);
    assert.deepEqual(batchEvents[0].payload.stats, batchEvents[1].payload.stats);
    const updated = await updateNotificationRecord(user.id, owned.id, { type: "promotion", title: "New title", metadata: { a: 1 } });
    assert.equal(updated.version, 3); assert.deepEqual(updated.createdAt, owned.createdAt);
    const noOp = await openNotificationFeed(user.id);
    await updateNotificationRecord(user.id, owned.id, { title: "New title", metadata: { a: 1 } });
    assert.equal((await openNotificationFeed(user.id)).sequence, noOp.sequence);
    const countUser = await newUser();
    for (const type of schema.notificationTypeEnum.enumValues) await write(countUser.id, type, type);
    const counts = await getSyncNotificationStats(countUser.id);
    assert.equal(counts.total, 6);
    for (const type of schema.notificationTypeEnum.enumValues) assert.equal(counts[type], 1);
    const moved = (await listSyncNotifications({ userId: countUser.id, types: ["system_alert"] })).notifications[0];
    const afterEdit = await updateNotificationRecord(countUser.id, moved.id, { type: "other" });
    assert.equal(afterEdit.version, 2);
    const movedCounts = await getSyncNotificationStats(countUser.id); assert.equal(movedCounts.system_alert, 0); assert.equal(movedCounts.other, 2);

    const pageUser = await newUser();
    const tied = new Date("2026-10-11T01:00:00.123Z");
    const items = [];
    for (let i = 0; i < 21; i++) items.push(await createNotificationRecord({ userId: pageUser.id, title: "Notice 測試", body: String(i), createdAt: tied, type: "promotion" }));
    const snap = await listSyncNotifications({ userId: pageUser.id, snapshot: true, limit: 20, types: ["promotion"], onlyUnread: true });
    assert.equal(snap.total, 21); assert.equal(snap.notifications.length, 20);
    assert.deepEqual(snap.notifications.map((n) => n.id), items.map((n) => n.id).sort().reverse().slice(0, 20));
    await write(pageUser.id, "New", "promotion");
    await mutateNotifications(pageUser.id, [snap.notifications[0].id], "read");
    const samePage = await listSyncNotifications({ userId: pageUser.id, listSnapshot: snap.listSnapshot!, limit: 20, types: ["promotion"], onlyUnread: true });
    assert.equal(samePage.notifications.length, 19); assert.equal(samePage.total, 21);
    const page2 = await listSyncNotifications({ userId: pageUser.id, listSnapshot: snap.listSnapshot!, page: 2, limit: 20, types: ["promotion"], onlyUnread: true });
    assert.equal(page2.notifications.length, 1);
    await mutateNotifications(pageUser.id, [page2.notifications[0].id], "delete");
    assert.equal((await listSyncNotifications({ userId: pageUser.id, listSnapshot: snap.listSnapshot!, page: 2, limit: 20, types: ["promotion"], onlyUnread: true })).notifications.length, 0);
    await assert.rejects(listSyncNotifications({ userId: other.id, listSnapshot: snap.listSnapshot!, limit: 20, types: ["promotion"], onlyUnread: true }), (e: any) => e.statusCode === 400);
    await assert.rejects(listSyncNotifications({ userId: pageUser.id, listSnapshot: snap.listSnapshot!, limit: 20, types: ["promotion"], onlyUnread: false }), (e: any) => e.statusCode === 400);
    await listSyncNotifications({ userId: pageUser.id, snapshot: true, limit: 20, types: ["promotion"], onlyUnread: true });
    await assert.rejects(listSyncNotifications({ userId: pageUser.id, listSnapshot: snap.listSnapshot!, limit: 20, types: ["promotion"], onlyUnread: true }), (e: any) => e.statusCode === 410);
    const searched = await request("/notification/sync/list?snapshot=true&search=notice&types=promotion&types=other", pageUser.id);
    assert.equal(searched.status, 200); assert.equal(searched.body.data.total, 20);
    const token = searched.body.data.listSnapshot;
    const normalized = await request(`/notification/sync/list?listSnapshot=${token}&search=notice&types=other&types=promotion`, pageUser.id);
    assert.equal(normalized.status, 200);
    assert.equal((await request("/notification/sync/list?types[]=promotion", pageUser.id)).status, 400);
    assert.equal((await request("/notification/sync/list?onlyUnread=invalid", pageUser.id)).status, 400);
    const decoded = decodeNotificationCursor(token, "list");
    await db.update(schema.notificationListSnapshotTable).set({ expiresAt: new Date(0) }).where(eq(schema.notificationListSnapshotTable.id, decoded.id));
    assert.equal((await request(`/notification/sync/list?listSnapshot=${token}&search=notice&types=promotion&types=other`, pageUser.id)).status, 410);
    const limitUser = await newUser();
    for (let i = 0; i < 5; i++) await listSyncNotifications({ userId: limitUser.id, snapshot: true, search: String(i) });
    const limited = await request("/notification/sync/list?snapshot=true&search=sixth", limitUser.id);
    assert.equal(limited.status, 429);
    await listSyncNotifications({ userId: limitUser.id, snapshot: true, search: "0" }); // Replaces, does not consume a sixth slot.
    const largeUser = await newUser();
    // Bulk fixture setup only, to test the cap without 10,001 publishing transactions.
    for (let i = 0; i < 10001; i += 1000) {
      await db.insert(schema.userNotificationTable).values(Array.from({ length: Math.min(1000, 10001 - i) }, () => ({ userId: largeUser.id, title: "Fixture", body: "Size bound" })));
    }
    await assert.rejects(listSyncNotifications({ userId: largeUser.id, snapshot: true }), (e: any) => e.code === "NOTIFICATION_LIST_SNAPSHOT_TOO_LARGE");
    assert.equal((await listSyncNotifications({ userId: largeUser.id })).total, 10001);

    const replayUser = await newUser();
    const boundary = await openNotificationFeed(replayUser.id);
    const retained = await write(replayUser.id, "Retained");
    const reconnect = await connect(replayUser.id, boundary.cursor);
    assert.equal((await reconnect.next()).data.cursor, boundary.cursor);
    assert.equal((await reconnect.next()).data.notification.id, retained.id);
    await write(replayUser.id, "Live after replay");
    assert.equal((await reconnect.next()).data.notification.title, "Live after replay"); reconnect.close();
    // More than one batch crosses replay -> live without losing an event.
    const manyBoundary = await openNotificationFeed(replayUser.id);
    for (let i = 0; i < 22; i++) await write(replayUser.id, `Batch ${i}`);
    const many = await connect(replayUser.id, manyBoundary.cursor); await many.next();
    for (let i = 0; i < 22; i++) assert.equal((await many.next()).data.notification.title, `Batch ${i}`);
    many.close();
    await db.update(schema.notificationFeedEventTable).set({ createdAt: new Date(Date.now() - 49 * 3600_000) })
      .where(eq(schema.notificationFeedEventTable.userId, replayUser.id));
    await pruneNotificationSyncData();
    assert.equal((await connect(replayUser.id, boundary.cursor)).status, 410);
    assert.equal((await mutateNotifications(user.id, [legacyCreated.id], "delete")).deleted[0].version, 3);
    const oversize = await newUser(); const overBoundary = await openNotificationFeed(oversize.id);
    await createNotificationRecord({ userId: oversize.id, title: "Big", body: "x".repeat(300000) });
    const over = await connect(oversize.id, overBoundary.cursor); await over.next();
    assert.equal((await over.next()).event, "stream.reset"); over.close();
    const malformedUser = await newUser(); const malformedBoundary = await openNotificationFeed(malformedUser.id);
    await write(malformedUser.id);
    await db.update(schema.notificationFeedEventTable).set({ payload: { schemaVersion: 999 } }).where(eq(schema.notificationFeedEventTable.userId, malformedUser.id));
    const malformedStream = await connect(malformedUser.id, malformedBoundary.cursor); await malformedStream.next();
    assert.equal((await malformedStream.next()).event, "stream.reset"); malformedStream.close();
    const rollbackUser = await newUser(); const rollbackStart = await openNotificationFeed(rollbackUser.id);
    await assert.rejects(createNotificationRecord({ userId: rollbackUser.id, title: "Bad FK", body: "rollback", orderId: randomUUID() }));
    assert.equal((await openNotificationFeed(rollbackUser.id)).sequence, rollbackStart.sequence);
    assert.equal((await getSyncNotificationStats(rollbackUser.id)).total, 0);
    const expireUser = await newUser();
    const shortToken = jwt.sign({ data: { id: expireUser.id } }, process.env.JWT_SECRET!, { expiresIn: 2 });
    const expiring = await connect(expireUser.id, undefined, shortToken); await expiring.next();
    assert.equal((await expiring.next()).data.reason, "auth_expired"); expiring.close();
    const quotaUser = await newUser();
    const streams = await Promise.all([connect(quotaUser.id), connect(quotaUser.id), connect(quotaUser.id)]);
    assert.equal((await connect(quotaUser.id)).status, 429);
    // Chat has a separate quota and cursor domain.
    const chatAbort = new AbortController(); controllers.push(chatAbort);
    const chatStream = await fetch(`${baseUrl}/api/chatroom/events`, { signal: chatAbort.signal, headers: { Authorization: `Bearer ${await fixtureToken({ id: quotaUser.id })}` } });
    assert.equal(chatStream.status, 200); chatAbort.abort(); streams.forEach((s) => s.close());
    console.log("Notification SSE integration passed: user auth, two processes, legacy compatibility, transactional read/delete, concurrent retries, tombstones, filters, snapshots, replay/live, retention, rollback, payload limits, expiry and independent chat quota.");
  } finally {
    controllers.forEach((controller) => controller.abort());
    child.send("stop"); await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await client.end();
  }
}
run().catch(async (error) => { console.error(error); process.exitCode = 1; await client.end(); });
