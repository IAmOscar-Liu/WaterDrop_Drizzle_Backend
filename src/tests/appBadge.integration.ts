import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import type { MulticastMessage } from "firebase-admin/messaging";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import { withPostgresAdvisoryLock } from "../lib/postgresAdvisoryLock";
import { sendMulticastPushNotification } from "../lib/sendNotification";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { reconcileBadge, invalidateBadge, captureBadgeWork } from "../repository/appBadge";
import { createNotificationRecord, mutateNotifications } from "../repository/notificationSync";
import { sendSystemChatMessage, sendSyncChatMessage, markSyncMessagesAsRead } from "../repository/chatroom";
import { setChatRoomStatus } from "../repository/chatroomSync";
import { upsertDeviceToken, updateUserTimezone } from "../repository/user";
import { openTreasureBox, resetDailyStats } from "../repository/treasureBox";
import { runBadgeWorker } from "../services/appBadge";
import { badgePushTransport, sendBadgeAwareMulticast } from "../services/appBadgePush";

async function run() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  assert.equal(process.env.NODE_ENV, "test");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const delivered: MulticastMessage[] = [];
  const original = badgePushTransport.send;
  let fail = false;
  let duringSend: (() => Promise<void>) | undefined;
  badgePushTransport.send = async payload => {
    delivered.push(payload);
    if (duringSend) { const operation = duringSend; duringSend = undefined; await operation(); }
    if (fail) return undefined;
    return { successCount: payload.tokens.length, failureCount: 0, responses: payload.tokens.map(() => ({ success: true })) };
  };
  try {
    const users = await db.insert(schema.userTable).values([1, 2, 3].map(() => ({ email: `${randomUUID()}@example.test`, oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID(), timezone: "Asia/Taipei" }))).returning();
    const [u, other, legacy] = users;
    const request = async (id: string, query = "") => {
      const r = await fetch(`${base}/api/app/badge${query}`, { headers: { Authorization: `Bearer ${await fixtureToken({ id })}` } });
      return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() as any };
    };
    assert.equal((await fetch(`${base}/api/app/badge`)).status, 401);
    const [admin] = await db.insert(schema.accountTable).values({ email: `${randomUUID()}@example.test`, password: "test-only", role: "admin" }).returning();
    assert.equal((await request(admin.id)).status, 401);
    assert.equal((await request(u.id, `?userId=${other.id}`)).status, 400);
    let response = await request(u.id);
    assert.equal(response.cache, "no-store");
    assert.equal(response.body.data.total, 0);
    assert.equal(response.body.data.version, 1);
    const note = await createNotificationRecord({ userId: u.id, type: "chat_message", title: "Independent persisted notification", body: "Count it" });
    await createNotificationRecord({ userId: other.id, type: "system_alert", title: "Other", body: "Other" });
    const [room] = await db.insert(schema.chatRoomTable).values({ userId: u.id }).returning();
    await sendSystemChatMessage({ chatRoomId: room.id, senderType: "admin", content: "Incoming" });
    // Test fixtures use database time to avoid the runner machine's calendar/timezone.
    const [box] = await db.insert(schema.treasureBoxTable).values({ userId: u.id, coinsAwarded: 0, accountingStatus: "zero_reward",
      userLocalDate: sql`(clock_timestamp() at time zone 'Asia/Taipei')::date`, timezoneSnapshot: "Asia/Taipei",
      claimDeadlineAt: sql`clock_timestamp() + interval '1 hour'` }).returning();
    await db.insert(schema.treasureBoxTable).values([
      { userId: u.id, coinsAwarded: 1, accountingStatus: "claimable", claimDeadlineAt: sql`clock_timestamp() - interval '1 second'` },
      { userId: u.id, coinsAwarded: 1, isOpened: true },
      { userId: u.id, coinsAwarded: 1, isActive: false },
      { userId: u.id, coinsAwarded: 1, accountingStatus: "acquired" },
      { userId: u.id, coinsAwarded: 1, accountingStatus: "unacquired" },
      { userId: u.id, coinsAwarded: 1, earnedAt: sql`clock_timestamp() - interval '2 days'` },
    ]);
    let badge = await reconcileBadge(u.id);
    assert.deepEqual([badge.claimableUnopenedBoxes, badge.unreadNotifications, badge.unreadChatMessages, badge.total], [1, 1, 1, 3]);
    assert.ok(badge.nextReconcileAt);
    assert.equal((await reconcileBadge(other.id)).total, 1);
    assert.ok((await Promise.all(Array.from({ length: 8 }, () => reconcileBadge(u.id)))).every(b => b.version === badge.version));
    // Counts stay equal while the expiry hint changes: no artificial version bump.
    await db.update(schema.treasureBoxTable).set({ claimDeadlineAt: sql`clock_timestamp() + interval '20 seconds'` }).where(eq(schema.treasureBoxTable.id, box.id));
    const hint = await reconcileBadge(u.id);
    assert.equal(hint.version, badge.version); assert.notEqual(hint.nextReconcileAt, badge.nextReconcileAt);
    // Same sum, different components must increment the snapshot version.
    await mutateNotifications(u.id, [note.id], "read");
    await sendSystemChatMessage({ chatRoomId: room.id, senderType: "admin", content: "Second" });
    const equalTotal = await reconcileBadge(u.id);
    assert.equal(equalTotal.total, badge.total); assert.ok(equalTotal.version > badge.version);
    await setChatRoomStatus(room.id, "inactive");
    assert.equal((await reconcileBadge(u.id)).unreadChatMessages, 0);
    await setChatRoomStatus(room.id, "active");
    assert.equal((await reconcileBadge(u.id)).unreadChatMessages, 2);
    await sendSyncChatMessage({ actor: { kind: "user", id: u.id }, chatRoomId: room.id, senderType: "user", content: "Reply", clientMessageId: randomUUID() });
    assert.equal((await reconcileBadge(u.id)).unreadChatMessages, 0);
    // Rollback removes both the domain change and its pending work.
    const before = (await captureBadgeWork(u.id)).work.length;
    await assert.rejects(db.transaction(async tx => { await invalidateBadge(tx, u.id); throw new Error("rollback"); }));
    assert.equal((await captureBadgeWork(u.id)).work.length, before);
    // Opening zero-reward boxes is covered by the real ledger path.
    await openTreasureBox(u.id, box.id);
    assert.equal((await reconcileBadge(u.id)).claimableUnopenedBoxes, 0);
    const [expiry] = await db.insert(schema.treasureBoxTable).values({ userId: u.id, coinsAwarded: 0, accountingStatus: "zero_reward", claimDeadlineAt: sql`clock_timestamp() + interval '1 hour'` }).returning();
    await reconcileBadge(u.id);
    await db.update(schema.treasureBoxTable).set({ claimDeadlineAt: sql`clock_timestamp()` }).where(eq(schema.treasureBoxTable.id, expiry.id));
    assert.equal((await reconcileBadge(u.id)).claimableUnopenedBoxes, 0);
    // Legacy date fallback and invalid timezone fallback, without ledger mode.
    process.env.COIN_LEDGER_ENABLED = "false";
    await db.insert(schema.treasureBoxTable).values({ userId: legacy.id, coinsAwarded: 0, earnedAt: sql`((clock_timestamp() at time zone 'Asia/Taipei')::date + time '00:00:01') at time zone 'Asia/Taipei'` });
    await updateUserTimezone(legacy.id, "Not/AZone");
    assert.equal((await reconcileBadge(legacy.id)).claimableUnopenedBoxes, 1);
    await updateUserTimezone(legacy.id, "America/Los_Angeles");
    // All timezone changes persist invalidations even without a session.
    assert.ok((await captureBadgeWork(legacy.id)).work.length >= 2);
    await runBadgeWorker(); // Works even when coin-ledger maintenance is disabled.
    await db.insert(schema.userDailyStatTable).values({ userId: legacy.id });
    await resetDailyStats(legacy.id);
    assert.equal((await reconcileBadge(legacy.id)).claimableUnopenedBoxes, 0);
    process.env.COIN_LEDGER_ENABLED = "true";
    // Device transfer preserves uniqueness and forces initial delivery, including zero.
    await upsertDeviceToken({ userId: u.id, deviceId: "device-a", fcmToken: "fake-shared-token" });
    await upsertDeviceToken({ userId: other.id, deviceId: "device-a", fcmToken: "fake-shared-token" });
    const tokens = await db.select().from(schema.deviceTokenTable);
    assert.equal(tokens.filter(t => t.fcmToken === "fake-shared-token").length, 1);
    assert.equal(tokens.find(t => t.fcmToken === "fake-shared-token")!.userId, other.id);
    const countBeforeStaleRecipient = delivered.length;
    await sendMulticastPushNotification({ tokens: ["fake-shared-token"], notification: { title: "Private old-account alert" } }, u.id);
    assert.equal(delivered.length, countBeforeStaleRecipient, "Transferred token must not receive the former owner's alert");
    await upsertDeviceToken({ userId: u.id, deviceId: "device-b", fcmToken: "fake-user-token" });
    await sendBadgeAwareMulticast({ tokens: ["fake-shared-token", "fake-user-token"], notification: { title: "Broadcast" }, data: { command: "message", notificationId: "preserved" } });
    const personalized = delivered.slice(-2);
    assert.equal(new Set(personalized.map(m => m.data?.badgeUserId)).size, 2);
    for (const message of personalized) {
      assert.equal(message.data?.notificationId, "preserved");
      assert.equal(message.apns?.payload?.aps.badge, Number(message.data?.badgeTotal));
    }
    await runBadgeWorker();
    assert.ok(delivered.some(m => m.data?.command === "badge_sync" && m.data.badgeUserId === u.id && m.data.badgeTotal === "0" && !m.notification && !m.apns?.payload?.aps.sound));
    // Re-register an unchanged count: force the badge onto the new binding.
    const oldDeliveries = delivered.length;
    await upsertDeviceToken({ userId: u.id, deviceId: "device-b", fcmToken: "fake-user-token" });
    await runBadgeWorker();
    assert.ok(delivered.length > oldDeliveries);
    // Mutation while a request is in flight survives captured-ID acknowledgement.
    await db.transaction(tx => invalidateBadge(tx, u.id, true));
    duringSend = async () => { await createNotificationRecord({ userId: u.id, type: "system_alert", title: "During dispatch", body: "Retain work" }); };
    await runBadgeWorker();
    assert.ok((await captureBadgeWork(u.id)).work.length > 0);
    await runBadgeWorker();
    assert.equal((await captureBadgeWork(u.id)).work.length, 0);
    // Transient failure keeps pending work and schedules backoff.
    await db.transaction(tx => invalidateBadge(tx, u.id, true)); fail = true;
    await runBadgeWorker();
    assert.ok((await captureBadgeWork(u.id)).work.length > 0);
    const failedState = await db.query.userBadgeStateTable.findFirst({ where: eq(schema.userBadgeStateTable.userId, u.id) });
    assert.ok(failedState?.retryAt); assert.equal(failedState?.failures, 1);
    fail = false;
    await db.update(schema.userBadgeStateTable).set({ retryAt: null }).where(eq(schema.userBadgeStateTable.userId, u.id));
    await runBadgeWorker();
    assert.equal((await captureBadgeWork(u.id)).work.length, 0);
    // Repeat read is a no-op and creates no work.
    await markSyncMessagesAsRead(room.id, { kind: "user", id: u.id });
    assert.equal((await captureBadgeWork(u.id)).work.length, 0);
    // Deadline worker also handles zero-reward boxes without financial expiry.
    await db.insert(schema.treasureBoxTable).values({ userId: u.id, coinsAwarded: 0, accountingStatus: "zero_reward", claimDeadlineAt: sql`clock_timestamp() + interval '800 milliseconds'` });
    const preExpiry = await reconcileBadge(u.id);
    assert.equal(preExpiry.claimableUnopenedBoxes, 1);
    await new Promise(r => setTimeout(r, 900));
    await runBadgeWorker();
    const stateAfterExpiry = await db.query.userBadgeStateTable.findFirst({ where: eq(schema.userBadgeStateTable.userId, u.id) });
    assert.equal(stateAfterExpiry!.claimableUnopenedBoxes, 0);
    assert.ok(stateAfterExpiry!.version > preExpiry.version);
    const guarded = await withPostgresAdvisoryLock("waterdrop:badge-worker", () => runBadgeWorker());
    assert.ok(guarded.acquired);
    assert.equal(guarded.value.acquired, false, "Another connection holding the worker lock prevents a duplicate run");
    console.log("App badge integration tests passed (FCM mocked).");
  } finally {
    badgePushTransport.send = original;
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await client.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
