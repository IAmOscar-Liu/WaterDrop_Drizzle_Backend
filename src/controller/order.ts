import { Request, Response } from "express";
import * as schema from "../db/schema";
import { sendJsonResponse } from "../lib/general";
import orderService from "../services/order";
import { RequestWithId } from "../type/request";

class OrderController {
  async listOrders(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, statusIn, order } = req.query;
    const result = await orderService.listOrders({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      userId: req.userId ?? "",
      statusIn: Array.isArray(statusIn)
        ? (statusIn as Exclude<schema.NewOrder["orderStatus"], undefined>[])
        : ["paid", "payment-processing"],
      order: order === "asc" ? "asc" : "desc",
    });
    sendJsonResponse(res, result);
  }

  async listAdminOrders(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, userId, status, order, startDate, endDate } =
      req.query;
    const result = await orderService.listAdminOrders({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      accountId: req.userId ?? "",
      userId: userId ? String(userId) : undefined,
      status: status
        ? (String(status) as schema.NewOrder["orderStatus"])
        : undefined,
      order: order === "asc" ? "asc" : "desc",
      startDate: startDate
        ? new Date(
            typeof startDate === "number" ? startDate : String(startDate),
          )
        : undefined,
      endDate: endDate
        ? new Date(typeof endDate === "number" ? endDate : String(endDate))
        : undefined,
    });
    sendJsonResponse(res, result);
  }

  async createOrder(req: RequestWithId, res: Response): Promise<any> {
    const {
      items,
      subTotal,
      totalAmount,
      discountCoin,
      userLevelAtSale,
      userMaxDiscountAtSale,
      shippingCost,
      shippingCostDeduction,
      transactionFee,
      transactionFeeRateAtSale,
      shippingInfo,
      orderPayment,
    } = req.body;
    const result = await orderService.createOrder({
      userId: req.userId ?? "",
      items,
      subTotal: Number(subTotal),
      totalAmount: Number(totalAmount),
      discountCoin: discountCoin ? Number(discountCoin) : 0,
      userLevelAtSale: userLevelAtSale ? String(userLevelAtSale) : undefined,
      userMaxDiscountAtSale: userMaxDiscountAtSale
        ? Number(userMaxDiscountAtSale)
        : undefined,
      shippingCost: shippingCost ? Number(shippingCost) : 0,
      shippingCostDeduction: shippingCostDeduction
        ? Number(shippingCostDeduction)
        : 0,
      transactionFee: transactionFee ? Number(transactionFee) : 0,
      transactionFeeRateAtSale: transactionFeeRateAtSale
        ? Number(transactionFeeRateAtSale)
        : undefined,
      shippingInfo: shippingInfo ? shippingInfo : undefined,
      orderPayment: orderPayment
        ? (String(orderPayment) as schema.Order["orderPayment"])
        : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getOrder(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await orderService.getOrderById(id);
    sendJsonResponse(res, result);
  }

  async getOrdersByMerchantTradeNo(req: Request, res: Response): Promise<any> {
    const { merchantTradeNo } = req.params;
    const result = await orderService.getOrdersByMerchantTradeNo(
      merchantTradeNo,
      {
        matchPrefix: true,
      },
    );
    sendJsonResponse(res, result);
  }

  async updateOrderStatus(req: Request, res: Response): Promise<any> {
    const { orderId } = req.params;
    const { status, metadata } = req.body;
    const result = await orderService.updateOrderStatus(
      orderId,
      status as Exclude<schema.Order["orderStatus"], undefined>,
      metadata,
    );
    sendJsonResponse(res, result);
  }

  async sendOrderCompletedNotification(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const { orderId } = req.body;
    const result = await orderService.sendOrderCompletedNotification({
      userId: req.userId ?? "",
      orderId,
    });
    sendJsonResponse(res, result);
  }
}

export default new OrderController();
