import { handleServiceError } from "../lib/error";
import {
  listAdvertisements,
  ListAdvertisementsParams,
} from "../repository/advertisement";
import { ServiceResponse } from "../type/general";

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
}

export default new AdvertisementService();
