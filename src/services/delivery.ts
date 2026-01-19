import { handleServiceError } from "../lib/error";
import {
  updateDelivery,
  ListAdminDeliveriesParams,
  listAdminDeliveries,
  getDeliveryById,
  createDelivery,
} from "../repository/delivery";
import { ServiceResponse } from "../type/general";

class DeliveryService {
  async listAdminDeliveries(
    params: ListAdminDeliveriesParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminDeliveries>>>> {
    try {
      const deliveries = await listAdminDeliveries(params);
      if (deliveries) {
        return { success: true, data: deliveries };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "deliveries not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getDeliveryById(
    id: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getDeliveryById>>>> {
    try {
      const delivery = await getDeliveryById(id);
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

  async createDelivery(
    data: Parameters<typeof createDelivery>[0],
    productIds?: string[],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createDelivery>>>> {
    try {
      const delivery = await createDelivery(data, productIds);
      return { success: true, data: delivery };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateDelivery(
    deliveryId: string,
    updates: Parameters<typeof updateDelivery>[1],
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

export default new DeliveryService();
