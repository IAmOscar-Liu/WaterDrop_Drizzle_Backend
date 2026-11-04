import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { appendChatEvent, canonicalChatMessage, ChatTx, lockChatFeed, publishChatRoom } from "./chatroomSync";

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

// Publish under the same feed lock as message/association writes. A delivery
// change affects only rooms whose exact order item references that delivery.
export async function publishOrderChatrooms(
  tx: ChatTx,
  order: Pick<schema.Order, "id" | "userId">,
  deliveryId?: string,
) {
  const condition = and(
    eq(schema.chatRoomTable.userId, order.userId),
    eq(schema.chatRoomTable.orderId, order.id),
    deliveryId ? sql`exists (
      select 1 from ${schema.orderItemTable}
      where ${schema.orderItemTable.orderId} = ${schema.chatRoomTable.orderId}
        and ${schema.orderItemTable.productId} = ${schema.chatRoomTable.productId}
        and ${schema.orderItemTable.productVariantId} = ${schema.chatRoomTable.productVariantId}
        and ${schema.orderItemTable.deliveryId} = ${deliveryId}
    )` : undefined,
  );
  if (!(await tx.select({ id: schema.chatRoomTable.id }).from(schema.chatRoomTable).where(condition).limit(1)).length) return;
  await lockChatFeed(tx, order.userId);
  const rooms = await tx.select({ id: schema.chatRoomTable.id }).from(schema.chatRoomTable)
    .where(condition).orderBy(schema.chatRoomTable.id).for("update");
  for (const room of rooms) await publishChatRoom(tx, room.id);
}

export async function publishDeliveryChatrooms(tx: ChatTx, delivery: Pick<schema.Delivery, "id" | "orderId">) {
  const order = await tx.query.orderTable.findFirst({
    columns: { id: true, userId: true, orderStatus: true },
    where: eq(schema.orderTable.id, delivery.orderId),
  });
  // Failed orders have no visible order/delivery summary.
  if (order && order.orderStatus !== "failed") await publishOrderChatrooms(tx, order, delivery.id);
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


/** Persist fulfillment reminders with the first successful payment, under its order lock. */
export async function sendOrderFulfillmentFollowups(tx: ChatTx, order: Pick<schema.Order, "id" | "userId" | "shippingInfo"> & {
  items: Array<Pick<schema.OrderItem, "productId" | "productVariantId" | "productNameAtSale" | "variantNameAtSale"> & {
    product: Pick<schema.Product, "sellerId" | "type">;
  }>;
}) {
  const shipping = order.shippingInfo as { nonCvsPickupGroup?: Array<{
    LogisticsType?: string; type?: string; products?: Array<{ productId: string; variantId: string }>;
  }> } | null;
  const groups = Array.isArray(shipping?.nonCvsPickupGroup) ? shipping.nonCvsPickupGroup : [];
  const targets = order.items.flatMap(item => {
    const group = groups.find(group => group && Array.isArray(group.products) && group.products.some(product =>
      product && product.productId === item.productId && product.variantId === item.productVariantId));
    const method = group?.LogisticsType ?? group?.type;
    const virtual = method === "virtual" || item.product.type === "virtual";
    // Membership is snapshotted checkout selection, not the product's allowHomeDelivery flag.
    const homeDelivery = Boolean(group) && (method === "home_delivery" || method === "HOME");
    return virtual || homeDelivery ? [{ item, virtual }] : [];
  });
  if (!targets.length) return;
  await lockChatFeed(tx, order.userId);
  for (const { item, virtual } of targets) {
    const lookup = { userId: order.userId, accountId: item.product.sellerId,
      productId: item.productId, productVariantId: item.productVariantId };
    let room = await tx.query.chatRoomTable.findFirst({ where: and(
      eq(schema.chatRoomTable.userId, order.userId), eq(schema.chatRoomTable.accountId, lookup.accountId),
      eq(schema.chatRoomTable.productId, item.productId), eq(schema.chatRoomTable.productVariantId, item.productVariantId),
      eq(schema.chatRoomTable.orderId, order.id),
    ) });
    if (!room) {
      room = await findReusableProductChatroom(tx, lookup);
      if (room) {
        [room] = await tx.update(schema.chatRoomTable).set({ orderId: order.id })
          .where(eq(schema.chatRoomTable.id, room.id)).returning();
      } else {
        [room] = await tx.insert(schema.chatRoomTable).values({ ...lookup, orderId: order.id }).returning();
      }
    }
    if (room.status !== "active") {
      [room] = await tx.update(schema.chatRoomTable).set({ status: "active", accessVersion: sql`${schema.chatRoomTable.accessVersion} + 1` })
        .where(eq(schema.chatRoomTable.id, room.id)).returning();
    }
    const productName = item.variantNameAtSale?.trim()
      ? `${item.productNameAtSale}（${item.variantNameAtSale.trim()}）` : item.productNameAtSale;
    const content = virtual
      ? `【系統通知】訂單已付款成功。您購買的「${productName}」為虛擬商品，請透過此聊天室與賣家確認提供方式、使用／兌換資訊及交付時間；也請賣家在此回覆交付詳情。`
      : `【系統通知】訂單已付款成功。您購買的「${productName}」選擇賣家宅配，請透過此聊天室與賣家確認配送資訊、出貨時間及物流追蹤資料；也請賣家在此回覆配送詳情。`;
    const [message] = await tx.insert(schema.chatMessageTable).values({
      chatRoomId: room.id, senderType: "admin", senderIdentity: "system:order-fulfillment", content,
    }).returning();
    // System reminders do not mark existing messages as read on either participant's behalf.
    await appendChatEvent(tx, room, "message.created", { message: { ...canonicalChatMessage(message), attachments: [] } });
    await publishChatRoom(tx, room.id);
  }
}
