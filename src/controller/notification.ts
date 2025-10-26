import { Response, Request } from "express";
import { sendJsonResponse } from "../lib/general";
import notificationService from "../services/notification";
import * as schema from "../db/schema";
import { RequestWithId } from "../type/request";

class NotificationController {
  async listNotifications(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, search, onlyUnread, types } = req.query;
    const result = await notificationService.listNotifications({
      userId: req.userId ?? "",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search ? String(search) : undefined,
      onlyUnread: onlyUnread === "true",
      types: Array.isArray(types)
        ? (types as schema.UserNotification["type"][])
        : typeof types === "string" && types.length > 0
        ? ([types] as schema.UserNotification["type"][])
        : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getNotification(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await notificationService.getNotificationById(id);
    sendJsonResponse(res, result);
  }

  async getNotificationStats(req: RequestWithId, res: Response): Promise<any> {
    const result = await notificationService.getNotificationStats(
      req.userId ?? ""
    );
    sendJsonResponse(res, result);
  }

  async markNotificationsAsRead(
    req: RequestWithId,
    res: Response
  ): Promise<any> {
    const { notificationIds } = req.body;
    const result = await notificationService.markNotificationsAsRead({
      userId: req.userId ?? "",
      notificationIds,
    });
    sendJsonResponse(res, result);
  }

  async deleteNotifications(req: Request, res: Response): Promise<any> {
    const { notificationIds } = req.body;
    const result = await notificationService.deleteNotifications(
      notificationIds
    );
    sendJsonResponse(res, result);
  }
}

export default new NotificationController();
