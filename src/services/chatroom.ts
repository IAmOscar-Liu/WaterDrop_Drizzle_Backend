import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import { sendMulticastPushNotification } from "../lib/sendNotification";
import {
  findOrCreateChatRoom,
  getChatHistory,
  GetChatHistoryParams,
  getChatRoomById,
  listAdminChatRooms,
  ListAdminChatRoomsParams,
  listChatRooms,
  ListChatRoomsParams,
  markMessagesAsRead,
  sendChatMessage,
} from "../repository/chatroom";
import { getFcmTokensInUserIds } from "../repository/user";
import { ServiceResponse } from "../type/general";

class ChatroomService {
  async findOrCreateChatRoom(input: {
    userId: string;
    accountId?: string;
    productId?: string | null;
    productVariantId?: string | null;
    orderId?: string | null;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof findOrCreateChatRoom>>>
  > {
    try {
      const chatRoom = await findOrCreateChatRoom(input);
      return { success: true, data: chatRoom };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getChatRoomById(
    chatRoomId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getChatRoomById>>>> {
    try {
      const chatRoom = await getChatRoomById(chatRoomId);
      if (chatRoom) {
        return { success: true, data: chatRoom };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Chat room not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async sendMessage(input: {
    chatRoomId: string;
    senderType: schema.ChatMessage["senderType"];
    content: string;
    attachments?: Omit<schema.NewChatMessageAttachment, "chatMessageId">[];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof sendChatMessage>>>> {
    try {
      const message = await sendChatMessage(input);
      if (message) {
        if (input.senderType !== "user")
          this.sendMessagePushNotification(input);
        return { success: true, data: message };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Message could not be sent",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  private async sendMessagePushNotification(
    input: Parameters<typeof sendChatMessage>[0],
  ) {
    try {
      const chatroom = await getChatRoomById(input.chatRoomId);
      if (!chatroom) throw new Error("Chat room not found");
      if (!chatroom.product) throw new Error("Product not found in chat room");

      const getChatMessage = () => {
        if (input.content) return input.content;
        if (input.attachments && input.attachments.length > 0) {
          return `${input.attachments.length}個附件`;
        }
        return null;
      };

      const notificationBody = getChatMessage();
      if (!notificationBody)
        throw new Error("No content to send in notification");

      const fcmTokens = await getFcmTokensInUserIds([chatroom.userId]);
      if (fcmTokens.length === 0)
        throw new Error("No FCM tokens found for user");

      sendMulticastPushNotification({
        tokens: fcmTokens,
        notification: {
          title: chatroom.product.name,
          body: `賣家: ${notificationBody}`,
        },
        data: {
          command: "chat_message",
          chatRoomId: input.chatRoomId,
        },
      });
    } catch (error) {
      console.error("Error sending push notification:", error);
    }
  }

  async getChatHistory(
    query: GetChatHistoryParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getChatHistory>>>> {
    try {
      const chatHistory = await getChatHistory(query);
      return { success: true, data: chatHistory };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async markMessagesAsRead({
    chatRoomId,
    readerType,
  }: {
    chatRoomId: string;
    readerType: schema.ChatMessage["senderType"];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof markMessagesAsRead>>>> {
    try {
      const updatedMessages = await markMessagesAsRead(chatRoomId, readerType);
      return { success: true, data: updatedMessages };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listChatRooms(
    query: ListChatRoomsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listChatRooms>>>> {
    try {
      const chatRooms = await listChatRooms(query);
      return { success: true, data: chatRooms };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAdminChatRooms(
    query: ListAdminChatRoomsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminChatRooms>>>> {
    try {
      const chatRooms = await listAdminChatRooms(query);
      return { success: true, data: chatRooms };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new ChatroomService();
