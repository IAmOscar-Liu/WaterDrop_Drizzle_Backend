import { Request, Response } from "express";
import advertisementService from "../services/advertisement";
import { sendJsonResponse } from "../lib/general";
import { RequestWithId } from "../type/request";

class AdvertisementController {
  async listMetrics(req: RequestWithId, res: Response): Promise<any> {
    const result = await advertisementService.listMetrics({
      requesterId: req.userId ?? "",
      sellerId: req.query.sellerId ? String(req.query.sellerId) : undefined,
      productId: req.query.productId ? String(req.query.productId) : undefined,
      status: req.query.status as any,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      startAt: req.query.startAt ? new Date(String(req.query.startAt)) : undefined,
      endAt: req.query.endAt ? new Date(String(req.query.endAt)) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getProductDashboard(req: RequestWithId, res: Response): Promise<any> {
    const result = await advertisementService.getProductDashboard({
      requesterId: req.userId ?? "",
      productId: req.params.productId,
      startAt: req.query.startAt ? new Date(String(req.query.startAt)) : undefined,
      endAt: req.query.endAt ? new Date(String(req.query.endAt)) : undefined,
    });
    sendJsonResponse(res, result);
  }
  async listAdvertisements(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit } = req.query;
    const result = await advertisementService.listAdvertisements({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      userId: req.userId,
    });
    sendJsonResponse(res, result);
  }

  async listAdminAdvertisements(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const { page, limit, sellerId } = req.query;
    const result = await advertisementService.listAdminAdvertisements({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      requesterId: req.userId ?? "",
      sellerId: sellerId ? String(sellerId) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getAdvertisement(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await advertisementService.getAdvertisement(
      id,
      req.userId,
    );
    sendJsonResponse(res, result);
  }

  async getAdvertisementCoinLedger(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const result = await advertisementService.getAdvertisementCoinLedger(
      req.params.id,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async createAdvertisement(req: RequestWithId, res: Response): Promise<any> {
    const advertisementData = req.body;
    const result =
      await advertisementService.createAdvertisement(
        advertisementData,
        req.userId,
      );
    sendJsonResponse(res, result);
  }

  async updateAdvertisement(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const advertisementData = req.body;
    const result = await advertisementService.updateAdvertisement(
      id,
      advertisementData,
      req.userId,
    );
    sendJsonResponse(res, result);
  }

  async getAdViewCount(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const { startAt, endAt } = req.query;
    const result = await advertisementService.getAdViewCount({
      advertisementId: id,
      requesterId: req.userId ?? "",
      startAt: startAt
        ? new Date(typeof startAt === "number" ? startAt : String(startAt))
        : undefined,
      endAt: endAt
        ? new Date(typeof endAt === "number" ? endAt : String(endAt))
        : undefined,
    });
    sendJsonResponse(res, result);
  }

  async listPlatformAdViewCount(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const { page, limit, sellerId, startAt, endAt } = req.query;
    const result = await advertisementService.listPlatformAdViewCount({
      requesterId: req.userId ?? "",
      sellerId: sellerId ? String(sellerId) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      startAt: startAt ? new Date(String(startAt)) : undefined,
      endAt: endAt ? new Date(String(endAt)) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async listAdViewCount(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, startAt, endAt } = req.query;
    const result = await advertisementService.listAdViewCount({
      sellerId: req.userId ?? "",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      startAt: startAt
        ? new Date(typeof startAt === "number" ? startAt : String(startAt))
        : undefined,
      endAt: endAt
        ? new Date(typeof endAt === "number" ? endAt : String(endAt))
        : undefined,
    });
    sendJsonResponse(res, result);
  }

  async depositAdBalance(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const { amount, idempotencyKey, metadata } = req.body;
    const result = await advertisementService.depositAdBalance({
      advertisementId: id,
      requesterId: req.userId ?? "",
      amount,
      idempotencyKey,
      metadata,
    });
    sendJsonResponse(res, result);
  }

  async adjustAdBudget(req: RequestWithId, res: Response): Promise<any> {
    const { operation, amount, idempotencyKey, metadata } = req.body;
    const result = await advertisementService.adjustAdBudget({
      advertisementId: req.params.id,
      requesterId: req.userId ?? "",
      operation,
      amount,
      idempotencyKey,
      metadata,
    });
    sendJsonResponse(res, result);
  }

  async setAdStatus(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const { status } = req.body;
    const result = await advertisementService.setAdStatus({
      advertisementId: id,
      status,
      requesterId: req.userId ?? "",
    });
    sendJsonResponse(res, result);
  }

  async financiallyCloseAdvertisement(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const result = await advertisementService.financiallyCloseAdvertisement(
      req.params.id,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async transferArchivedAdvertisementBalance(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const result =
      await advertisementService.transferArchivedAdvertisementBalance({
        sourceAdvertisementId: req.params.id,
        destinationAdvertisementId: req.body.destinationAdvertisementId,
        amount: req.body.amount,
        idempotencyKey: req.body.idempotencyKey,
        requesterId: req.userId ?? "",
      });
    sendJsonResponse(res, result);
  }
}

export default new AdvertisementController();
