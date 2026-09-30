import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createAdvertisement,
  depositAdBalance,
  financiallyCloseAdvertisement,
  getAdvertisement,
  getAdvertisementCoinLedger,
  getAdViewCount,
  listAdminAdvertisements,
  ListAdminAdvertisementsParams,
  listAdvertisements,
  ListAdvertisementsParams,
  listAdViewCount,
  ListAdViewCountParams,
  listPlatformAdViewCount,
  ListPlatformAdViewCountParams,
  setAdStatus,
  transferArchivedAdvertisementBalance,
  updateAdvertisementById,
  adjustAdBudget,
} from "../repository/advertisement";
import { ServiceResponse } from "../type/general";
import {
  getProductAdvertisementDashboard,
  listAdvertisementMetrics,
} from "../repository/advertisementReport";

class AdvertisementService {
  async listMetrics(input: Parameters<typeof listAdvertisementMetrics>[0]) {
    try {
      return { success: true as const, data: await listAdvertisementMetrics(input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getProductDashboard(input: Parameters<typeof getProductAdvertisementDashboard>[0]) {
    try {
      return {
        success: true as const,
        data: await getProductAdvertisementDashboard(input),
      };
    } catch (error) {
      return handleServiceError(error);
    }
  }
  async adjustAdBudget(input: Parameters<typeof adjustAdBudget>[0]) {
    try {
      return { success: true as const, data: await adjustAdBudget(input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }
  async listAdvertisements(
    params: ListAdvertisementsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdvertisements>>>> {
    try {
      const advertisements = await listAdvertisements(params); // Replace with real data fetching logic
      return { success: true, data: advertisements };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async listAdminAdvertisements(
    params: ListAdminAdvertisementsParams,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof listAdminAdvertisements>>>
  > {
    try {
      const advertisements = await listAdminAdvertisements(params); // Replace with real data fetching logic
      return { success: true, data: advertisements };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getAdvertisement(
    advertisementId: string,
    requesterId?: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getAdvertisement>>>> {
    try {
      const advertisement = await getAdvertisement(advertisementId, requesterId);

      if (!advertisement) {
        return {
          success: false,
          statusCode: 404,
          message: "Advertisement not found",
        };
      }
      return { success: true, data: advertisement };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getAdvertisementCoinLedger(advertisementId: string, requesterId: string) {
    try {
      const result = await getAdvertisementCoinLedger(
        advertisementId,
        requesterId,
      );
      return { success: true as const, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createAdvertisement(
    advertisementData: schema.NewAdvertisement,
    requesterId?: string,
  ): Promise<ServiceResponse<schema.Advertisement>> {
    try {
      const advertisement = await createAdvertisement(
        advertisementData,
        requesterId,
      );
      return { success: true, data: advertisement };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateAdvertisement(
    advertisementId: string,
    advertisementData: Partial<Omit<schema.NewAdvertisement, "id">>,
    requesterId?: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateAdvertisementById>>>
  > {
    try {
      const advertisement = await updateAdvertisementById(
        advertisementId,
        advertisementData,
        requesterId,
      );
      if (advertisement) {
        return { success: true, data: advertisement };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "advertisement not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getAdViewCount(input: {
    advertisementId: string;
    requesterId: string;
    startAt?: Date;
    endAt?: Date;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof getAdViewCount>>>> {
    try {
      const count = await getAdViewCount(input);
      return { success: true, data: count };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listPlatformAdViewCount(
    input: ListPlatformAdViewCountParams,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof listPlatformAdViewCount>>>
  > {
    try {
      const count = await listPlatformAdViewCount(input);
      return { success: true, data: count };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAdViewCount(
    input: ListAdViewCountParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdViewCount>>>> {
    try {
      const count = await listAdViewCount(input);
      return { success: true, data: count };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async depositAdBalance(input: {
    advertisementId: string;
    requesterId: string;
    amount: string;
    idempotencyKey: string;
    metadata?: Record<string, any>;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof depositAdBalance>>>> {
    try {
      const result = await depositAdBalance(input);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async setAdStatus({
    advertisementId,
    status,
    requesterId,
  }: {
    advertisementId: string;
    status: schema.AdvertisementStats["status"];
    requesterId: string;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof setAdStatus>>>> {
    try {
      const result = await setAdStatus(advertisementId, status, requesterId);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async financiallyCloseAdvertisement(
    advertisementId: string,
    requesterId: string,
  ) {
    try {
      const result = await financiallyCloseAdvertisement(
        advertisementId,
        requesterId,
      );
      return { success: true as const, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async transferArchivedAdvertisementBalance(
    params: Parameters<typeof transferArchivedAdvertisementBalance>[0],
  ) {
    try {
      const result = await transferArchivedAdvertisementBalance(params);
      return { success: true as const, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new AdvertisementService();
