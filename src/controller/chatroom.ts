import { Request, Response } from "express";
import { sendJsonResponse } from "../lib/general";
import chatroomService from "../services/chatroom";
import { RequestWithId } from "../type/request";

class ChatroomController {
  async findOrCreateChatRoom(req: RequestWithId, res: Response): Promise<any> {
    const { accountId, productId } = req.body;
    const result = await chatroomService.findOrCreateChatRoom({
      userId: req.userId ?? "",
      accountId: accountId ? String(accountId) : "",
      productId: productId ? String(productId) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getChatHistory(req: Request, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { page, limit } = req.query;
    const result = await chatroomService.getChatHistory({
      chatRoomId: chatRoomId ? String(chatRoomId) : "",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async sendMessage(req: Request, res: Response): Promise<any> {
    const { chatRoomId } = req.params;
    const { senderType, content } = req.body;
    const result = await chatroomService.sendMessage({
      chatRoomId,
      senderType,
      content: content ? String(content) : "",
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

  async listAdminChatRooms(req: RequestWithId, res: Response): Promise<any> {
    const { productId, page, limit } = req.query;
    const result = await chatroomService.listAdminChatRooms({
      accountId: req.userId ?? "",
      productId: productId ? String(productId) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    sendJsonResponse(res, result);
  }
}

export default new ChatroomController();
