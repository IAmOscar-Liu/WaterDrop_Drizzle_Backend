import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import adminChatroomSyncService from "../services/adminChatroomSync";
import { RequestWithId } from "../type/request";

class AdminChatroomSyncController {
  async events(req: RequestWithId, res: Response) {
    await adminChatroomSyncService.events(res, req.userId ?? "", req.tokenExpiresAt, req.get("Last-Event-ID"));
  }

  async history(req: RequestWithId, res: Response) {
    const { page, limit, before, startAt, endAt } = req.query;
    sendJsonResponse(res, await adminChatroomSyncService.history({
      actor: { kind: "account", id: req.userId ?? "" },
      chatRoomId: String(req.params.chatRoomId),
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      before: before ? String(before) : undefined,
      startAt: startAt ? new Date(String(startAt)) : undefined,
      endAt: endAt ? new Date(String(endAt)) : undefined,
    }));
  }

  async list(req: RequestWithId, res: Response) {
    const { page, limit, snapshot, listSnapshot, productId, productVariantId, supportOnly } = req.query;
    sendJsonResponse(res, await adminChatroomSyncService.list({
      accountId: req.userId ?? "",
      productId: productId ? String(productId) : undefined,
      productVariantId: productVariantId ? String(productVariantId) : undefined,
      supportOnly: supportOnly === "true",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      snapshot: snapshot === "true",
      listSnapshot: listSnapshot ? String(listSnapshot) : undefined,
    }));
  }

  async send(req: RequestWithId, res: Response) {
    const { senderType, content, attachments, clientMessageId } = req.body;
    sendJsonResponse(res, await adminChatroomSyncService.send({
      actor: { kind: "account", id: req.userId ?? "" },
      chatRoomId: String(req.params.chatRoomId),
      senderType, content, attachments, clientMessageId,
    }));
  }

  async read(req: RequestWithId, res: Response) {
    sendJsonResponse(res, await adminChatroomSyncService.read(String(req.params.chatRoomId), req.userId ?? "", req.body.readerType));
  }
}

export default new AdminChatroomSyncController();
