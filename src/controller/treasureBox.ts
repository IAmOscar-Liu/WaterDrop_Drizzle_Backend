import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import treasureBoxService from "../services/treasureBox";
import { RequestWithId } from "../type/request";

class TreasureBoxController {
  async listTreasureBoxes(req: RequestWithId, res: Response): Promise<any> {
    const result = await treasureBoxService.listTreasureBoxes(req.userId ?? "");
    sendJsonResponse(res, result);
  }

  async processVideoCompletion(
    req: RequestWithId,
    res: Response
  ): Promise<any> {
    const { advertisementId } = req.body;
    const result = await treasureBoxService.processVideoCompletion({
      userId: req.userId ?? "",
      advertisementId: advertisementId ? String(advertisementId) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async openTreasureBox(req: RequestWithId, res: Response): Promise<any> {
    const { treasureBoxId } = req.params;
    const result = await treasureBoxService.openTreasureBox({
      userId: req.userId ?? "",
      treasureBoxId,
    });
    sendJsonResponse(res, result);
  }
}

export default new TreasureBoxController();
