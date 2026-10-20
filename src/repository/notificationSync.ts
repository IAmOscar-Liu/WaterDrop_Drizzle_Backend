import { invalidateBadge } from "./appBadge";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { decodeNotificationCursor, encodeNotificationCursor } from "../lib/notificationCursor";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type NotificationFilters = { search?: string; types?: schema.UserNotification["type"][]; onlyUnread?: boolean };
export function canonicalNotification({ deletedAt, ...notification }: schema.UserNotification) { return notification; }
export function legacyNotification(notification: ReturnType<typeof canonicalNotification>) {
  const { version, ...legacy } = notification;
  return legacy;
}
export async function requireNotificationUser(tx: Tx | typeof db, userId: string) {
  const user = await tx.query.userTable.findFirst({ columns: { id: true }, where: eq(schema.userTable.id, userId) });
  if (!user) throw new CustomError("Unauthorized", 401);
}
export async function lockNotificationFeed(tx: Tx, userId: string) {
  await requireNotificationUser(tx, userId);
  await tx.insert(schema.notificationFeedTable).values({ userId }).onConflictDoNothing();
  const [feed] = await tx.select().from(schema.notificationFeedTable).where(eq(schema.notificationFeedTable.userId, userId)).for("update");
  return feed;
}
async function statsInTransaction(tx: Tx, userId: string) {
  const feed = await tx.query.notificationFeedTable.findFirst({ where: eq(schema.notificationFeedTable.userId, userId) });
  const stats = { version: feed?.version ?? 1, total: 0, system_alert: 0, order_status: 0, promotion: 0, coins_earned: 0, chat_message: 0, other: 0 };
  const rows = await tx.select({ type: schema.userNotificationTable.type, total: count() }).from(schema.userNotificationTable)
    .where(and(eq(schema.userNotificationTable.userId, userId), isNull(schema.userNotificationTable.deletedAt), eq(schema.userNotificationTable.isRead, false)))
    .groupBy(schema.userNotificationTable.type);
  for (const row of rows) { stats[row.type] = row.total; stats.total += row.total; }
  return stats;
}
export async function getSyncNotificationStats(userId: string) {
  return db.transaction(async (tx) => { await lockNotificationFeed(tx, userId); return statsInTransaction(tx, userId); });
}

type Change = { kind: "created" | "updated" | "deleted"; row: schema.UserNotification };
async function publishChanges(tx: Tx, userId: string, changes: Change[]) {
  if (changes.length) await tx.update(schema.notificationFeedTable)
    .set({ version: sql`${schema.notificationFeedTable.version} + 1` }).where(eq(schema.notificationFeedTable.userId, userId));
  if (changes.length) await invalidateBadge(tx, userId);
  const stats = await statsInTransaction(tx, userId);
  for (const { kind, row } of changes) {
    const payload = { schemaVersion: 1, stats, ...(kind === "deleted"
      ? { notificationId: row.id, version: row.version }
      : { notification: canonicalNotification(row) }) };
    const oversized = Buffer.byteLength(JSON.stringify(payload)) > 256 * 1024;
    const [feed] = await tx.update(schema.notificationFeedTable).set({ head: sql`${schema.notificationFeedTable.head} + 1` })
      .where(eq(schema.notificationFeedTable.userId, userId)).returning();
    await tx.insert(schema.notificationFeedEventTable).values({
      userId, sequence: feed.head, notificationId: row.id,
      eventType: oversized ? "stream.reset" : `notification.${kind}`,
      payload: oversized ? { schemaVersion: 1, reason: "resync_required" } : payload,
    });
  }
  return stats;
}

export async function createNotificationRecord(data: schema.NewUserNotification) {
  return db.transaction(async (tx) => {
    await lockNotificationFeed(tx, data.userId);
    // IDs cannot be reused: deletion keeps a scrubbed row with the original PK.
    const [row] = await tx.insert(schema.userNotificationTable).values({ ...data, version: 1, deletedAt: null }).returning();
    await publishChanges(tx, data.userId, [{ kind: "created", row }]);
    return canonicalNotification(row);
  });
}

