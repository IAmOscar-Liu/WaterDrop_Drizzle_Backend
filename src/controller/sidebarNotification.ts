import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import sidebarNotificationService from "../services/sidebarNotification";
import { RequestWithId } from "../type/request";

class SidebarNotificationController {
  async summary(req: RequestWithId, res: Response) {
    sendJsonResponse(
      res,
      await sidebarNotificationService.getSummary({
        requesterId: req.userId ?? "",
        sellerId: req.query.sellerId ? String(req.query.sellerId) : undefined,
      }),
    );
  }
  async markSeen(req: RequestWithId, res: Response) {
    sendJsonResponse(
      res,
      await sidebarNotificationService.markSeen({
        requesterId: req.userId ?? "",
        sellerId: req.body.sellerId,
        section: req.params.section as any,
        seenAt: req.body.seenAt ? new Date(req.body.seenAt) : undefined,
      }),
    );
  }
}

export default new SidebarNotificationController();
