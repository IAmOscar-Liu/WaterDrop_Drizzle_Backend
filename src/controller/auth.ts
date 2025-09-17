import { Request, Response } from "express";
import authService from "../services/auth";
import { sendJsonResponse } from "../lib/general";
import { generateToken } from "../lib/token";
import { RequestWithId } from "../type/request";

class AuthController {
  async login(req: Request, res: Response): Promise<any> {
    const result = await authService.login(req.body);
    if (result.success) {
      sendJsonResponse(res, {
        ...result,
        data: { ...result.data, token: generateToken(result.data.user) },
      });
    } else {
      sendJsonResponse(res, result);
    }
  }

  async profile(req: RequestWithId, res: Response): Promise<any> {
    const result = await authService.profile(req.userId ?? "");
    sendJsonResponse(res, result);
  }

  async updateProfile(req: RequestWithId, res: Response): Promise<any> {
    const userId = req.userId ?? "";
    const { name, email, phone, address } = req.body;
    const result = await authService.updateProfile({
      userId,
      data: {
        name: name ? String(name) : undefined,
        email: email ? String(email) : undefined,
        phone: phone ? String(phone) : undefined,
        address: address ? String(address) : undefined,
      },
    });
    sendJsonResponse(res, result);
  }

  async dailyStats(req: RequestWithId, res: Response): Promise<any> {
    const result = await authService.dailyStats(req.userId ?? "");
    sendJsonResponse(res, result);
  }

  async validateReferralCode(req: Request, res: Response): Promise<any> {
    const { referralCode } = req.params;
    const result = await authService.validateReferralCode(referralCode);
    sendJsonResponse(res, result);
  }

  async joinGroup(req: RequestWithId, res: Response): Promise<any> {
    const { referralCode } = req.body;
    const userId = req.userId ?? "";
    const result = await authService.joinGroup({ referralCode, userId });
    sendJsonResponse(res, result);
  }

  async resetDailyStats(req: RequestWithId, res: Response): Promise<any> {
    const userId = req.body.userId ?? req.userId ?? "";
    const result = await authService.resetDailyStats(userId);
    sendJsonResponse(res, result);
  }
}

export default new AuthController();
