import { handleServiceError } from "../lib/error";
import {
  findOrCreateChatRoom,
  getChatHistory,
  GetChatHistoryParams,
  listChatRooms,
  ListChatRoomsParams,
  listAdminChatRooms,
  ListAdminChatRoomsParams,
  markMessagesAsRead,
  sendChatMessage,
} from "../repository/chatroom";
import { ServiceResponse } from "../type/general";
import * as schema from "../db/schema";

class ChatroomService {
  async findOrCreateChatRoom(input: {
    userId: string;
    accountId: string;
    productId?: string | null;
    orderId?: string | null;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof findOrCreateChatRoom>>>
  > {
    try {
      const chatRoom = await findOrCreateChatRoom(input);
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

  async sendMessage(input: {
    chatRoomId: string;
    senderType: schema.ChatMessage["senderType"];
    content: string;
    attachments?: Omit<schema.NewChatMessageAttachment, "chatMessageId">[];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof sendChatMessage>>>> {
    try {
      const message = await sendChatMessage(input);
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

  async getChatHistory(
    query: GetChatHistoryParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getChatHistory>>>> {
    try {
      const chatHistory = await getChatHistory(query);
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

  async listChatRooms(
    query: ListChatRoomsParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listChatRooms>>>> {
    try {
      const chatRooms = await listChatRooms(query);
      if (chatRooms) {
        return { success: true, data: chatRooms };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Chat rooms could not be retrieved",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAdminChatRooms(
    query: ListAdminChatRoomsParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminChatRooms>>>> {
    try {
      const chatRooms = await listAdminChatRooms(query);
      if (chatRooms) {
        return { success: true, data: chatRooms };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Chat rooms could not be retrieved",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new ChatroomService();
