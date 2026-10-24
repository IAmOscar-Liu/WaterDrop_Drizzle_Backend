import { Response } from "express";
import { RequestWithId } from "../type/request";
import { sendJsonResponse } from "../lib/general";
import { getAppBadge } from "../services/appBadge";

export async function badge(req: RequestWithId, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  sendJsonResponse(res, await getAppBadge(req.userId ?? ""));
}
