import { and, asc, count, desc, eq, gt, isNull, lt, lte, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { decodeAdminChatCursor, encodeAdminChatCursor } from "../lib/adminChatCursor";
import { resolveAdminSellerScope } from "./adminScope";
import { readChatSummaries, visibleChatRoomCondition, type ChatTx } from "./chatroomSync";

// Every supported chat writer takes this lock BEFORE user-feed and room locks.
// This deliberately serializes chat commits, giving the platform feed commit order.
export async function lockAdminChatPublication(tx: ChatTx) {
  await tx.insert(schema.adminChatFeedTable).values({ scope: "platform" }).onConflictDoNothing();
  await tx.select().from(schema.adminChatFeedTable).where(eq(schema.adminChatFeedTable.scope, "platform")).for("update");
}
const scopeCondition = (scope: string) => scope === "platform" ? undefined : eq(schema.chatRoomTable.accountId, scope);
export async function adminChatPrincipal(accountId: string) {
  const access = await resolveAdminSellerScope(accountId);
  return JSON.stringify({ accountId, scope: access.isPlatformAdmin ? "platform" : access.sellerId!, role: access.role });
}
async function verifyPrincipal(principal: string) {
  const identity = JSON.parse(principal) as { accountId: string; scope: string; role: string };
  if (await adminChatPrincipal(identity.accountId) !== principal) throw new CustomError("Account scope changed; resynchronize", 403, "ADMIN_CHAT_SCOPE_CHANGED");
  return identity;
}
async function ensureFeed(tx: ChatTx, scope: string) {
  await tx.insert(schema.adminChatFeedTable).values({ scope }).onConflictDoNothing();
  return (await tx.select().from(schema.adminChatFeedTable).where(eq(schema.adminChatFeedTable.scope, scope)).for("update"))[0];
}
export async function adminChatListState(tx: ChatTx, scope: string) {
  const feed = await tx.query.adminChatFeedTable.findFirst({ where: eq(schema.adminChatFeedTable.scope, scope) });
  const [rooms] = await tx.select({ total: count() }).from(schema.chatRoomTable).where(and(scopeCondition(scope), eq(schema.chatRoomTable.status, "active"), visibleChatRoomCondition()));
  const [unread] = await tx.select({ total: count() }).from(schema.chatMessageTable)
    .innerJoin(schema.chatRoomTable, eq(schema.chatRoomTable.id, schema.chatMessageTable.chatRoomId))
    .where(and(scopeCondition(scope), eq(schema.chatRoomTable.status, "active"), eq(schema.chatMessageTable.senderType, "user"), eq(schema.chatMessageTable.isRead, false)));
  return { version: feed?.listVersion ?? 1, totalRooms: rooms.total, totalUnread: unread.total };
}
export async function appendAdminChatEvent(tx: ChatTx, room: schema.ChatRoom, eventType: string, input: Record<string, unknown>) {
  const scopes = ["platform", ...(room.accountId ? [room.accountId] : [])];
  for (const scope of scopes) {
    await ensureFeed(tx, scope);
    const summaryEvent = eventType === "chatroom.updated" || eventType === "chatroom.removed";
    await tx.update(schema.adminChatFeedTable).set({
      head: sql`${schema.adminChatFeedTable.head} + 1`,
      ...(summaryEvent ? { listVersion: sql`${schema.adminChatFeedTable.listVersion} + 1` } : {}),
    }).where(eq(schema.adminChatFeedTable.scope, scope));
    let payload = input;
    if (summaryEvent) {
      const listState = await adminChatListState(tx, scope);
      if (eventType === "chatroom.updated") {
        const [summary] = await readChatSummaries(tx, undefined, [room.id], undefined, scope);
        const { accessVersion, ...publicRoom } = summary;
        payload = { room: publicRoom, listState };
      } else payload = { roomVersion: room.version, reason: "access_revoked", listState };
    }
    const fullPayload = { schemaVersion: 1, chatRoomId: room.id, ...payload };
    const oversized = Buffer.byteLength(JSON.stringify(fullPayload)) > 256 * 1024;
    const feed = await tx.query.adminChatFeedTable.findFirst({ where: eq(schema.adminChatFeedTable.scope, scope) });
    await tx.insert(schema.adminChatFeedEventTable).values({ scope, sequence: feed!.head, chatRoomId: room.id,
      accessVersion: room.accessVersion, eventType: oversized ? "stream.reset" : eventType,
      payload: oversized ? { schemaVersion: 1, reason: "resync_required" } : fullPayload });
  }
}
export async function openAdminChatFeed(principal: string, checkpoint?: string) {
  const { scope } = await verifyPrincipal(principal);
  const cursor = checkpoint ? decodeAdminChatCursor(checkpoint, "feed") : undefined;
  if (cursor && cursor.principal !== principal) throw new CustomError("Cursor owner or scope mismatch", 403, "ADMIN_CHAT_STREAM_CURSOR_INVALID");
  return db.transaction(async (tx) => {
    await lockAdminChatPublication(tx);
    const feed = await ensureFeed(tx, scope);
    const sequence = cursor?.sequence ?? feed.head;
    if (sequence < feed.retainedAfter) throw new CustomError("Replay expired", 410, "ADMIN_CHAT_STREAM_CURSOR_EXPIRED");
    if (sequence > feed.head) throw new CustomError("Cursor is ahead of feed", 400, "ADMIN_CHAT_STREAM_CURSOR_INVALID");
    return { sequence, cursor: checkpoint ?? encodeAdminChatCursor({ kind: "feed", principal, sequence }) };
  });
}
export async function readAdminChatFeed(principal: string, sequence: number) {
  const { scope } = await verifyPrincipal(principal);
  return db.transaction(async (tx) => {
    const feed = await tx.query.adminChatFeedTable.findFirst({ where: eq(schema.adminChatFeedTable.scope, scope) });
    if (!feed || sequence < feed.retainedAfter) throw new CustomError("Replay expired", 410, "ADMIN_CHAT_STREAM_CURSOR_EXPIRED");
    const events = await tx.select().from(schema.adminChatFeedEventTable).where(and(eq(schema.adminChatFeedEventTable.scope, scope), gt(schema.adminChatFeedEventTable.sequence, sequence))).orderBy(asc(schema.adminChatFeedEventTable.sequence)).limit(20);
    if ((events[0] && events[0].sequence !== sequence + 1) || (!events.length && sequence < feed.head)) throw new Error("Admin journal gap");
    return events.map((event) => ({ ...event, principal }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function canDeliverAdminChatEvent(event: Awaited<ReturnType<typeof readAdminChatFeed>>[number]) {
  const { scope } = await verifyPrincipal(event.principal);
  const room = await db.query.chatRoomTable.findFirst({ where: and(eq(schema.chatRoomTable.id, event.chatRoomId), scopeCondition(scope)) });
  // No historical content is delivered after revoke/regrant or reassignment.
  if (!room || room.accessVersion !== event.accessVersion) return false;
  return event.eventType === "chatroom.removed" || room.status === "active";
}

export type AdminChatListQuery = { accountId: string; page?: number; limit?: number; productId?: string; productVariantId?: string; supportOnly?: boolean; snapshot?: boolean; listSnapshot?: string };
export async function listAdminSyncChatRooms(query: AdminChatListQuery) {
  const principal = await adminChatPrincipal(query.accountId);
  const { scope } = JSON.parse(principal) as { scope: string };
  const page = query.page ?? 1, limit = query.limit ?? 20;
  if (query.supportOnly && scope !== "platform") throw new CustomError("Support rooms require a platform admin", 403);
  const queryKey = JSON.stringify([query.productId ?? null, query.productVariantId ?? null, Boolean(query.supportOnly)]);
  const cursor = query.listSnapshot ? decodeAdminChatCursor(query.listSnapshot, "list") : undefined;
  if (cursor && (cursor.principal !== principal || cursor.queryKey !== queryKey || cursor.limit !== limit)) throw new CustomError("Snapshot owner, scope or query mismatch", 400, "ADMIN_CHAT_LIST_SNAPSHOT_INVALID");
  return db.transaction(async (tx) => {
    await lockAdminChatPublication(tx);
    await ensureFeed(tx, scope);
    const condition = and(scopeCondition(scope), eq(schema.chatRoomTable.status, "active"), visibleChatRoomCondition(),
      query.productId ? eq(schema.chatRoomTable.productId, query.productId) : undefined,
      query.productVariantId ? eq(schema.chatRoomTable.productVariantId, query.productVariantId) : undefined,
      query.supportOnly ? and(isNull(schema.chatRoomTable.accountId), isNull(schema.chatRoomTable.productId)) : undefined);
    let snapshot: typeof schema.adminChatListSnapshotTable.$inferSelect | undefined;
    if (cursor) {
      snapshot = await tx.query.adminChatListSnapshotTable.findFirst({ where: and(eq(schema.adminChatListSnapshotTable.id, cursor.id), eq(schema.adminChatListSnapshotTable.accountId, query.accountId), eq(schema.adminChatListSnapshotTable.scope, scope)) });
      if (!snapshot || snapshot.expiresAt.getTime() <= Date.now()) throw new CustomError("Snapshot expired", 410, "ADMIN_CHAT_LIST_SNAPSHOT_EXPIRED");
    }
    const makeSnapshot = query.snapshot && !cursor;
    if (makeSnapshot && page !== 1) throw new CustomError("Start snapshot at page 1", 400, "ADMIN_CHAT_LIST_SNAPSHOT_INVALID");
    const [{ total }] = await tx.select({ total: count() }).from(schema.chatRoomTable).where(condition);
    if (makeSnapshot && total > 10000) throw new CustomError("Snapshot exceeds 10000 rooms", 409, "ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE");
    const selected = snapshot?.rooms ?? await tx.select({ id: schema.chatRoomTable.id, accessVersion: schema.chatRoomTable.accessVersion }).from(schema.chatRoomTable).where(condition)
      .orderBy(sql`coalesce((select cm.created_at from ${schema.chatMessageTable} cm where cm.chat_room_id = ${schema.chatRoomTable.id} order by cm.created_at desc, cm.id desc limit 1), ${schema.chatRoomTable.createdAt}) desc`, desc(schema.chatRoomTable.id))
      .limit(makeSnapshot ? 10001 : limit).offset(makeSnapshot ? 0 : (page - 1) * limit);
    if (makeSnapshot) {
      await tx.delete(schema.adminChatListSnapshotTable).where(and(eq(schema.adminChatListSnapshotTable.accountId, query.accountId), lt(schema.adminChatListSnapshotTable.expiresAt, new Date())));
      const [active] = await tx.select({ total: count() }).from(schema.adminChatListSnapshotTable).where(eq(schema.adminChatListSnapshotTable.accountId, query.accountId));
      if (active.total >= 5) throw new CustomError("Five active snapshots allowed", 429, "ADMIN_CHAT_LIST_SNAPSHOT_LIMIT");
      [snapshot] = await tx.insert(schema.adminChatListSnapshotTable).values({ accountId: query.accountId, scope, queryKey, pageSize: limit, rooms: selected, expiresAt: new Date(Date.now() + 15 * 60_000) }).returning();
    }
    const members = snapshot ? snapshot.rooms.slice((page - 1) * limit, page * limit) : selected;
    const summaries = await readChatSummaries(tx, undefined, members.map((r) => r.id), undefined, scope);
    const byId = new Map(summaries.map((r) => [r.id, r]));
    const rooms = members.flatMap((member) => {
      const room = byId.get(member.id);
      if (!room || room.accessVersion !== member.accessVersion || !room.listVisible) return [];
      if ((query.productId && room.productId !== query.productId) || (query.productVariantId && room.productVariantId !== query.productVariantId) || (query.supportOnly && (room.accountId || room.productId))) return [];
      const { accessVersion, ...publicRoom } = room;
      return [publicRoom];
    });
    const frozenTotal = snapshot?.rooms.length ?? total;
    return { rooms, page, limit, total: frozenTotal, totalPages: Math.ceil(frozenTotal / limit), listState: await adminChatListState(tx, scope),
      listSnapshot: snapshot ? query.listSnapshot ?? encodeAdminChatCursor({ kind: "list", principal, id: snapshot.id, queryKey, limit }) : null,
      listSnapshotExpiresAt: snapshot?.expiresAt ?? null };
  });
}
export async function pruneAdminChatSyncData() {
  await db.transaction(async (tx) => {
    await lockAdminChatPublication(tx);
    const feeds = await tx.select().from(schema.adminChatFeedTable);
    for (const feed of feeds) {
      // Only remove a prefix; timestamps alone are not the feed ordering key.
      const [fresh] = await tx.select({ first: sql<number>`min(${schema.adminChatFeedEventTable.sequence})` }).from(schema.adminChatFeedEventTable).where(and(eq(schema.adminChatFeedEventTable.scope, feed.scope), sql`${schema.adminChatFeedEventTable.createdAt} >= now() - interval '48 hours'`));
      const boundary = fresh.first == null ? feed.head : Number(fresh.first) - 1;
      await tx.update(schema.adminChatFeedTable).set({ retainedAfter: boundary }).where(eq(schema.adminChatFeedTable.scope, feed.scope));
      await tx.delete(schema.adminChatFeedEventTable).where(and(eq(schema.adminChatFeedEventTable.scope, feed.scope), lte(schema.adminChatFeedEventTable.sequence, boundary)));
    }
    await tx.delete(schema.adminChatListSnapshotTable).where(lt(schema.adminChatListSnapshotTable.expiresAt, new Date()));
  });
}
