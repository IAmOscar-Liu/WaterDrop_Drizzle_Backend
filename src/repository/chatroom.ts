import { and, count, eq, gte, isNull, lte, ne, SQL, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { isAccountAdmin } from "./account";

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
  accountId: string;
  productId?: string | null;
  orderId?: string | null;
}) {
  // 1. Try to find an existing chat room
  let existingRoom = await db.query.chatRoomTable.findFirst({
    where: and(
      eq(schema.chatRoomTable.userId, userId),
      eq(schema.chatRoomTable.accountId, accountId),
      orderId
        ? eq(schema.chatRoomTable.orderId, orderId)
        : isNull(schema.chatRoomTable.orderId),
      productId
        ? eq(schema.chatRoomTable.productId, productId)
        : isNull(schema.chatRoomTable.productId)
    ),
  });

  // 1.1 Try to find an existing chat room without orderId
  if (!existingRoom && orderId) {
    existingRoom = await db.query.chatRoomTable.findFirst({
      where: and(
        eq(schema.chatRoomTable.userId, userId),
        eq(schema.chatRoomTable.accountId, accountId),
        isNull(schema.chatRoomTable.orderId),
        productId
          ? eq(schema.chatRoomTable.productId, productId)
          : isNull(schema.chatRoomTable.productId)
      ),
    });
    if (existingRoom) {
      [existingRoom] = await db
        .update(schema.chatRoomTable)
        .set({ orderId })
        .where(eq(schema.chatRoomTable.id, existingRoom.id))
        .returning();
    }
  }

  // const existingRoom = await db.query.chatRoomTable.findFirst({
  //   where: and(
  //     eq(schema.chatRoomTable.userId, userId),
  //     eq(schema.chatRoomTable.accountId, accountId),
  //     productId
  //       ? eq(schema.chatRoomTable.productId, productId)
  //       : isNull(schema.chatRoomTable.productId)
  //   ),
  // });

  if (existingRoom) {
    console.log("Found existing chat room:", existingRoom.id);
    if (existingRoom.status !== "active") {
      // if existing room is inactive, set it to active
      return await db
        .update(schema.chatRoomTable)
        .set({ status: "active" })
        .where(eq(schema.chatRoomTable.id, existingRoom.id))
        .returning();
    }

    return existingRoom;
  }

  // 2. If not found, create a new one
  console.log("No chat room found, creating a new one...");
  let [newRoom] = await db
    .insert(schema.chatRoomTable)
    .values({ userId, accountId, productId: productId ?? null })
    .returning();

  console.log("New chat room created:", newRoom.id);

  // 2.2 If order is given and not in the room, update it
  if (orderId && newRoom.orderId !== orderId) {
    [newRoom] = await db
      .update(schema.chatRoomTable)
      .set({ orderId })
      .where(eq(schema.chatRoomTable.id, newRoom.id))
      .returning();
  }
  return newRoom;
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
export async function sendChatMessage(
  chatRoomId: string,
  senderType: schema.ChatMessage["senderType"],
  content: string
) {
  // check if chatroom is active
  const existingRoom = await db.query.chatRoomTable.findFirst({
    where: and(
      eq(schema.chatRoomTable.id, chatRoomId),
      eq(schema.chatRoomTable.status, "active")
    ),
  });
  if (!existingRoom) {
    throw new CustomError("Chat room not found or not active", 404);
  }

  // Insert the new message
  const [newMessage] = await db
    .insert(schema.chatMessageTable)
    .values({
      chatRoomId,
      senderType,
      content,
    })
    .returning();

  console.log("New message sent:", newMessage.id);
  return newMessage;
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
  const offset = (page - 1) * limit;

  // Build the conditions for the query
  const conditions = [eq(schema.chatMessageTable.chatRoomId, chatRoomId)];
  if (startAt) {
    conditions.push(gte(schema.chatMessageTable.createdAt, startAt));
  }
  if (endAt) {
    conditions.push(lte(schema.chatMessageTable.createdAt, endAt));
  }

  // Query for total count of messages in the room
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatMessageTable)
    .where(and(...conditions));

  const total = totalResult[0]?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated messages, sorted by most recent first
  const messages = await db.query.chatMessageTable.findMany({
    where: and(...conditions),
    orderBy: (messages, { desc }) => [desc(messages.createdAt)],
    limit: limit,
    offset: offset,
  });

  return {
    messages,
    total,
    page,
    limit,
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
  readerType: schema.ChatMessage["senderType"]
) {
  // check if chatroom is active
  const existingRoom = await db.query.chatRoomTable.findFirst({
    where: and(
      eq(schema.chatRoomTable.id, chatRoomId),
      eq(schema.chatRoomTable.status, "active")
    ),
  });
  if (!existingRoom) {
    throw new CustomError("Chat room not found or not active", 404);
  }

  console.log(
    `Marking messages in room ${chatRoomId} as read for ${readerType}.`
  );
  return db
    .update(schema.chatMessageTable)
    .set({ isRead: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.chatMessageTable.chatRoomId, chatRoomId),
        ne(schema.chatMessageTable.senderType, readerType), // Mark messages from the *other* party
        eq(schema.chatMessageTable.isRead, false) // Only update unread messages
      )
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
  const offset = (page - 1) * limit;
  const conditions: (SQL | undefined)[] = [];
  // Build the conditions for the query
  conditions.push(eq(schema.chatRoomTable.userId, userId));
  conditions.push(eq(schema.chatRoomTable.status, "active"));

  // 1. Get the total count of chat rooms matching the criteria
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatRoomTable)
    .where(and(...conditions));

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // 2. Get the paginated list of chat rooms
  // We order by the last message's timestamp (prioritizing rooms with messages), then by room creation date.
  const roomsData = await db.query.chatRoomTable.findMany({
    where: and(...conditions),
    orderBy: (chatRooms, { desc }) => [
      sql`(SELECT cm.created_at FROM ${schema.chatMessageTable} cm 
           WHERE cm.chat_room_id = ${chatRooms.id} 
           ORDER BY cm.created_at DESC LIMIT 1) DESC NULLS LAST`,
      desc(chatRooms.createdAt),
    ],
    limit: limit,
    offset: offset,
    with: {
      product: true,
      order: {
        with: {
          delivery: true,
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
      lastMessageContent: sql<string>`(
        SELECT cm.content 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
        LIMIT 1
      )`.as("last_message_content"),
      lastMessageSenderType: sql<string>`(
        SELECT cm.sender_type 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
        LIMIT 1
      )`.as("last_message_sender_type"),
      lastMessageCreatedAt: sql<Date>`(
        SELECT cm.created_at 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
        LIMIT 1
      )`.as("last_message_created_at"),
    },
  });

  const rooms = roomsData.map((room) => {
    const {
      unreadCount,
      lastMessageContent,
      lastMessageSenderType,
      lastMessageCreatedAt,
      order,
      ...rest
    } = room;
    return {
      ...rest,
      totalUnread: Number(unreadCount),
      lastMessage: lastMessageContent
        ? {
            content: lastMessageContent,
            senderType:
              lastMessageSenderType as schema.ChatMessage["senderType"],
            createdAt: lastMessageCreatedAt,
          }
        : null,
      order: order
        ? {
            id: order.id,
            orderStatus: order.orderStatus,
            merchantTradeNo: order.merchantTradeNo,
            totalAmount: order.totalAmount,
            discountCoin: order.discountCoin,
            delivery: order?.delivery
              ? {
                  RtnCode: order.delivery.RtnCode,
                  RtnMsg: order.delivery.RtnMsg,
                }
              : null,
          }
        : null,
    };
  });

  return {
    rooms,
    total,
    page,
    limit,
    totalPages,
  };
}

export type ListAdminChatRoomsParams = {
  accountId: string;
  productId?: string;
  page?: number;
  limit?: number;
};

export async function listAdminChatRooms({
  accountId,
  productId,
  page = 1,
  limit = 20,
}: ListAdminChatRoomsParams) {
  const offset = (page - 1) * limit;
  const conditions: (SQL | undefined)[] = [];
  // Build the conditions for the query

  const isAdmin = await isAccountAdmin(accountId);
  if (!isAdmin) {
    conditions.push(eq(schema.chatRoomTable.accountId, accountId));
  }
  if (productId) {
    conditions.push(eq(schema.chatRoomTable.productId, productId));
  }

  // 1. Get the total count of chat rooms matching the criteria
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatRoomTable)
    .where(and(...conditions));

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // 2. Get the paginated list of chat rooms
  // We order by the last message's timestamp (prioritizing rooms with messages), then by room creation date.
  const roomsData = await db.query.chatRoomTable.findMany({
    where: and(...conditions),
    orderBy: (chatRooms, { desc }) => [
      sql`(SELECT cm.created_at FROM ${schema.chatMessageTable} cm 
           WHERE cm.chat_room_id = ${chatRooms.id} 
           ORDER BY cm.created_at DESC LIMIT 1) DESC NULLS LAST`,
      desc(chatRooms.createdAt),
    ],
    limit: limit,
    offset: offset,
    with: {
      user: true,
      order: {
        with: {
          delivery: true,
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
      lastMessageContent: sql<string>`(
        SELECT cm.content 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
        LIMIT 1
      )`.as("last_message_content"),
      lastMessageSenderType: sql<string>`(
        SELECT cm.sender_type 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
        LIMIT 1
      )`.as("last_message_sender_type"),
      lastMessageCreatedAt: sql<Date>`(
        SELECT cm.created_at 
        FROM ${schema.chatMessageTable} cm
        WHERE cm.chat_room_id = ${schema.chatRoomTable.id}
        ORDER BY cm.created_at DESC 
        LIMIT 1
      )`.as("last_message_created_at"),
    },
  });

  const rooms = roomsData.map((room) => {
    const {
      unreadCount,
      lastMessageContent,
      lastMessageSenderType,
      lastMessageCreatedAt,
      order,
      ...rest
    } = room;
    return {
      ...rest,
      totalUnread: Number(unreadCount),
      lastMessage: lastMessageContent
        ? {
            content: lastMessageContent,
            senderType:
              lastMessageSenderType as schema.ChatMessage["senderType"],
            createdAt: lastMessageCreatedAt,
          }
        : null,
      order: order
        ? {
            id: order.id,
            orderStatus: order.orderStatus,
            merchantTradeNo: order.merchantTradeNo,
            totalAmount: order.totalAmount,
            discountCoin: order.discountCoin,
            delivery: order?.delivery
              ? {
                  RtnCode: order.delivery.RtnCode,
                  RtnMsg: order.delivery.RtnMsg,
                }
              : null,
          }
        : null,
    };
  });

  return {
    rooms,
    total,
    page,
    limit,
    totalPages,
  };
}
