import { Request, Response } from "express";
import { sendJsonResponse } from "../lib/general";
import orderService from "../services/order";
import { RequestWithId } from "../type/request";
import * as schema from "../db/schema";

class OrderController {
  async listOrders(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, statusIn, order } = req.query;
    const result = await orderService.listOrders({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      userId: req.userId ?? "",
      statusIn: Array.isArray(statusIn)
        ? (statusIn as Exclude<schema.NewOrder["orderStatus"], undefined>[])
        : ["paid"],
      order: order === "asc" ? "asc" : "desc",
    });
    sendJsonResponse(res, result);
  }

  async createOrder(req: RequestWithId, res: Response): Promise<any> {
    const { items, totalAmount, discountCoin } = req.body;
    const result = await orderService.createOrder({
      userId: req.userId ?? "",
      items,
      totalAmount,
      discountCoin: discountCoin ? Number(discountCoin) : 0,
    });
    sendJsonResponse(res, result);
  }

  async getOrder(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await orderService.getOrderById(id);
    sendJsonResponse(res, result);
  }

  async updateOrderStatus(req: RequestWithId, res: Response): Promise<any> {
    const { orderId } = req.params;
    const { status } = req.body;
    const result = await orderService.updateOrderStatus(
      orderId,
      status as Exclude<schema.Order["orderStatus"], undefined>
    );
    sendJsonResponse(res, result);
  }
}

export default new OrderController();
