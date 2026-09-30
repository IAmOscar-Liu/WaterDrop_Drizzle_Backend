import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import chatroomService from "../services/chatroom";
import { RequestWithId } from "../type/request";
import { ChatroomActor, ListAdminChatRoomsParams } from "../repository/chatroom";

// The mounted router selects the actor namespace, never the request body.
function chatroomActor(req: RequestWithId): ChatroomActor {
  return { kind: req.baseUrl === "/api/admin/chatroom" ? "account" : "user", id: req.userId ?? "" };
}

class ChatroomController {
  async findOrCreateChatRoom(req: RequestWithId, res: Response): Promise<any> {
    const { accountId, productId, productVariantId, orderId } = req.body;
    const result = await chatroomService.findOrCreateChatRoom({
      userId: req.userId ?? "",
      accountId: accountId ? String(accountId) : undefined,
      productId: productId ? String(productId) : undefined,
      productVariantId: productVariantId ? String(productVariantId) : undefined,
      orderId: orderId ? String(orderId) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getChatRoomById(req: RequestWithId, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const result = await chatroomService.getChatRoomById(
      chatRoomId ? String(chatRoomId) : "",
      chatroomActor(req),
    );
    sendJsonResponse(res, result);
  }

  async getChatHistory(req: RequestWithId, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { page, limit, startAt, endAt } = req.query;
    const result = await chatroomService.getChatHistory({
      actor: chatroomActor(req),
      chatRoomId: chatRoomId ? String(chatRoomId) : "",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      startAt: startAt
        ? new Date(typeof startAt === "number" ? startAt : String(startAt))
        : undefined,
      endAt: endAt
        ? new Date(typeof endAt === "number" ? endAt : String(endAt))
        : undefined,
    });
    sendJsonResponse(res, result);
  }

  async sendMessage(req: RequestWithId, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { senderType, content, attachments } = req.body;
    const result = await chatroomService.sendMessage({
      actor: chatroomActor(req),
      chatRoomId,
      senderType,
      content,
      attachments,
    });
    sendJsonResponse(res, result);
  }

  async markMessagesAsRead(req: RequestWithId, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { readerType } = req.body;
    const result = await chatroomService.markMessagesAsRead({
      actor: chatroomActor(req),
      chatRoomId,
      readerType,
    });
    sendJsonResponse(res, result);
  }

  async listChatRooms(req: RequestWithId, res: Response) {
    const { page, limit } = req.query;
    const result = await chatroomService.listChatRooms({
      userId: req.userId ?? "",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async listAdminChatRooms(req: RequestWithId, res: Response): Promise<any> {
    const { productId, productVariantId, status, page, limit, supportOnly } =
      req.query;
    const result = await chatroomService.listAdminChatRooms({
      accountId: req.userId ?? "",
      productId: productId ? String(productId) : undefined,
      productVariantId: productVariantId
        ? String(productVariantId)
        : undefined,
      status: status
        ? (String(status) as ListAdminChatRoomsParams["status"])
        : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      supportOnly: supportOnly === "true",
    });
    sendJsonResponse(res, result);
  }
}

export default new ChatroomController();
