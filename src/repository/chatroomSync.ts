import { invalidateBadge } from "./appBadge";
import { visibleChatOrder } from "../lib/chatOrder";
import { lockAdminChatPublication, appendAdminChatEvent, pruneAdminChatSyncData } from "./adminChatroomSync";
import { and, asc, count, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { decodeChatCursor, encodeChatCursor } from "../lib/chatCursor";
import { minimumVariantPrice } from "./utils/product";

export type ChatTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function canonicalChatMessage<T extends schema.ChatMessage>(message: T) {
  const { senderIdentity, requestFingerprint, ...publicMessage } = message;
  return publicMessage;
}

function getVariantDisplayName(
  variant:
    | Pick<schema.ProductVariant, "name" | "optionValues">
    | null
    | undefined,
) {
  if (!variant) {
    return null;
  }

  const name = variant.name?.trim();
  if (name) {
    return name;
  }

  const optionValues = variant.optionValues;
  if (
    optionValues &&
    typeof optionValues === "object" &&
    !Array.isArray(optionValues)
  ) {
    const values = Object.values(optionValues as Record<string, unknown>)
      .map((value) => (value == null ? "" : String(value).trim()))
      .filter(Boolean);

    return values.length > 0 ? values.join(" / ") : null;
  }

  return null;
}

export function visibleChatRoomCondition() {
  return sql`exists (select 1 from ${schema.chatMessageTable} cm where cm.chat_room_id = ${schema.chatRoomTable.id})`;
}

export async function readChatSummaries(tx: ChatTx, userId: string | undefined, roomIds?: string[], pagination?: { limit: number; offset: number }, adminScope?: string) {
  if (roomIds?.length === 0) return [];
  const roomsData = await tx.query.chatRoomTable.findMany({
    where: and((userId ? eq(schema.chatRoomTable.userId, userId) : undefined), (adminScope && adminScope !== "platform" ? eq(schema.chatRoomTable.accountId, adminScope) : undefined), eq(schema.chatRoomTable.status, "active"), roomIds ? inArray(schema.chatRoomTable.id, roomIds) : undefined, pagination ? visibleChatRoomCondition() : undefined),
    limit: pagination?.limit,
    offset: pagination?.offset,
    orderBy: (chatRooms, { desc }) => [
      sql`coalesce((SELECT cm.created_at FROM ${schema.chatMessageTable} cm
           WHERE cm.chat_room_id = ${chatRooms.id}
           ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1), ${chatRooms.createdAt}) DESC`,
      desc(chatRooms.id),
    ],

    with: {
      user: { columns: { id: true, name: true, email: true } },
      product: {
        columns: {
          id: true,
          name: true,
          images: true,
        },
        extras: (products) => ({
          price: minimumVariantPrice(products.id, !adminScope).as("price"),
        }),
      },
      variant: {
        columns: {
          name: true,
          optionValues: true,
          images: true,
        },
      },
      order: {
        with: {
          items: true,
          deliveries: true,
        },
      },
    },
    extras: {
      activityTimestamp: sql<string>`to_char(coalesce((select cm.created_at from ${schema.chatMessageTable} cm where cm.chat_room_id = ${schema.chatRoomTable.id} order by cm.created_at desc, cm.id desc limit 1), ${schema.chatRoomTable.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("activity_timestamp"),
      unreadCount: sql<number>`(
        SELECT count(*)
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        AND cm.is_read = false
        AND ${adminScope ? sql`cm.sender_type = 'user'` : sql`cm.sender_type != 'user'`}
      )`.as("unread_count"),
      lastMessageId: sql<string>`(
        SELECT cm.id
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC, cm.id DESC
        LIMIT 1
      )`.as("last_message_id"),
    },
  });

  const lastMessageIds = roomsData
    .map((r) => r.lastMessageId)
    .filter((id): id is string => !!id);

  const lastMessagesMap = new Map<
    string,
    schema.ChatMessage & { attachments: schema.ChatMessageAttachment[] | null }
  >();
  if (lastMessageIds.length > 0) {
    const messages = await tx.query.chatMessageTable.findMany({
      where: inArray(schema.chatMessageTable.id, lastMessageIds),
      with: {
        attachments: true,
      },
    });
    messages.forEach((m) => lastMessagesMap.set(m.id, m));
  }

  const rooms = roomsData.map((room) => {
    const {
      unreadCount,
      activityTimestamp,
      lastMessageId,
      order: storedOrder,
      product: roomProduct,
      variant,
      user,
      ...rest
    } = room;

    const order = visibleChatOrder(storedOrder);
    let delivery = null;
    if (order && room.productId && room.productVariantId) {
      const item = order.items.find(
        (i) =>
          i.productId === room.productId &&
          i.productVariantId === room.productVariantId,
      );
      if (item?.deliveryId) {
        delivery = order.deliveries.find((d) => d.id === item.deliveryId);
      }
    }

    const lastMessage = lastMessageId
      ? lastMessagesMap.get(lastMessageId)
      : null;
    const product = roomProduct
      ? {
          ...roomProduct,
          variantName: getVariantDisplayName(variant),
          variantImage: variant?.images?.[0] ?? null,
        }
      : roomProduct;

    return {
      ...rest,
      orderId: order?.id ?? null,
      ...(adminScope ? { user } : {}),
      product,
      totalUnread: Number(unreadCount),
      lastMessage: lastMessage ? canonicalChatMessage(lastMessage) : null,
      lastActivityAt: activityTimestamp,
      listVisible: Boolean(lastMessage),
      order: order
        ? {
            id: order.id,
            orderStatus: order.orderStatus,
            merchantTradeNo: order.merchantTradeNo,
            totalAmount: order.totalAmount,
            discountCoin: order.discountCoin,
            delivery: delivery
              ? {
                  id: delivery.id,
                  merchantTradeNo: delivery.merchantTradeNo,
                  LogisticsType: delivery.LogisticsType,
                  LogisticsSubType: delivery.LogisticsSubType,
                  status: delivery.status,
                  RtnCode: delivery.RtnCode,
                  RtnMsg: delivery.RtnMsg,
                }
              : null,
          }
        : null,
    };
  });

  return rooms;
}

export async function lockChatFeed(tx: ChatTx, userId: string) {
  // Global admin publication lock precedes every app feed/room lock.
  await lockAdminChatPublication(tx);
  const user = await tx.query.userTable.findFirst({ columns: { id: true }, where: eq(schema.userTable.id, userId) });
  if (!user) throw new CustomError("Unauthorized", 401);
  await tx.insert(schema.chatFeedTable).values({ userId }).onConflictDoNothing();
  const [feed] = await tx.select().from(schema.chatFeedTable).where(eq(schema.chatFeedTable.userId, userId)).for("update");
  return feed;
}

// Acquire the feed BEFORE a room lock, consistently across all chat write paths.
export async function lockRoomFeed(tx: ChatTx, roomId: string) {
  const room = await tx.query.chatRoomTable.findFirst({ columns: { userId: true }, where: eq(schema.chatRoomTable.id, roomId) });
  if (!room) throw new CustomError("Chat room not found or not active", 404);
  await lockChatFeed(tx, room.userId);
  return room.userId;
}

export async function chatListState(tx: ChatTx, userId: string) {
  const feed = await tx.query.chatFeedTable.findFirst({ where: eq(schema.chatFeedTable.userId, userId) });
  const [rooms] = await tx.select({ total: count() }).from(schema.chatRoomTable).where(and(eq(schema.chatRoomTable.userId, userId), eq(schema.chatRoomTable.status, "active"), visibleChatRoomCondition()));
  const [unread] = await tx.select({ total: count() }).from(schema.chatMessageTable)
    .innerJoin(schema.chatRoomTable, eq(schema.chatRoomTable.id, schema.chatMessageTable.chatRoomId))
    .where(and(eq(schema.chatRoomTable.userId, userId), eq(schema.chatRoomTable.status, "active"), eq(schema.chatMessageTable.isRead, false), sql`${schema.chatMessageTable.senderType} != 'user'`));
  return { version: feed?.listVersion ?? 1, totalRooms: rooms.total, totalUnread: unread.total };
}

export async function appendChatEvent(tx: ChatTx, room: schema.ChatRoom, eventType: string, payload: Record<string, unknown>) {
  const [feed] = await tx.update(schema.chatFeedTable).set({ head: sql`${schema.chatFeedTable.head} + 1` })
    .where(eq(schema.chatFeedTable.userId, room.userId)).returning();
  if (!feed) throw new Error("Chat feed must be locked before appending events");
  // Preserve legacy write acceptance. Oversize payloads trigger REST resync instead
  // of introducing a new HTTP rejection on existing app/admin write paths.
  const oversized = Buffer.byteLength(JSON.stringify(payload)) > 256 * 1024;
  await tx.insert(schema.chatFeedEventTable).values({
    userId: room.userId, sequence: feed.head, chatRoomId: room.id,
    accessVersion: room.accessVersion, eventType: oversized ? "stream.reset" : eventType,
    payload: oversized
      ? { schemaVersion: 1, reason: "resync_required" }
      : { schemaVersion: 1, chatRoomId: room.id, ...payload },
  });
  await appendAdminChatEvent(tx, room, eventType, payload);
}

export async function publishChatRoom(tx: ChatTx, roomId: string) {
  const [room] = await tx.update(schema.chatRoomTable).set({ version: sql`${schema.chatRoomTable.version} + 1`, updatedAt: sql`${schema.chatRoomTable.updatedAt}` })
    .where(eq(schema.chatRoomTable.id, roomId)).returning();
  await tx.update(schema.chatFeedTable).set({ listVersion: sql`${schema.chatFeedTable.listVersion} + 1` }).where(eq(schema.chatFeedTable.userId, room.userId));
  await invalidateBadge(tx, room.userId);
  const listState = await chatListState(tx, room.userId);
  if (room.status !== "active") {
    await appendChatEvent(tx, room, "chatroom.removed", { roomVersion: room.version, reason: "access_revoked", listState });
  } else {
    const [summary] = await readChatSummaries(tx, room.userId, [room.id]);
    const { accessVersion, ...publicRoom } = summary;
    await appendChatEvent(tx, room, "chatroom.updated", { room: publicRoom, listState });
  }
}

export async function publishChatRead(tx: ChatTx, room: schema.ChatRoom, readerType: schema.ChatMessage["senderType"], messages: schema.ChatMessage[]) {
  for (let index = 0; index < messages.length; index += 200) {
    const batch = messages.slice(index, index + 200);
    await appendChatEvent(tx, room, "messages.read", {
      readerType, readAt: batch[0].updatedAt.toISOString(),
      messages: batch.map(({ id, version }) => ({ id, version, isRead: true })),
    });
  }
}

// This is the supported internal access-change path. Do not update status with raw SQL.
export async function setChatRoomStatus(roomId: string, status: schema.ChatRoom["status"]) {
  return db.transaction(async (tx) => {
    await lockRoomFeed(tx, roomId);
    const [room] = await tx.select().from(schema.chatRoomTable).where(eq(schema.chatRoomTable.id, roomId)).for("update");
    if (room.status === status) return room;
    await tx.update(schema.chatRoomTable).set({ status, accessVersion: room.accessVersion + 1 }).where(eq(schema.chatRoomTable.id, roomId));
    await publishChatRoom(tx, roomId);
    return tx.query.chatRoomTable.findFirst({ where: eq(schema.chatRoomTable.id, roomId) });
  });
}

export async function openChatFeed(userId: string, checkpoint?: string) {
  const cursor = checkpoint ? decodeChatCursor(checkpoint, "feed") : undefined;
  if (cursor && cursor.userId !== userId) throw new CustomError("Cursor belongs to another user", 403, "CHAT_STREAM_CURSOR_INVALID");
  return db.transaction(async (tx) => {
    const feed = await lockChatFeed(tx, userId);
    const sequence = cursor?.sequence ?? feed.head;
    if (sequence < feed.retainedAfter) throw new CustomError("Chat checkpoint is no longer retained", 410, "CHAT_STREAM_CURSOR_EXPIRED");
    if (sequence > feed.head) throw new CustomError("Chat checkpoint is ahead of this feed", 400, "CHAT_STREAM_CURSOR_INVALID");
    return { sequence, cursor: checkpoint ?? encodeChatCursor({ kind: "feed", userId, sequence }) };
  });
}

export async function readChatFeed(userId: string, sequence: number) {
  // A consistent read prevents concurrent retention from looking like a journal gap.
  return db.transaction(async (tx) => {
    const user = await tx.query.userTable.findFirst({ columns: { id: true }, where: eq(schema.userTable.id, userId) });
    if (!user) throw new CustomError("Unauthorized", 401);
    const feed = await tx.query.chatFeedTable.findFirst({ where: eq(schema.chatFeedTable.userId, userId) });
    if (!feed || sequence < feed.retainedAfter) throw new CustomError("Replay is unavailable", 410, "CHAT_STREAM_CURSOR_EXPIRED");
    const events = await tx.select().from(schema.chatFeedEventTable).where(and(eq(schema.chatFeedEventTable.userId, userId), gt(schema.chatFeedEventTable.sequence, sequence))).orderBy(asc(schema.chatFeedEventTable.sequence)).limit(20);
    if ((events[0] && events[0].sequence !== sequence + 1) || (!events.length && sequence < feed.head)) throw new CustomError("Journal discontinuity", 410, "CHAT_STREAM_CURSOR_EXPIRED");
    const ids = [...new Set(events.map((event) => event.chatRoomId))];
    const rooms = ids.length ? await tx.select().from(schema.chatRoomTable).where(and(eq(schema.chatRoomTable.userId, userId), inArray(schema.chatRoomTable.id, ids))) : [];
    const byId = new Map(rooms.map((room) => [room.id, room]));
    for (const event of events) {
      if (event.eventType === "chatroom.removed") continue;
      const room = byId.get(event.chatRoomId);
      // A revoke/regrant invalidates older payloads, even if the room is active again.
      if (!room || room.status !== "active" || room.accessVersion !== event.accessVersion) {
        throw new CustomError("Room access changed; resynchronize", 410, "CHAT_STREAM_ACCESS_CHANGED");
      }
    }
    return events;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

// Recheck after any socket backpressure wait, immediately before each content frame.
export async function canDeliverChatEvent(event: typeof schema.chatFeedEventTable.$inferSelect) {
  if (event.eventType === "chatroom.removed") return true;
  const room = await db.query.chatRoomTable.findFirst({
    columns: { id: true },
    where: and(eq(schema.chatRoomTable.id, event.chatRoomId), eq(schema.chatRoomTable.userId, event.userId), eq(schema.chatRoomTable.status, "active"), eq(schema.chatRoomTable.accessVersion, event.accessVersion)),
  });
  return Boolean(room);
}

export async function listChatSnapshot(userId: string, page: number, limit: number, token?: string) {
  if (limit > 100) throw new CustomError("Snapshot page size must be at most 100", 400, "CHATROOM_LIST_SNAPSHOT_INVALID");
  const cursor = token ? decodeChatCursor(token, "list") : undefined;
  if (cursor && (cursor.userId !== userId || cursor.limit !== limit)) throw new CustomError("Snapshot query or owner mismatch", 400, "CHATROOM_LIST_SNAPSHOT_INVALID");
  return db.transaction(async (tx) => {
    await lockChatFeed(tx, userId);
    let snapshot;
    if (cursor) {
      snapshot = await tx.query.chatListSnapshotTable.findFirst({ where: and(eq(schema.chatListSnapshotTable.id, cursor.id), eq(schema.chatListSnapshotTable.userId, userId)) });
      if (!snapshot || snapshot.expiresAt.getTime() <= Date.now()) throw new CustomError("List snapshot expired", 410, "CHATROOM_LIST_SNAPSHOT_EXPIRED");
    } else {
      if (page !== 1) throw new CustomError("Start a list snapshot at page 1", 400, "CHATROOM_LIST_SNAPSHOT_INVALID");
      const rooms = await tx.select({ id: schema.chatRoomTable.id, accessVersion: schema.chatRoomTable.accessVersion }).from(schema.chatRoomTable)
        .where(and(eq(schema.chatRoomTable.userId, userId), eq(schema.chatRoomTable.status, "active"), visibleChatRoomCondition()))
        .orderBy(sql`coalesce((select cm.created_at from ${schema.chatMessageTable} cm where cm.chat_room_id = ${schema.chatRoomTable.id} order by cm.created_at desc, cm.id desc limit 1), ${schema.chatRoomTable.createdAt}) DESC`, desc(schema.chatRoomTable.id)).limit(10001);
      if (rooms.length > 10000) throw new CustomError("Too many rooms for a snapshot", 409, "CHATROOM_LIST_SNAPSHOT_TOO_LARGE");
      await tx.delete(schema.chatListSnapshotTable).where(and(eq(schema.chatListSnapshotTable.userId, userId), lt(schema.chatListSnapshotTable.expiresAt, new Date())));
      const [{ total: activeSnapshots }] = await tx.select({ total: count() }).from(schema.chatListSnapshotTable).where(eq(schema.chatListSnapshotTable.userId, userId));
      if (activeSnapshots >= 5) throw new CustomError("At most five active list snapshots per user", 429, "CHATROOM_LIST_SNAPSHOT_LIMIT");
      [snapshot] = await tx.insert(schema.chatListSnapshotTable).values({ userId, pageSize: limit, rooms, expiresAt: new Date(Date.now() + 15 * 60_000) }).returning();
    }
    const members = snapshot.rooms.slice((page - 1) * limit, page * limit);
    const summaries = await readChatSummaries(tx, userId, members.map(({ id }) => id));
    const byId = new Map(summaries.map((room) => [room.id, room]));
    const rooms = members.flatMap((member) => {
      const room = byId.get(member.id);
      if (!room || room.accessVersion !== member.accessVersion) return [];
      const { accessVersion, ...publicRoom } = room;
      return [publicRoom];
    });
    return { rooms, page, limit, total: snapshot.rooms.length, totalPages: Math.ceil(snapshot.rooms.length / limit),
      listState: await chatListState(tx, userId),
      listSnapshot: token ?? encodeChatCursor({ kind: "list", userId, id: snapshot.id, limit }),
      listSnapshotExpiresAt: snapshot.expiresAt,
    };
  });
}

// Retain 48h (contract minimum 24h), preserving the checkpoint immediately before retained rows.
export async function pruneChatSyncData() {
  await pruneAdminChatSyncData();
  const candidates = await db.selectDistinct({ userId: schema.chatFeedEventTable.userId }).from(schema.chatFeedEventTable)
    .where(lt(schema.chatFeedEventTable.createdAt, sql`now() - interval '48 hours'`)).limit(100);
  for (const { userId } of candidates) {
    await db.transaction(async (tx) => {
      await lockChatFeed(tx, userId);
      const [boundary] = await tx.select({ sequence: sql<number>`max(${schema.chatFeedEventTable.sequence})` }).from(schema.chatFeedEventTable)
        .where(and(eq(schema.chatFeedEventTable.userId, userId), lt(schema.chatFeedEventTable.createdAt, sql`now() - interval '48 hours'`)));
      if (boundary.sequence == null) return;
      const [firstFresh] = await tx.select({ sequence: sql<number>`min(${schema.chatFeedEventTable.sequence})` }).from(schema.chatFeedEventTable)
        .where(and(eq(schema.chatFeedEventTable.userId, userId), sql`${schema.chatFeedEventTable.createdAt} >= now() - interval '48 hours'`));
      const pruneThrough = Math.min(Number(boundary.sequence), firstFresh.sequence == null ? Number(boundary.sequence) : Number(firstFresh.sequence) - 1);
      if (pruneThrough <= 0) return;
      await tx.update(schema.chatFeedTable).set({ retainedAfter: sql`greatest(${schema.chatFeedTable.retainedAfter}, ${pruneThrough})` }).where(eq(schema.chatFeedTable.userId, userId));
      await tx.delete(schema.chatFeedEventTable).where(and(eq(schema.chatFeedEventTable.userId, userId), lte(schema.chatFeedEventTable.sequence, pruneThrough)));
    });
  }
  await db.delete(schema.chatListSnapshotTable).where(lt(schema.chatListSnapshotTable.expiresAt, new Date()));
}