// Trusted content-edit workflow; no new admin or app edit endpoint is introduced.
export async function updateNotificationRecord(userId: string, id: string,
  patch: Partial<Pick<schema.UserNotification, "title" | "body" | "type" | "metadata">>) {
  return db.transaction(async (tx) => {
    await lockNotificationFeed(tx, userId);
    const row = await tx.query.userNotificationTable.findFirst({
      where: and(eq(schema.userNotificationTable.id, id), eq(schema.userNotificationTable.userId, userId), isNull(schema.userNotificationTable.deletedAt)),
    });
    if (!row) throw new CustomError("Notification not found", 404);
    const updates: typeof patch = {};
    for (const key of ["title", "body", "type", "metadata"] as const) {
      if (patch[key] !== undefined && !isDeepStrictEqual(patch[key], row[key])) Object.assign(updates, { [key]: patch[key] });
    }
    if (!Object.keys(updates).length) return canonicalNotification(row);
    const [updated] = await tx.update(schema.userNotificationTable)
      .set({ ...updates, version: sql`${schema.userNotificationTable.version} + 1`, updatedAt: new Date() })
      .where(eq(schema.userNotificationTable.id, id)).returning();
    await publishChanges(tx, userId, [{ kind: "updated", row: updated }]);
    return canonicalNotification(updated);
  });
}

export async function mutateNotifications(userId: string, notificationIds: string[], action: "read" | "delete") {
  const ids = [...new Set(notificationIds)];
  if (ids.length < 1 || ids.length > 200) throw new CustomError("Provide 1–200 unique notification IDs", 400);
  return db.transaction(async (tx) => {
    await lockNotificationFeed(tx, userId);
    const owned = await tx.select().from(schema.userNotificationTable)
      .where(and(eq(schema.userNotificationTable.userId, userId), inArray(schema.userNotificationTable.id, ids))).for("update");
    // Includes tombstones. Reject the entire batch without leaking other owners.
    if (owned.length !== ids.length) throw new CustomError("Notifications not found", 404);
    const changeIds = owned.filter((row) => !row.deletedAt && (action === "delete" || !row.isRead)).map((row) => row.id);
    const changed = changeIds.length ? await tx.update(schema.userNotificationTable).set({
      version: sql`${schema.userNotificationTable.version} + 1`, updatedAt: new Date(),
      ...(action === "read" ? { isRead: true } : { deletedAt: new Date(), title: "", body: "", metadata: null, orderId: null }),
    }).where(inArray(schema.userNotificationTable.id, changeIds)).returning() : [];
    const stats = await publishChanges(tx, userId, changed.map((row) => ({ row, kind: action === "read" ? "updated" : "deleted" })));
    const byId = new Map(changed.map((row) => [row.id, row]));
    return {
      notifications: action === "read" ? changed.map(canonicalNotification) : [],
      // Legacy reads still return owned, already-read items with their original shape.
      legacyReadItems: action === "read" ? owned.filter((row) => !row.deletedAt).map((row) => canonicalNotification(byId.get(row.id) ?? row)) : [],
      deleted: action === "delete" ? ids.map((id) => {
        const row = byId.get(id) ?? owned.find((item) => item.id === id)!;
        return { id, version: row.version };
      }) : [],
      changedCount: changed.length, stats,
    };
  });
}

export async function getSyncNotification(userId: string, id: string) {
  await requireNotificationUser(db, userId);
  const row = await db.query.userNotificationTable.findFirst({
    where: and(eq(schema.userNotificationTable.id, id), eq(schema.userNotificationTable.userId, userId), isNull(schema.userNotificationTable.deletedAt)),
  });
  if (!row) throw new CustomError("Notification not found", 404);
  return canonicalNotification(row);
}

