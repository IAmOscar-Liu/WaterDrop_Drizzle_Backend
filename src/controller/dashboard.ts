import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import dashboardService from "../services/dashboard";
import { RequestWithId } from "../type/request";

function filters(req: RequestWithId) {
  return {
    requesterId: req.userId ?? "",
    sellerId: req.query.sellerId ? String(req.query.sellerId) : undefined,
    startAt: req.query.startAt ? new Date(String(req.query.startAt)) : undefined,
    endAt: req.query.endAt ? new Date(String(req.query.endAt)) : undefined,
    timezone: req.query.timezone ? String(req.query.timezone) : undefined,
  };
}

class DashboardController {
  async kpi(req: RequestWithId, res: Response) {
    sendJsonResponse(res, await dashboardService.getKpi(filters(req)));
  }
  async timeSeries(req: RequestWithId, res: Response) {
    sendJsonResponse(
      res,
      await dashboardService.getTimeSeries({
        ...filters(req),
        metric: String(req.query.metric) as any,
        interval: String(req.query.interval ?? "day") as any,
      }),
    );
  }
  async pendingTasks(req: RequestWithId, res: Response) {
    sendJsonResponse(res, await dashboardService.getPendingTasks(filters(req)));
  }
  async recentActivities(req: RequestWithId, res: Response) {
    sendJsonResponse(
      res,
      await dashboardService.getRecentActivities({
        ...filters(req),
        cursor: req.query.cursor ? new Date(String(req.query.cursor)) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    );
  }
}

export default new DashboardController();
