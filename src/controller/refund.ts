import { Request, Response } from "express";
import * as schema from "../db/schema";
import { sendJsonResponse } from "../lib/general";
import { GetRefundListParams } from "../repository/refund";
import refundService from "../services/refund";

class RefundController {
  async getRefundList(req: Request, res: Response): Promise<any> {
    const { page, limit, userId, productId, startAt, endAt, status } =
      req.query;

    const result = await refundService.getRefundList({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      userId: userId ? String(userId) : undefined,
      productId: productId ? String(productId) : undefined,
      startAt: startAt ? new Date(String(startAt)) : undefined,
      endAt: endAt ? new Date(String(endAt)) : undefined,
      status: status
        ? (String(status) as GetRefundListParams["status"])
        : undefined,
    });

    sendJsonResponse(res, result);
  }

  async getRefundById(req: Request, res: Response): Promise<any> {
    const { refundItemId } = req.params;
    const result = await refundService.getRefundById(refundItemId);
    sendJsonResponse(res, result);
  }

  async createRefund(req: Request, res: Response): Promise<any> {
    const { orderItemId, quantity, reason, note, refundAmount, metadata } =
      req.body;

    const result = await refundService.createRefund({
      orderItemId,
      quantity,
      reason: reason ?? "",
      note,
      refundAmount,
      metadata,
    });

    sendJsonResponse(res, result);
  }

  async updateRefundItemStatus(req: Request, res: Response): Promise<any> {
    const { refundItemId } = req.params;
    const { status } = req.body;
    const result = await refundService.updateRefundItemStatus(
      refundItemId,
      status as schema.RefundItem["status"],
    );
    sendJsonResponse(res, result);
  }
}

export default new RefundController();
