import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createOrder,
  getOrderById,
  getOrdersByMerchantTradeNo,
  listOrders,
  listAdminOrders,
  ListOrdersParams,
  ListAdminOrdersParams,
  updateOrderStatus,
} from "../repository/order";
import { ServiceResponse } from "../type/general";

class OrderService {
  async listOrders(
    params: ListOrdersParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listOrders>>>> {
    try {
      const orders = await listOrders(params);
      if (orders) {
        return { success: true, data: orders };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "orders not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAdminOrders(
    params: ListAdminOrdersParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminOrders>>>> {
    try {
      const orders = await listAdminOrders(params);
      if (orders) {
        return { success: true, data: orders };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "orders not found",
        };
      }
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
          transactionFee,
          transactionFeeRateAtSale,
        },
        items,
      );
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
}

export default new OrderService();
