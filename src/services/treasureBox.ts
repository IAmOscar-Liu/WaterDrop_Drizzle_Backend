import { handleServiceError } from "../lib/error";
import {
  getTreasureBoxesByUserId,
  openTreasureBox,
  processVideoCompletion,
} from "../repository/treasureBox";
import { ServiceResponse } from "../type/general";

class TreasureBoxService {
  async listTreasureBoxes(
    userId: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getTreasureBoxesByUserId>>>
  > {
    try {
      const result = await getTreasureBoxesByUserId(userId);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async processVideoCompletion({
    userId,
    advertisementId,
  }: {
    userId: string;
    advertisementId?: string;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof processVideoCompletion>>>
  > {
    try {
      const result = await processVideoCompletion(userId, advertisementId);
      if (result) {
        return { success: true, data: result };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Could not process video completion",
        };
      }
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async openTreasureBox({
    userId,
    treasureBoxId,
  }: {
    userId: string;
    treasureBoxId: string;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof openTreasureBox>>>> {
    try {
      const result = await openTreasureBox(userId, treasureBoxId);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new TreasureBoxService();
