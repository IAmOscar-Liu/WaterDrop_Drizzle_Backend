import { handleServiceError } from "../lib/error";
import {
  createRefund,
  getRefundById,
  getRefundList,
  GetRefundListParams,
  updateRefundItemStatus,
} from "../repository/refund";
import { ServiceResponse } from "../type/general";

class RefundService {
  async getRefundList(
    params: GetRefundListParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getRefundList>>>> {
    try {
      const refunds = await getRefundList(params);
      return { success: true, data: refunds };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getRefundById(
    refundItemId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getRefundById>>>> {
    try {
      const refund = await getRefundById(refundItemId);
      if (!refund) {
        return {
          success: false,
          statusCode: 404,
          message: "refund item not found",
        };
      }
      return { success: true, data: refund };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createRefund(
    item: Parameters<typeof createRefund>[0],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createRefund>>>> {
    try {
      const refund = await createRefund(item);
      return { success: true, data: refund };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateRefundItemStatus(
    refundItemId: string,
    updates: Parameters<typeof updateRefundItemStatus>[1],
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateRefundItemStatus>>>
  > {
    try {
      const refund = await updateRefundItemStatus(refundItemId, updates);
      return { success: true, data: refund };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new RefundService();
