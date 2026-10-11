import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import { sendChatMessagePush } from "./chatroomNotification";
import {
  ChatroomActor,
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
    actor: ChatroomActor,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getChatRoomById>>>> {
    try {
      const chatRoom = await getChatRoomById(chatRoomId, actor);
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
    actor: ChatroomActor;
    chatRoomId: string;
    senderType: schema.ChatMessage["senderType"];
    content: string;
    attachments?: Omit<schema.NewChatMessageAttachment, "chatMessageId">[];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof sendChatMessage>>>> {
    try {
      const message = await sendChatMessage(input);
      if (message) {
        if (input.senderType !== "user")
          void this.sendMessagePushNotification(input);
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
      const chatroom = await getChatRoomById(input.chatRoomId, input.actor);
      if (!chatroom) throw new Error("Chat room not found");
      await sendChatMessagePush({ room: chatroom, senderType: input.senderType, content: input.content, attachments: input.attachments });
    } catch {
      console.error(`[chat-push] Room ${input.chatRoomId}: notification context unavailable; message remains saved.`);
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
    actor,
    chatRoomId,
    readerType,
  }: {
    actor: ChatroomActor;
    chatRoomId: string;
    readerType: schema.ChatMessage["senderType"];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof markMessagesAsRead>>>> {
    try {
      const updatedMessages = await markMessagesAsRead(chatRoomId, readerType, actor);
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
