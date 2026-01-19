import { Request, Response } from "express";
import { sendJsonResponse } from "../lib/general";
import deliveryService from "../services/delivery";
import { RequestWithId } from "../type/request";
import ecpayService from "../services/ecpay";

class DeliveryController {
  async listAdminDeliveries(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit } = req.query;
    const result = await deliveryService.listAdminDeliveries({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      accountId: req.userId ?? "",
    });
    sendJsonResponse(res, result);
  }

  async createDelivery(req: Request, res: Response): Promise<any> {
    const { merchantTradeNo, productIds, ...rest } = req.body;
    const result = await deliveryService.createDelivery(
      {
        ...rest,
        merchantTradeNo:
          typeof merchantTradeNo === "string"
            ? merchantTradeNo
            : ecpayService.generateTradeNo(),
      },
      productIds,
    );
    sendJsonResponse(res, result);
  }

  async getDelivery(req: Request, res: Response): Promise<any> {
    const { deliveryId } = req.params;
    const result = await deliveryService.getDeliveryById(deliveryId);
    sendJsonResponse(res, result);
  }

  async updateDelivery(req: Request, res: Response): Promise<any> {
    const { deliveryId } = req.params;
    const result = await deliveryService.updateDelivery(deliveryId, req.body);
    sendJsonResponse(res, result);
  }
}

export default new DeliveryController();
