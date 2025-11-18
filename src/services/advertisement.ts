import { handleServiceError } from "../lib/error";
import {
  listAdvertisements,
  ListAdvertisementsParams,
  createAdvertisement,
  updateAdvertisementById,
  getAdViewCount,
} from "../repository/advertisement";
import { ServiceResponse } from "../type/general";
import * as schema from "../db/schema";

class AdvertisementService {
  async listAdvertisements(
    params: ListAdvertisementsParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdvertisements>>>> {
    try {
      const advertisements = await listAdvertisements(params); // Replace with real data fetching logic
      if (advertisements) {
        return { success: true, data: advertisements };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "advertisements not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createAdvertisement(
    advertisementData: schema.NewAdvertisement
  ): Promise<ServiceResponse<schema.Advertisement>> {
    try {
      const advertisement = await createAdvertisement(advertisementData);
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

  async updateAdvertisement(
    advertisementId: string,
    advertisementData: Partial<Omit<schema.NewAdvertisement, "id">>
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateAdvertisementById>>>
  > {
    try {
      const advertisement = await updateAdvertisementById(
        advertisementId,
        advertisementData
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
}

export default new AdvertisementService();
