import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createAdvertisement,
  depositAdBalance,
  getAdvertisement,
  getAdViewCount,
  listAdminAdvertisements,
  ListAdminAdvertisementsParams,
  listAdvertisements,
  ListAdvertisementsParams,
  listAdViewCount,
  ListAdViewCountParams,
  setAdStatus,
  updateAdvertisementById,
} from "../repository/advertisement";
import { ServiceResponse } from "../type/general";

class AdvertisementService {
  async listAdvertisements(
    params: ListAdvertisementsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdvertisements>>>> {
    try {
      const advertisements = await listAdvertisements(params); // Replace with real data fetching logic
      return { success: true, data: advertisements };
    } catch (error) {
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
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getAdvertisement>>>> {
    try {
      const advertisement = await getAdvertisement(advertisementId);

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

  async createAdvertisement(
    advertisementData: schema.NewAdvertisement,
  ): Promise<ServiceResponse<schema.Advertisement>> {
    try {
      const advertisement = await createAdvertisement(advertisementData);
      return { success: true, data: advertisement };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateAdvertisement(
    advertisementId: string,
    advertisementData: Partial<Omit<schema.NewAdvertisement, "id">>,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateAdvertisementById>>>
  > {
    try {
      const advertisement = await updateAdvertisementById(
        advertisementId,
        advertisementData,
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
    amount: number;
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
  }: {
    advertisementId: string;
    status: schema.AdvertisementStats["status"];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof setAdStatus>>>> {
    try {
      const result = await setAdStatus(advertisementId, status);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new AdvertisementService();
