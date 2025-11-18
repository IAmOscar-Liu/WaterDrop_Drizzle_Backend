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
      activeProductOnly: true,
    });
    sendJsonResponse(res, result);
  }

  async listAdminAdvertisements(req: Request, res: Response): Promise<any> {
    const { page, limit } = req.query;
    const result = await advertisementService.listAdvertisements({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      shuffle: false,
      activeProductOnly: false,
    });
    sendJsonResponse(res, result);
  }

  async createAdvertisement(req: Request, res: Response): Promise<any> {
    const advertisementData = req.body;
    const result = await advertisementService.createAdvertisement(
      advertisementData
    );
    sendJsonResponse(res, result);
  }

  async updateAdvertisement(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const advertisementData = req.body;
    const result = await advertisementService.updateAdvertisement(
      id,
      advertisementData
    );
    sendJsonResponse(res, result);
  }

  async getAdViewCount(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const { startAt, endAt } = req.query;
    const result = await advertisementService.getAdViewCount({
      advertisementId: id,
      startAt: startAt
        ? new Date(typeof startAt === "number" ? startAt : String(startAt))
        : undefined,
      endAt: endAt
        ? new Date(typeof endAt === "number" ? endAt : String(endAt))
        : undefined,
    });
    sendJsonResponse(res, result);
  }
}

export default new AdvertisementController();
