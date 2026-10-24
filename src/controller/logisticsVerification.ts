import type { Response } from "express";
import type { RequestWithId } from "../type/request";
import { sendJsonResponse } from "../lib/general";
import { verifyTestLogistics } from "../services/logisticsVerification";

export async function validateTestLogistics(req: RequestWithId, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const result = await verifyTestLogistics(req.userId ?? "", req.sessionId, req.body);
  if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "60");
  sendJsonResponse(res, result);
}

// Test status notifications are intentionally a no-op. They never create deliveries
// or change validation results; only the direct HTTPS response is consumed.
export function acknowledgeTestValidation(_req: RequestWithId, res: Response) {
  res.type("text/plain").send("1|OK");
}