export function normalizeNotificationFilters(filters: NotificationFilters) {
  return { search: filters.search ?? "", types: [...new Set(filters.types ?? [])].sort(), onlyUnread: filters.onlyUnread ?? false };
}
export function notificationListCondition(userId: string, filters: NotificationFilters) {
  return and(eq(schema.userNotificationTable.userId, userId), isNull(schema.userNotificationTable.deletedAt),
    filters.onlyUnread ? eq(schema.userNotificationTable.isRead, false) : undefined,
    filters.types?.length ? inArray(schema.userNotificationTable.type, filters.types) : undefined,
    filters.search ? or(ilike(schema.userNotificationTable.title, `%${filters.search}%`), ilike(schema.userNotificationTable.body, `%${filters.search}%`)) : undefined);
}
export async function listSyncNotifications(input: NotificationFilters & { userId: string; page?: number; limit?: number; snapshot?: boolean; listSnapshot?: string }) {
  const { userId, page = 1, limit = 20, snapshot: fresh = false, listSnapshot: token } = input;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) throw new CustomError("Invalid pagination", 400);
  if (fresh && token) throw new CustomError("snapshot and listSnapshot cannot be combined", 400, "NOTIFICATION_LIST_SNAPSHOT_INVALID");
  const filters = normalizeNotificationFilters(input);
  const queryKey = createHash("sha256").update(JSON.stringify({ ...filters, limit })).digest("hex");
  const cursor = token ? decodeNotificationCursor(token, "list") : undefined;
  if (cursor && (cursor.userId !== userId || cursor.limit !== limit || cursor.queryKey !== queryKey)) throw new CustomError("Snapshot query or owner mismatch", 400, "NOTIFICATION_LIST_SNAPSHOT_INVALID");
  return db.transaction(async (tx) => {
    await lockNotificationFeed(tx, userId);
    const condition = notificationListCondition(userId, filters);
    if (!fresh && !cursor) {
      const [{ total }] = await tx.select({ total: count() }).from(schema.userNotificationTable).where(condition);
      const notifications = await tx.select().from(schema.userNotificationTable).where(condition)
        .orderBy(desc(schema.userNotificationTable.createdAt), desc(schema.userNotificationTable.id)).limit(limit).offset((page - 1) * limit);
      return { notifications: notifications.map(canonicalNotification), page, limit, total, totalPages: Math.ceil(total / limit),
        stats: await statsInTransaction(tx, userId), listSnapshot: null, listSnapshotExpiresAt: null };
    }
    let snapshot;
    if (cursor) {
      snapshot = await tx.query.notificationListSnapshotTable.findFirst({ where: and(eq(schema.notificationListSnapshotTable.id, cursor.id), eq(schema.notificationListSnapshotTable.userId, userId)) });
      if (!snapshot || snapshot.expiresAt.getTime() <= Date.now()) throw new CustomError("Snapshot expired or replaced", 410, "NOTIFICATION_LIST_SNAPSHOT_EXPIRED");
    } else {
      if (page !== 1) throw new CustomError("Start a new snapshot at page 1", 400, "NOTIFICATION_LIST_SNAPSHOT_INVALID");
      const rows = await tx.select({ id: schema.userNotificationTable.id }).from(schema.userNotificationTable).where(condition)
        .orderBy(desc(schema.userNotificationTable.createdAt), desc(schema.userNotificationTable.id)).limit(10001);
      if (rows.length > 10000) throw new CustomError("Too many notifications for a snapshot", 409, "NOTIFICATION_LIST_SNAPSHOT_TOO_LARGE");
      await tx.delete(schema.notificationListSnapshotTable).where(and(eq(schema.notificationListSnapshotTable.userId, userId),
        or(lt(schema.notificationListSnapshotTable.expiresAt, new Date()), eq(schema.notificationListSnapshotTable.queryKey, queryKey))));
      const [{ total }] = await tx.select({ total: count() }).from(schema.notificationListSnapshotTable).where(eq(schema.notificationListSnapshotTable.userId, userId));
      if (total >= 5) throw new CustomError("At most five active notification snapshots per user", 429, "NOTIFICATION_LIST_SNAPSHOT_LIMIT");
      [snapshot] = await tx.insert(schema.notificationListSnapshotTable).values({ userId, queryKey, pageSize: limit,
        notificationIds: rows.map((row) => row.id), expiresAt: new Date(Date.now() + 15 * 60_000) }).returning();
    }
    const ids = snapshot.notificationIds.slice((page - 1) * limit, page * limit);
    const rows = ids.length ? await tx.select().from(schema.userNotificationTable).where(and(condition, inArray(schema.userNotificationTable.id, ids))) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return { notifications: ids.flatMap((id) => byId.has(id) ? [canonicalNotification(byId.get(id)!)] : []), page, limit,
      total: snapshot.notificationIds.length, totalPages: Math.ceil(snapshot.notificationIds.length / limit),
      stats: await statsInTransaction(tx, userId), listSnapshot: token ?? encodeNotificationCursor({ kind: "list", userId, id: snapshot.id, limit, queryKey }),
      listSnapshotExpiresAt: snapshot.expiresAt };
  });
}

