import { and, count, eq, isNull, ne } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";

/**
 * Finds an existing chat room or creates a new one.
 * This is a robust "get or create" pattern that prevents duplicate rooms.
 *
 * @param userId The ID of the user.
 * @param accountId The ID of the admin or seller.
 * @param productId Optional ID of the product the chat is about.
 * @returns The existing or newly created chat room.
 */
export async function findOrCreateChatRoom(
  userId: string,
  accountId: string,
  productId?: string | null
) {
  // 1. Try to find an existing chat room
  const existingRoom = await db.query.chatRoomTable.findFirst({
    where: and(
      eq(schema.chatRoomTable.userId, userId),
      eq(schema.chatRoomTable.accountId, accountId),
      productId
        ? eq(schema.chatRoomTable.productId, productId)
        : isNull(schema.chatRoomTable.productId)
    ),
  });

  if (existingRoom) {
    console.log("Found existing chat room:", existingRoom.id);
    return existingRoom;
  }

  // 2. If not found, create a new one
  console.log("No chat room found, creating a new one...");
  const [newRoom] = await db
    .insert(schema.chatRoomTable)
    .values({ userId, accountId, productId: productId ?? null })
    .returning();

  console.log("New chat room created:", newRoom.id);
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
}: GetChatHistoryParams) {
  const offset = (page - 1) * limit;

  // Query for total count of messages in the room
  const totalResult = await db
    .select({ total: count() })
    .from(schema.chatMessageTable)
    .where(eq(schema.chatMessageTable.chatRoomId, chatRoomId));

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated messages, sorted by most recent first
  const messages = await db.query.chatMessageTable.findMany({
    where: eq(schema.chatMessageTable.chatRoomId, chatRoomId),
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
  console.log(
    `Marking messages in room ${chatRoomId} as read for ${readerType}.`
  );
  return db
    .update(schema.chatMessageTable)
    .set({ isRead: true })
    .where(
      and(
        eq(schema.chatMessageTable.chatRoomId, chatRoomId),
        ne(schema.chatMessageTable.senderType, readerType), // Mark messages from the *other* party
        eq(schema.chatMessageTable.isRead, false) // Only update unread messages
      )
    )
    .returning();
}
