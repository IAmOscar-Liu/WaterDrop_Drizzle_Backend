import { Request, Response } from "express";
import authService from "../services/auth";
import { sendJsonResponse } from "../lib/general";
import { generateToken } from "../lib/token";
import { RequestWithId } from "../type/request";

class AuthController {
  async deviceToken(req: RequestWithId, res: Response): Promise<any> {
    const { fcmToken, deviceId } = req.body;
    const result = await authService.deviceToken({
      userId: req.userId ?? "",
      fcmToken,
      deviceId: deviceId ? String(deviceId) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async clearDeviceToken(req: RequestWithId, res: Response): Promise<any> {
    const { deviceId } = req.body;
    const result = await authService.clearDeviceToken({
      userId: req.userId ?? "",
      deviceId: deviceId ? String(deviceId) : undefined,
    });
    sendJsonResponse(res, result);
  }

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
    const { name, email, phone, address, bankCode, bankAccount, resetBank } =
      req.body;
    const result = await authService.updateProfile({
      userId,
      data: {
        ...(name ? { name: String(name) } : {}),
        ...(email ? { email: String(email) } : {}),
        ...(phone ? { phone: String(phone) } : {}),
        ...(address ? { address: String(address) } : {}),
        ...(bankCode ? { bankCode: String(bankCode) } : {}),
        ...(bankAccount ? { bankAccount: String(bankAccount) } : {}),
        ...(resetBank === true ? { bankCode: null, bankAccount: null } : {}),
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

  async updateTermsAcceptedAt(req: RequestWithId, res: Response): Promise<any> {
    const result = await authService.updateTermsAcceptedAt(req.userId ?? "");
    sendJsonResponse(res, result);
  }
}

export default new AuthController();
