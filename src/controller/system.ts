import { Request, Response } from "express";
import systemService from "../services/system";
import { sendJsonResponse } from "../lib/general";

class SystemController {
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
