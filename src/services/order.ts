import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createOrder,
  getOrderById,
  listOrders,
  listAdminOrders,
  ListOrdersParams,
  ListAdminOrdersParams,
  updateOrderStatus,
  updateDelivery,
} from "../repository/order";
import { ServiceResponse } from "../type/general";

class OrderService {
  async listOrders(
    params: ListOrdersParams
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
    params: ListAdminOrdersParams
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
    id: string
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

  async createOrder({
    userId,
    items,
    totalAmount,
    discountCoin,
  }: {
    userId: string;
    items: schema.NewOrderItem[];
    totalAmount: number;
    discountCoin: number;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof createOrder>>>> {
    try {
      const order = await createOrder(
        {
          userId,
          totalAmount,
          discountCoin,
        },
        items
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
    metadata?: any
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

  async updateOrderDelivery(
    deliveryId: string,
    updates: Parameters<typeof updateDelivery>[1]
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof updateDelivery>>>> {
    try {
      const delivery = await updateDelivery(deliveryId, updates);
      if (delivery) {
        return { success: true, data: delivery };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "delivery not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new OrderService();
