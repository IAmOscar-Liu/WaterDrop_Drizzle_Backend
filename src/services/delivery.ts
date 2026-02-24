import {
  HOME_DELIVERY_FEE,
  HOME_DELIVERY_REFRIG_FEE,
  OKMARTC2C_LOW_TMP_DELIVERY,
} from "../constants/delivery";
import { ECPAY_SHIPPING_FEE } from "../constants/ecpay";
import { handleServiceError } from "../lib/error";
import {
  ListAdminDeliveriesParams,
  createDelivery,
  getDeliveriesByMerchantTradeNo,
  getDeliveryById,
  listAdminDeliveries,
  updateDelivery,
  upsertShippingFee,
  getShippingFee,
  getShippingFeeByAccountIds,
} from "../repository/delivery";
import { ServiceResponse } from "../type/general";

class DeliveryService {
  async listAdminDeliveries(
    params: ListAdminDeliveriesParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminDeliveries>>>> {
    try {
      const deliveries = await listAdminDeliveries(params);
      return { success: true, data: deliveries };
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

  async getDeliveriesByMerchantTradeNo(
    merchantTradeNo: string,
    options?: { matchPrefix: boolean },
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getDeliveriesByMerchantTradeNo>>>
  > {
    try {
      const deliveries = await getDeliveriesByMerchantTradeNo(
        merchantTradeNo,
        options,
      );
      return { success: true, data: deliveries };
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

  async upsertShippingFee(
    accountId: string,
    data: Parameters<typeof upsertShippingFee>[1],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof upsertShippingFee>>>> {
    try {
      const shippingFee = await upsertShippingFee(accountId, data);
      return { success: true, data: shippingFee };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getShippingFee(
    accountId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getShippingFee>>>> {
    try {
      const shippingFee = await getShippingFee(accountId);
      if (!shippingFee) {
        return {
          success: false,
          statusCode: 404,
          message: "shipping fee not found",
        };
      }
      return { success: true, data: shippingFee };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getShippingFeeByAccountIds(
    accountIds: string[],
  ): Promise<
    ServiceResponse<
      Record<
        string,
        Omit<
          Awaited<ReturnType<typeof getShippingFeeByAccountIds>>[number],
          "id" | "accountId"
        > & { transactionFeeRate?: number }
      >
    >
  > {
    try {
      const shippingFees = await getShippingFeeByAccountIds(accountIds);
      const data = shippingFees.reduce(
        (acc, curr) => {
          const { id, accountId, ...rest } = curr;
          return { ...acc, [curr.accountId]: rest };
        },
        {} as Record<
          string,
          Omit<(typeof shippingFees)[number], "id" | "accountId"> & {
            transactionFeeRate?: number;
          }
        >,
      );
      data["default"] = {
        transactionFeeRate: Number(process.env.TRANSACTION_FEE_RATE),
        homeDelivery: HOME_DELIVERY_FEE,
        homeDeliveryRefrig: HOME_DELIVERY_REFRIG_FEE,
        OKMART_LOW_TMP_C2C: OKMARTC2C_LOW_TMP_DELIVERY,
        FAMIC2C: ECPAY_SHIPPING_FEE.FAMIC2C,
        UNIMARTC2C: ECPAY_SHIPPING_FEE.UNIMARTC2C,
        HILIFEC2C: ECPAY_SHIPPING_FEE.HILIFEC2C,
        OKMARTC2C: ECPAY_SHIPPING_FEE.OKMARTC2C,
      };
      return { success: true, data };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new DeliveryService();
