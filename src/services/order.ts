import * as schema from "../db/schema";
import { CustomError, handleServiceError } from "../lib/error";
import { generateOrderCompletedEmailHtml } from "../lib/mailTemplate";
import { sendEmail } from "../lib/sendGrid";
import { sendMulticastPushNotification } from "../lib/sendNotification";
import { createNotification } from "../repository/notification";
import {
  createOrder,
  getOrderById,
  getOrdersByMerchantTradeNo,
  listAdminOrders,
  ListAdminOrdersParams,
  listOrders,
  ListOrdersParams,
  updateOrderStatus,
} from "../repository/order";
import { getFcmTokensInUserIds, getSimpleUserById } from "../repository/user";
import { ServiceResponse } from "../type/general";
class OrderService {
  async listOrders(
    params: ListOrdersParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listOrders>>>> {
    try {
      const orders = await listOrders(params);
      return { success: true, data: orders };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAdminOrders(
    params: ListAdminOrdersParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminOrders>>>> {
    try {
      const orders = await listAdminOrders(params);
      return { success: true, data: orders };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getOrderById(
    id: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getOrderById>>>> {
    try {
      const order = await getOrderById(id);
      if (order) {
        return { success: true, data: order };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "order not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getOrdersByMerchantTradeNo(
    merchantTradeNo: string,
    options?: { matchPrefix: boolean },
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getOrdersByMerchantTradeNo>>>
  > {
    try {
      const orders = await getOrdersByMerchantTradeNo(merchantTradeNo, options);
      return { success: true, data: orders };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createOrder({
    userId,
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
  }: {
    userId: string;
    items: schema.NewOrderItem[];
    subTotal: number;
    totalAmount: number;
    discountCoin: number;
    userLevelAtSale?: string;
    userMaxDiscountAtSale?: number;
    shippingCost?: number;
    shippingCostDeduction?: number;
    transactionFee?: number;
    transactionFeeRateAtSale?: number;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof createOrder>>>> {
    try {
      const order = await createOrder(
        {
          userId,
          subTotal,
          totalAmount,
          discountCoin,
          userLevelAtSale,
          userMaxDiscountAtSale,
          shippingCost,
          shippingCostDeduction,
          transactionFee,
          transactionFeeRateAtSale,
        },
        items,
      );
      return { success: true, data: order };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateOrderStatus(
    orderId: string,
    status: Exclude<schema.Order["orderStatus"], undefined>,
    metadata?: any,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof updateOrderStatus>>>> {
    try {
      const order = await updateOrderStatus(orderId, status, metadata);
      if (order) {
        return { success: true, data: order };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "order not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async sendOrderCompletedNotification({
    userId,
    orderId,
  }: {
    userId: string;
    orderId: string;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof createNotification>>>> {
    try {
      const [order, fcmTokens, simpleUser] = await Promise.all([
        getOrderById(orderId),
        getFcmTokensInUserIds([userId]),
        getSimpleUserById(userId),
      ]);
      if (!order) throw new CustomError("Order not found", 404);

      sendMulticastPushNotification({
        tokens: fcmTokens,
        notification: {
          title: "訂單建立通知",
          body: `您的訂單已成功建立(訂單編號: ${order.merchantTradeNo})`,
        },
        data: {
          command: "order_completed",
          orderId,
        },
      });

      if (simpleUser) {
        sendEmail({
          to: simpleUser.email,
          subject: `[水滴]訂單建立通知`,
          html: generateOrderCompletedEmailHtml({
            userName: simpleUser.name || "",
            merchantTradeNo: order.merchantTradeNo || "",
            orderId: order.id,
          }),
        });
      }

      const notification = await createNotification({
        userId,
        type: "order_status",
        title: "訂單建立通知",
        body: `您的訂單已成功建立(訂單編號: ${order.merchantTradeNo})，如有任何問題，請聯繫客服人員。`,
        orderId,
        metadata: {
          clickAction: "view_order_details",
        },
      });

      return { success: true, data: notification };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new OrderService();
