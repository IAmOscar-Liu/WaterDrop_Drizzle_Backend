import { Response } from "express";
import { RequestWithId } from "../type/request";
import { sendJsonResponse } from "../lib/general";
import service from "../services/notificationSync";
import { startNotificationStream } from "../services/notificationStream";
import { NotificationFilters } from "../repository/notificationSync";

function send(res: Response, result: Parameters<typeof sendJsonResponse>[1]) {
  if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "15");
  return sendJsonResponse(res, result);
}
export default {
  events: async (req: RequestWithId, res: Response) => {
    await startNotificationStream(res, req.userId ?? "", req.tokenExpiresAt, req.get("Last-Event-ID"));
  },
  list: async (req: RequestWithId, res: Response) => {
    const { page, limit, search, types, onlyUnread, snapshot, listSnapshot } = req.query;
    send(res, await service.list({ userId: req.userId ?? "", page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined, search: search === undefined ? undefined : String(search),
      types: (Array.isArray(types) ? types : typeof types === "string" ? [types] : undefined) as NotificationFilters["types"],
      onlyUnread: onlyUnread === "true", snapshot: snapshot === "true", listSnapshot: listSnapshot ? String(listSnapshot) : undefined }));
  },
  stats: async (req: RequestWithId, res: Response) => { send(res, await service.stats(req.userId ?? "")); },
  detail: async (req: RequestWithId, res: Response) => { send(res, await service.detail(req.userId ?? "", req.params.id)); },
  read: async (req: RequestWithId, res: Response) => { send(res, await service.read(req.userId ?? "", req.body.notificationIds)); },
  delete: async (req: RequestWithId, res: Response) => { send(res, await service.delete(req.userId ?? "", req.body.notificationIds)); },
};
