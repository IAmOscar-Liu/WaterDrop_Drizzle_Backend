import { handleServiceError } from "../lib/error";
import {
  getTreasureBoxesByUserId,
  openTreasureBox,
  processVideoCompletion,
} from "../repository/treasureBox";
import { ServiceResponse } from "../type/general";

class TreasureBoxService {
  async listTreasureBoxes(
    userId: string
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getTreasureBoxesByUserId>>>
  > {
    try {
      const result = await getTreasureBoxesByUserId(userId);
      if (result) {
        return { success: true, data: result };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Could not retrieve treasure boxes",
        };
      }
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
      if (result) {
        return { success: true, data: result };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Could not open treasure box",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new TreasureBoxService();
