import { Request, Response } from "express";
import advertisementService from "../services/advertisement";
import { sendJsonResponse } from "../lib/general";

class AdvertisementController {
  async listAdvertisements(req: Request, res: Response): Promise<any> {
    const { page, limit } = req.query;
    const result = await advertisementService.listAdvertisements({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      shuffle: true,
    });
    sendJsonResponse(res, result);
  }
}

export default new AdvertisementController();
