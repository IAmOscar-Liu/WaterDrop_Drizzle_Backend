import { Request, Response } from "express";
import systemService from "../services/system";
import { sendJsonResponse } from "../lib/general";

class SystemController {
  async sendNotification(req: Request, res: Response): Promise<any> {
    const result = await systemService.sendNotification(req.body);
    sendJsonResponse(res, result);
  }

  async sendAppNotification(req: Request, res: Response): Promise<any> {
    const result = await systemService.sendAppNotification(req.body);
    sendJsonResponse(res, result);
  }

  async getInfo(_: Request, res: Response): Promise<any> {
    const result = await systemService.getInfo();
    sendJsonResponse(res, result);
  }

  async getProductRecommendation(_: Request, res: Response): Promise<any> {
    const result = await systemService.getProductRecommendation();
    sendJsonResponse(res, result);
  }

  async getCustomerSupportContent(_: Request, res: Response): Promise<any> {
    const result = await systemService.getCustomerSupportContent();
    sendJsonResponse(res, result);
  }

  async getBankList(_: Request, res: Response): Promise<any> {
    const result = await systemService.getBankList();
    sendJsonResponse(res, result);
  }
}

export default new SystemController();
