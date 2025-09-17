import { handleServiceError } from "../lib/error";
import {
  findOrCreateChatRoom,
  getChatHistory,
  GetChatHistoryParams,
  markMessagesAsRead,
  sendChatMessage,
} from "../repository/chatroom";
import { ServiceResponse } from "../type/general";
import * as schema from "../db/schema";

class ChatroomService {
  async findOrCreateChatRoom({
    userId,
    accountId,
    productId,
  }: {
    userId: string;
    accountId: string;
    productId?: string | null;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof findOrCreateChatRoom>>>
  > {
    try {
      const chatRoom = await findOrCreateChatRoom(userId, accountId, productId);
      if (chatRoom) {
        return { success: true, data: chatRoom };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Chat room could not be created",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async sendMessage({
    chatRoomId,
    senderType,
    content,
  }: {
    chatRoomId: string;
    senderType: schema.ChatMessage["senderType"];
    content: string;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof sendChatMessage>>>> {
    try {
      const message = await sendChatMessage(chatRoomId, senderType, content);
      if (message) {
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

  async getChatHistory({
    chatRoomId,
    page = 1,
    limit = 20,
  }: GetChatHistoryParams): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getChatHistory>>>
  > {
    try {
      const chatHistory = await getChatHistory({ chatRoomId, page, limit });
      if (chatHistory) {
        return { success: true, data: chatHistory };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Chat history could not be retrieved",
        };
      }
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
      if (updatedMessages) {
        return { success: true, data: updatedMessages };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Messages could not be marked as read",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new ChatroomService();
