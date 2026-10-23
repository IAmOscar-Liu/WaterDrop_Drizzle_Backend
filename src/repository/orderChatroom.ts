import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { ChatTx, lockChatFeed, publishChatRoom } from "./chatroomSync";

function reusableChatOrderCondition() {
  return or(isNull(schema.chatRoomTable.orderId), sql`exists (
    select 1 from ${schema.orderTable}
    where ${schema.orderTable.id} = ${schema.chatRoomTable.orderId}
      and ${schema.orderTable.userId} = ${schema.chatRoomTable.userId}
      and ${schema.orderTable.orderStatus} = 'failed'
  )`);
}

// Caller holds the chat feed lock. Both cart contact and checkout must choose
// the same conversation, including rows left linked to failed checkouts.
export async function findReusableProductChatroom(tx: ChatTx, input: {
  userId: string; accountId: string; productId: string; productVariantId: string;
}) {
  const [room] = await tx.select().from(schema.chatRoomTable).where(and(
    eq(schema.chatRoomTable.userId, input.userId),
    eq(schema.chatRoomTable.accountId, input.accountId),
    eq(schema.chatRoomTable.productId, input.productId),
    eq(schema.chatRoomTable.productVariantId, input.productVariantId),
    eq(schema.chatRoomTable.status, "active"),
    reusableChatOrderCondition(),
  )).orderBy(asc(schema.chatRoomTable.createdAt), asc(schema.chatRoomTable.id))
    .limit(1).for("update");
  return room;
}

// Retain the internal order FK for audit/history: another unlinked room can
// already exist, so clearing it would violate the room uniqueness constraint.
// Serializers hide failed orders; the revision tells connected clients to clear them.
export async function publishOrderChatrooms(tx: ChatTx, order: Pick<schema.Order, "id" | "userId">) {
  const condition = and(eq(schema.chatRoomTable.userId, order.userId), eq(schema.chatRoomTable.orderId, order.id));
  if (!(await tx.select({ id: schema.chatRoomTable.id }).from(schema.chatRoomTable).where(condition).limit(1)).length) return;
  await lockChatFeed(tx, order.userId);
  const rooms = await tx.select({ id: schema.chatRoomTable.id }).from(schema.chatRoomTable)
    .where(condition).orderBy(schema.chatRoomTable.id).for("update");
  for (const room of rooms) await publishChatRoom(tx, room.id);
}

/** Attach an order to existing pre-sale/failed-checkout conversations. */
export async function linkOrderChatrooms(
  tx: ChatTx,
  order: Pick<schema.Order, "id" | "userId">,
  items: Array<{ productId: string; productVariantId: string; sellerId: string }>,
) {
  if (!items.length) return;
  const eligible = and(
    eq(schema.chatRoomTable.userId, order.userId),
    eq(schema.chatRoomTable.status, "active"),
    reusableChatOrderCondition(),
    or(...items.map((item) => and(
      eq(schema.chatRoomTable.accountId, item.sellerId),
      eq(schema.chatRoomTable.productId, item.productId),
      eq(schema.chatRoomTable.productVariantId, item.productVariantId),
    ))),
  );
  // Orders without an existing pre-sale chat need no feed writes or new rooms.
  const candidates = await tx.select({ id: schema.chatRoomTable.id })
    .from(schema.chatRoomTable).where(eligible).limit(1);
  if (!candidates.length) return;

  // Use the same admin-publication -> user-feed -> room lock order as chat writes.
  // Recheck after acquiring the feed: another checkout or explicit order chat
  // may have claimed the room while we waited. Never overwrite a non-failed order.
  await lockChatFeed(tx, order.userId);
  for (const item of items) {
    const room = await findReusableProductChatroom(tx, {
      userId: order.userId, accountId: item.sellerId,
      productId: item.productId, productVariantId: item.productVariantId,
    });
    if (!room) continue;
    await tx.update(schema.chatRoomTable).set({ orderId: order.id })
      .where(eq(schema.chatRoomTable.id, room.id));
    await publishChatRoom(tx, room.id);
  }
}
