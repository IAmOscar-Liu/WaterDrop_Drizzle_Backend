import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  SQL,
  sql,
} from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { isAccountAdmin } from "./account";
import { compactConditions, getPagination, getTotalPages } from "./utils/query";

function chatRoomHasMessagesCondition() {
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.chatMessageTable} cm
    WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
  )`;
}

function getChatRoomLookupCondition({
  userId,
  accountId,
  productId,
  orderId,
}: {
  userId: string;
  accountId: string | null;
  productId: string | null;
  orderId: string | null;
}) {
  return and(
    eq(schema.chatRoomTable.userId, userId),
    accountId === null
      ? isNull(schema.chatRoomTable.accountId)
      : eq(schema.chatRoomTable.accountId, accountId),
    productId === null
      ? isNull(schema.chatRoomTable.productId)
      : eq(schema.chatRoomTable.productId, productId),
    orderId === null
      ? isNull(schema.chatRoomTable.orderId)
      : eq(schema.chatRoomTable.orderId, orderId),
  );
}

/**
 * Finds an existing chat room or creates a new one.
 * This is a robust "get or create" pattern that prevents duplicate rooms.
 *
 * @param userId The ID of the user.
 * @param accountId The ID of the admin or seller.
 * @param productId Optional ID of the product the chat is about.
 * @returns The existing or newly created chat room.
 */
export async function findOrCreateChatRoom({
  userId,
  accountId,
  productId,
  orderId,
}: {
  userId: string;
  accountId?: string | null;
  productId?: string | null;
  orderId?: string | null;
}) {
  const lookup = {
    userId,
    accountId: accountId ?? null,
    productId: productId ?? null,
    orderId: orderId ?? null,
  };

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .for("update");

    if (!user) {
      throw new CustomError("User not found", 404);
    }

    const activateChatRoom = async (room: schema.ChatRoom) => {
      if (room.status === "active") return room;

      const [updatedRoom] = await tx
        .update(schema.chatRoomTable)
        .set({ status: "active" })
        .where(eq(schema.chatRoomTable.id, room.id))
        .returning();

      return updatedRoom ?? room;
    };

    let existingRoom = await tx.query.chatRoomTable.findFirst({
      where: getChatRoomLookupCondition(lookup),
    });

    if (!existingRoom && lookup.orderId) {
      existingRoom = await tx.query.chatRoomTable.findFirst({
        where: getChatRoomLookupCondition({ ...lookup, orderId: null }),
      });

      if (existingRoom) {
        const [updatedRoom] = await tx
          .update(schema.chatRoomTable)
          .set({ orderId: lookup.orderId })
          .where(eq(schema.chatRoomTable.id, existingRoom.id))
          .returning();

        existingRoom = updatedRoom ?? existingRoom;
      }
    }

    if (existingRoom) {
      return activateChatRoom(existingRoom);
    }

    const [newRoom] = await tx
      .insert(schema.chatRoomTable)
      .values(lookup)
      .returning();

    if (!newRoom) {
      throw new CustomError("Chat room could not be created", 500);
    }

    return newRoom;
  });
}

export async function getChatRoomById(chatRoomId: string) {
  return db.query.chatRoomTable.findFirst({
    with: {
      product: true,
    },
    where: eq(schema.chatRoomTable.id, chatRoomId),
  });
}

/**
 * Sends a message in a chat room and marks previous messages from the other party as read.
 * This is performed in a transaction to ensure data integrity.
 *
 * @param chatRoomId The ID of the chat room.
 * @param senderType The type of the sender ('user', 'admin', or 'seller').
 * @param content The message content.
 * @returns The newly created chat message.
 */
export async function sendChatMessage({
  chatRoomId,
  senderType,
  content,
  attachments,
}: {
  chatRoomId: string;
  senderType: schema.ChatMessage["senderType"];
  content?: string;
  attachments?: Omit<
    schema.NewChatMessageAttachment,
    "chatMessageId" | "id" | "createdAt" | "updatedAt"
  >[];
}) {
  return db.transaction(async (tx) => {
    // check if both content and attachments are null
    if (!content && (!attachments || attachments.length === 0)) {
      throw new CustomError("Content and attachments cannot both be null", 400);
    }

    // check if chatroom is active
    const existingRoom = await tx.query.chatRoomTable.findFirst({
      where: and(
        eq(schema.chatRoomTable.id, chatRoomId),
        eq(schema.chatRoomTable.status, "active"),
      ),
    });
    if (!existingRoom) {
      throw new CustomError("Chat room not found or not active", 404);
    }

    // Insert the new message
    const [newMessage] = await tx
      .insert(schema.chatMessageTable)
      .values({
        chatRoomId,
        senderType,
        content,
      })
      .returning();

    if (attachments && attachments.length > 0) {
      await tx.insert(schema.chatMessageAttachmentTable).values(
        attachments.map((a) => ({
          ...a,
          chatMessageId: newMessage.id,
        })),
      );
    }

    await tx
      .update(schema.chatMessageTable)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.chatMessageTable.chatRoomId, chatRoomId),
          ne(schema.chatMessageTable.senderType, senderType), // Mark messages from the *other* party
          eq(schema.chatMessageTable.isRead, false), // Only update unread messages
        ),
      );

    return tx.query.chatMessageTable.findFirst({
      where: eq(schema.chatMessageTable.id, newMessage.id),
      with: {
        attachments: true,
      },
    });
  });
}

export interface GetChatHistoryParams {
  chatRoomId: string;
  page?: number;
  limit?: number;
  startAt?: Date;
  endAt?: Date;
}

/**
 * Retrieves the message history for a chat room with pagination.
 *
 * @param params The chat room ID and pagination parameters.
 * @returns An object containing the messages array and pagination details.
 */
export async function getChatHistory({
  chatRoomId,
  page = 1,
  limit = 20,
  startAt,
  endAt,
}: GetChatHistoryParams) {
  const pagination = getPagination(page, limit);

  // Build the conditions for the query
  const whereClause = compactConditions([
    eq(schema.chatMessageTable.chatRoomId, chatRoomId),
    startAt ? gte(schema.chatMessageTable.createdAt, startAt) : undefined,
    endAt ? lte(schema.chatMessageTable.createdAt, endAt) : undefined,
  ]);

  // Query for total count of messages in the room
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatMessageTable)
    .where(whereClause);

  const total = totalResult[0]?.total ?? 0;
  const totalPages = getTotalPages(total, pagination.limit);

  // Query for the paginated messages, sorted by most recent first
  const messages = await db.query.chatMessageTable.findMany({
    where: whereClause,
    limit: pagination.limit,
    offset: pagination.offset,
    orderBy: (messages, { desc }) => [desc(messages.createdAt)],
    with: {
      attachments: true,
    },
  });

  // const messages = await db.query.chatMessageTable.findMany({
  //   where: and(...conditions),
  //   orderBy: (messages, { desc }) => [desc(messages.createdAt)],
  //   limit: limit,
  //   offset: offset,
  // });

  return {
    messages,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

/**
 * Marks all unread messages in a chat room as read for a specific reader.
 * For instance, if the reader is a 'user', it marks messages from 'seller' or 'admin' as read.
 *
 * @param chatRoomId The ID of the chat room.
 * @param readerType The type of the entity reading the messages ('user', 'admin', or 'seller').
 * @returns A promise that resolves to an array of the updated messages.
 */
export async function markMessagesAsRead(
  chatRoomId: string,
  readerType: schema.ChatMessage["senderType"],
) {
  // check if chatroom is active
  const existingRoom = await db.query.chatRoomTable.findFirst({
    where: and(
      eq(schema.chatRoomTable.id, chatRoomId),
      eq(schema.chatRoomTable.status, "active"),
    ),
  });
  if (!existingRoom) {
    throw new CustomError("Chat room not found or not active", 404);
  }

  return db
    .update(schema.chatMessageTable)
    .set({ isRead: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.chatMessageTable.chatRoomId, chatRoomId),
        ne(schema.chatMessageTable.senderType, readerType), // Mark messages from the *other* party
        eq(schema.chatMessageTable.isRead, false), // Only update unread messages
      ),
    )
    .returning();
}

export type ListChatRoomsParams = {
  userId: string;
  page?: number;
  limit?: number;
};

export async function listChatRooms({
  userId,
  page = 1,
  limit = 20,
}: ListChatRoomsParams) {
  const pagination = getPagination(page, limit);
  const conditions: (SQL | undefined)[] = [];
  // Build the conditions for the query
  conditions.push(eq(schema.chatRoomTable.userId, userId));
  conditions.push(eq(schema.chatRoomTable.status, "active"));
  conditions.push(chatRoomHasMessagesCondition());

  // 1. Get the total count of chat rooms matching the criteria
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatRoomTable)
    .where(compactConditions(conditions));

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  // 2. Get the paginated list of chat rooms
  // We order by the last message's timestamp (prioritizing rooms with messages), then by room creation date.
  const roomsData = await db.query.chatRoomTable.findMany({
    where: compactConditions(conditions),
    orderBy: (chatRooms, { desc }) => [
      sql`(SELECT cm.created_at FROM ${schema.chatMessageTable} cm 
           WHERE cm.chat_room_id = ${chatRooms.id} 
           ORDER BY cm.created_at DESC LIMIT 1) DESC NULLS LAST`,
      desc(chatRooms.createdAt),
    ],
    limit: pagination.limit,
    offset: pagination.offset,
    with: {
      product: true,
      order: {
        with: {
          items: true,
          deliveries: true,
        },
      },
    },
    extras: {
      unreadCount: sql<number>`(
        SELECT count(*) 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        AND cm.is_read = false
        AND cm.sender_type != 'user'
      )`.as("unread_count"),
      lastMessageId: sql<string>`(
        SELECT cm.id
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
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
    const messages = await db.query.chatMessageTable.findMany({
      where: inArray(schema.chatMessageTable.id, lastMessageIds),
      with: {
        attachments: true,
      },
    });
    messages.forEach((m) => lastMessagesMap.set(m.id, m));
  }

  const rooms = roomsData.map((room) => {
    const { unreadCount, lastMessageId, order, ...rest } = room;

    let delivery = null;
    if (order && room.productId) {
      const item = order.items.find((i) => i.productId === room.productId);
      if (item?.deliveryId) {
        delivery = order.deliveries.find((d) => d.id === item.deliveryId);
      }
    }

    const lastMessage = lastMessageId
      ? lastMessagesMap.get(lastMessageId)
      : null;

    return {
      ...rest,
      totalUnread: Number(unreadCount),
      lastMessage: lastMessage || null,
      order: order
        ? {
            id: order.id,
            orderStatus: order.orderStatus,
            merchantTradeNo: order.merchantTradeNo,
            totalAmount: order.totalAmount,
            discountCoin: order.discountCoin,
            delivery: delivery
              ? {
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

  return {
    rooms,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export type ListAdminChatRoomsParams = {
  accountId: string;
  productId?: string;
  status?: schema.ChatRoom["status"];
  page?: number;
  limit?: number;
  supportOnly?: boolean;
};

export async function listAdminChatRooms({
  accountId,
  productId,
  status,
  page = 1,
  limit = 20,
  supportOnly = false,
}: ListAdminChatRoomsParams) {
  const pagination = getPagination(page, limit);
  const conditions: (SQL | undefined)[] = [];
  // Build the conditions for the query

  const isAdmin = await isAccountAdmin(accountId);
  if (!isAdmin) {
    conditions.push(eq(schema.chatRoomTable.accountId, accountId));
  }
  if (isAdmin && supportOnly) {
    conditions.push(isNull(schema.chatRoomTable.accountId));
    conditions.push(isNull(schema.chatRoomTable.productId));
  }
  if (productId && !supportOnly) {
    conditions.push(eq(schema.chatRoomTable.productId, productId));
  }
  if (status) {
    conditions.push(eq(schema.chatRoomTable.status, status));
  }
  conditions.push(chatRoomHasMessagesCondition());

  // 1. Get the total count of chat rooms matching the criteria
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatRoomTable)
    .where(compactConditions(conditions));

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  // 2. Get the paginated list of chat rooms
  // We order by the last message's timestamp (prioritizing rooms with messages), then by room creation date.
  const roomsData = await db.query.chatRoomTable.findMany({
    where: compactConditions(conditions),
    orderBy: (chatRooms, { desc }) => [
      sql`(SELECT cm.created_at FROM ${schema.chatMessageTable} cm 
           WHERE cm.chat_room_id = ${chatRooms.id} 
           ORDER BY cm.created_at DESC LIMIT 1) DESC NULLS LAST`,
      desc(chatRooms.createdAt),
    ],
    limit: pagination.limit,
    offset: pagination.offset,
    with: {
      product: {
        columns: {
          id: true,
          name: true,
          images: true,
        },
      },
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
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
      unreadCount: sql<number>`(
        SELECT count(*) 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        AND cm.is_read = false
        AND cm.sender_type = 'user'
      )`.as("unread_count"),
      lastMessageId: sql<string>`(
        SELECT cm.id
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
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
    const messages = await db.query.chatMessageTable.findMany({
      where: inArray(schema.chatMessageTable.id, lastMessageIds),
      with: {
        attachments: true,
      },
    });
    messages.forEach((m) => lastMessagesMap.set(m.id, m));
  }

  const rooms = roomsData.map((room) => {
    const { unreadCount, lastMessageId, order, ...rest } = room;

    let delivery = null;
    if (order && room.productId) {
      const item = order.items.find((i) => i.productId === room.productId);
      if (item?.deliveryId) {
        delivery = order.deliveries.find((d) => d.id === item.deliveryId);
      }
    }

    const lastMessage = lastMessageId
      ? lastMessagesMap.get(lastMessageId)
      : null;

    return {
      ...rest,
      totalUnread: Number(unreadCount),
      lastMessage: lastMessage || null,
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

  return {
    rooms,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}
