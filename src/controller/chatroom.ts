import { Request, Response } from "express";
import { sendJsonResponse } from "../lib/general";
import chatroomService from "../services/chatroom";
import { RequestWithId } from "../type/request";
import { ListAdminChatRoomsParams } from "../repository/chatroom";

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

  async getChatRoomById(req: Request, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const result = await chatroomService.getChatRoomById(
      chatRoomId ? String(chatRoomId) : "",
    );
    sendJsonResponse(res, result);
  }

  async getChatHistory(req: Request, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { page, limit, startAt, endAt } = req.query;
    const result = await chatroomService.getChatHistory({
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

  async sendMessage(req: Request, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { senderType, content, attachments } = req.body;
    const result = await chatroomService.sendMessage({
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
