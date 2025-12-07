import { Request, Response } from "express";
import advertisementService from "../services/advertisement";
import { sendJsonResponse } from "../lib/general";
import { RequestWithId } from "../type/request";

class AdvertisementController {
  async listAdvertisements(req: Request, res: Response): Promise<any> {
    const { page, limit } = req.query;
    const result = await advertisementService.listAdvertisements({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async listAdminAdvertisements(
    req: RequestWithId,
    res: Response
  ): Promise<any> {
    const { page, limit } = req.query;
    const result = await advertisementService.listAdminAdvertisements({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sellerId: req.userId ?? "",
    });
    sendJsonResponse(res, result);
  }

  async getAdvertisement(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await advertisementService.getAdvertisement(id);
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

  async depositAdBalance(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const { amount, metadata } = req.body;
    const result = await advertisementService.depositAdBalance({
      advertisementId: id,
      amount,
      metadata,
    });
    sendJsonResponse(res, result);
  }

  async setAdStatus(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const { status } = req.body;
    const result = await advertisementService.setAdStatus({
      advertisementId: id,
      status,
    });
    sendJsonResponse(res, result);
  }
}

export default new AdvertisementController();