export async function openNotificationFeed(userId: string, checkpoint?: string) {
  const cursor = checkpoint ? decodeNotificationCursor(checkpoint, "feed") : undefined;
  if (cursor && cursor.userId !== userId) throw new CustomError("Cursor belongs to another user", 403, "NOTIFICATION_STREAM_CURSOR_INVALID");
  return db.transaction(async (tx) => {
    const feed = await lockNotificationFeed(tx, userId);
    const sequence = cursor?.sequence ?? feed.head;
    if (sequence < feed.retainedAfter) throw new CustomError("Notification checkpoint expired", 410, "NOTIFICATION_STREAM_CURSOR_EXPIRED");
    if (sequence > feed.head) throw new CustomError("Checkpoint ahead of feed", 400, "NOTIFICATION_STREAM_CURSOR_INVALID");
    return { sequence, cursor: checkpoint ?? encodeNotificationCursor({ kind: "feed", userId, sequence }) };
  });
}
export async function canDeliverNotificationEvent(event: typeof schema.notificationFeedEventTable.$inferSelect) {
  await requireNotificationUser(db, event.userId);
  const row = await db.query.userNotificationTable.findFirst({ columns: { id: true, version: true, deletedAt: true },
    where: and(eq(schema.userNotificationTable.id, event.notificationId), eq(schema.userNotificationTable.userId, event.userId)) });
  const payload = event.payload;
  const stats = payload.stats as Record<string, unknown> | undefined;
  const positiveInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (payload.schemaVersion !== 1 || !stats || !positiveInteger(stats.version)) return false;
  const counts = schema.notificationTypeEnum.enumValues.map((type) => stats[type]);
  if (!counts.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    || stats.total !== (counts as number[]).reduce((sum, value) => sum + value, 0)) return false;
  // Historical content of deleted/revoked items must never be replayed. Reset instead.
  if (!row) return false;
  if (event.eventType === "notification.deleted") {
    return Boolean(row.deletedAt && payload.notificationId === row.id && payload.version === row.version);
  }
  if (!["notification.created", "notification.updated"].includes(event.eventType) || row.deletedAt) return false;
  const item = payload.notification as Record<string, unknown> | undefined;
  return Boolean(item && item.id === row.id && item.userId === event.userId && positiveInteger(item.version)
    && (item.version as number) <= row.version && typeof item.isRead === "boolean" && typeof item.title === "string"
    && typeof item.body === "string" && schema.notificationTypeEnum.enumValues.includes(item.type as schema.UserNotification["type"])
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)));
}
export async function readNotificationFeed(userId: string, sequence: number) {
  return db.transaction(async (tx) => {
    await requireNotificationUser(tx, userId);
    const feed = await tx.query.notificationFeedTable.findFirst({ where: eq(schema.notificationFeedTable.userId, userId) });
    if (!feed || sequence < feed.retainedAfter) throw new CustomError("Replay unavailable", 410, "NOTIFICATION_STREAM_CURSOR_EXPIRED");
    const events = await tx.select().from(schema.notificationFeedEventTable)
      .where(and(eq(schema.notificationFeedEventTable.userId, userId), gt(schema.notificationFeedEventTable.sequence, sequence)))
      .orderBy(asc(schema.notificationFeedEventTable.sequence)).limit(20);
    if ((events[0] && events[0].sequence !== sequence + 1) || (!events.length && sequence < feed.head)) throw new CustomError("Journal discontinuity", 410, "NOTIFICATION_STREAM_CURSOR_EXPIRED");
    return events;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function pruneNotificationSyncData() {
  const candidates = await db.selectDistinct({ userId: schema.notificationFeedEventTable.userId }).from(schema.notificationFeedEventTable)
    .where(lt(schema.notificationFeedEventTable.createdAt, sql`now() - interval '48 hours'`)).limit(100);
  for (const { userId } of candidates) {
    await db.transaction(async (tx) => {
      await lockNotificationFeed(tx, userId);
      const [old] = await tx.select({ sequence: sql<number>`max(${schema.notificationFeedEventTable.sequence})` }).from(schema.notificationFeedEventTable)
        .where(and(eq(schema.notificationFeedEventTable.userId, userId), lt(schema.notificationFeedEventTable.createdAt, sql`now() - interval '48 hours'`)));
      const [fresh] = await tx.select({ sequence: sql<number>`min(${schema.notificationFeedEventTable.sequence})` }).from(schema.notificationFeedEventTable)
        .where(and(eq(schema.notificationFeedEventTable.userId, userId), sql`${schema.notificationFeedEventTable.createdAt} >= now() - interval '48 hours'`));
      const boundary = Math.min(Number(old.sequence), fresh.sequence == null ? Number(old.sequence) : Number(fresh.sequence) - 1);
      if (boundary <= 0) return;
      await tx.update(schema.notificationFeedTable).set({ retainedAfter: sql`greatest(${schema.notificationFeedTable.retainedAfter}, ${boundary})` }).where(eq(schema.notificationFeedTable.userId, userId));
      await tx.delete(schema.notificationFeedEventTable).where(and(eq(schema.notificationFeedEventTable.userId, userId), lte(schema.notificationFeedEventTable.sequence, boundary)));
    });
  }
  await db.delete(schema.notificationListSnapshotTable).where(lt(schema.notificationListSnapshotTable.expiresAt, new Date()));
}
