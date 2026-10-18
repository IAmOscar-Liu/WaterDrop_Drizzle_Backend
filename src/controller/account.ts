import accountEmailVerification from "../services/accountEmailVerification";
import { ServiceResponse } from "../type/general";
import { Request, Response } from "express";
import { publicAccount } from "../lib/accountProfile";
import accountRecoveryService from "../services/accountRecovery";
import accountSessionService from "../services/accountSession";
import accountService from "../services/account";
import { sendJsonResponse } from "../lib/general";
import {
  clearRefreshToken,
  sendRefreshToken,
} from "../lib/token";
import { RequestWithId } from "../type/request";
import { isAccountAdmin, ListAccountsParams } from "../repository/account";

function accountResponse(result: ServiceResponse<any>): ServiceResponse<any> {
  if (!result.success) return result;
  const data = result.data;
  const serialize = (value: any) => value && typeof value === "object" && "credentialVersion" in value ? publicAccount(value) : value;
  return { ...result, data: Array.isArray(data) ? data.map(serialize)
    : data?.accounts ? { ...data, accounts: data.accounts.map(serialize) } : serialize(data) };
}

class AccountController {
  async resendVerificationEmail(req: RequestWithId, res: Response) {
    const result = await accountEmailVerification.resend({ accountId: req.userId!, sessionId: req.sessionId!, credentialVersion: req.credentialVersion! }, req.body ?? {}, req.ip ?? "unknown");
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, result);
  }
  async verifyEmail(req: RequestWithId, res: Response) {
    const result = await accountEmailVerification.verify({ accountId: req.userId!, sessionId: req.sessionId!, credentialVersion: req.credentialVersion! }, req.body.token, req.ip ?? "unknown");
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, result);
  }
  async requestEmailChange(req: RequestWithId, res: Response) {
    const result = await accountEmailVerification.requestChange({ accountId: req.userId!, sessionId: req.sessionId!, credentialVersion: req.credentialVersion! }, req.body, req.ip ?? "unknown");
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, result);
  }
  async confirmEmailChange(req: RequestWithId, res: Response) {
    const result = await accountEmailVerification.confirmChange({ accountId: req.userId!, sessionId: req.sessionId!, credentialVersion: req.credentialVersion! }, req.body.token, req.ip ?? "unknown");
    if (result.success) clearRefreshToken(res);
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, result);
  }
  async completeProfile(req: RequestWithId, res: Response) {
    const result = await accountService.completeProfile(req.userId!, req.body);
    sendJsonResponse(res, result.success ? { ...result, data: publicAccount(result.data) } : result);
  }
  async forgotPassword(req: Request, res: Response) {
    const result = await accountRecoveryService.forgotPassword(req.body, req.ip ?? req.socket.remoteAddress ?? "unknown");
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, accountResponse(result));
  }
  async resetPassword(req: Request, res: Response) {
    const result = await accountRecoveryService.resetPassword(req.body, req.ip ?? req.socket.remoteAddress ?? "unknown");
    if (result.success) clearRefreshToken(res);
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, accountResponse(result));
  }

  async register(req: Request, res: Response): Promise<any> {
    const { name, email, password, phone, realName, address } = req.body;

    const result = await accountService.createAdminAccount({
      name,
      email: String(email),
      password: String(password),
      phone,
      realName,
      ...(address !== undefined ? { address: String(address) } : {}),
      role: "seller",
    }, req.ip ?? req.socket.remoteAddress ?? "unknown");
    if (!result.success && result.statusCode === 429) res.setHeader("Retry-After", "3600");
    if (result.success) {
      const session = await accountSessionService.start(result.data.id, result.data.credentialVersion);
      if (!session.success) return sendJsonResponse(res, session);
      res.setHeader("Cache-Control", "no-store");
      sendRefreshToken(res, session.data.refreshToken, session.data.expiresAt);
      sendJsonResponse(res, {
        ...result,
        data: {
          user: publicAccount(result.data),
          token: session.data.token,
        },
      });
    } else {
      sendJsonResponse(res, accountResponse(result));
    }
  }

  async createSubAccount(req: RequestWithId, res: Response): Promise<any> {
    const { parentId, name, realName, email, password, phone, address } = req.body;
    if (!accountService.validatePassword(password)) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message:
          "Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.",
      });
    }
    const phoneError = accountService.validateCellPhone(phone);
    if (phoneError) {
      return sendJsonResponse(res, { success: false, statusCode: 400, message: phoneError });
    }
    const realNameError = accountService.validateRealName(realName);
    if (realNameError) {
      return sendJsonResponse(res, { success: false, statusCode: 400, message: realNameError });
    }
    const result = await accountService.createSubAccount(req.userId ?? "", {
      parentId,
      name,
      realName,
      email,
      password,
      phone,
      address,
    });
    sendJsonResponse(res, accountResponse(result));
  }

  async deleteSubAccount(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.deleteSubAccount(
      req.userId ?? "",
      req.params.id,
    );
    sendJsonResponse(res, accountResponse(result));
  }

  async login(req: Request, res: Response): Promise<any> {
    const { email, password } = req.body;
    if (!email || !password) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "email and password are required.",
      });
    }
    const result = await accountService.getAdminAccountByEmailAndPassword(
      email,
      password,
    );
    if (result.success) {
      const session = await accountSessionService.start(result.data.id, result.data.credentialVersion);
      if (!session.success) return sendJsonResponse(res, session);
      res.setHeader("Cache-Control", "no-store");
      sendRefreshToken(res, session.data.refreshToken, session.data.expiresAt);
      sendJsonResponse(res, {
        ...result,
        data: {
          user: publicAccount(result.data),
          token: session.data.token,
        },
      });
    } else {
      sendJsonResponse(res, accountResponse(result));
    }
  }

  async logout(req: Request, res: Response) {
    const result = await accountSessionService.logout(req.cookies[process.env.REFRESH_TOKEN_NAME!], req.get("authorization")?.split(" ")[1]);
    if (result.success) clearRefreshToken(res);
    res.setHeader("Cache-Control", "no-store");
    sendJsonResponse(res, result);
  }

  async getCurrentUser(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.getAdminAccountById(req.userId ?? "");
    sendJsonResponse(res, result.success ? { ...result, data: publicAccount(result.data) } : result);
  }

  async refreshToken(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountSessionService.refresh(req.cookies[process.env.REFRESH_TOKEN_NAME!]);
    res.setHeader("Cache-Control", "no-store");
    if (!result.success) {
      if (result.statusCode === 401 || result.statusCode === 403) clearRefreshToken(res);
      return sendJsonResponse(res, result);
    }
    sendRefreshToken(res, result.data.refreshToken, result.data.expiresAt);
    sendJsonResponse(res, { success: true, data: { token: result.data.token } });
  }

  async updateAccount(req: RequestWithId, res: Response): Promise<any> {
    const {
      id,
      name,
      realName,
      email,
      phone,
      address,
      avatarUrl,
      avatar_url,
      role,
      status,
    } = req.body;

    if (!id) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "id is required.",
      });
    }

    if (id !== req.userId && !(await isAccountAdmin(req.userId ?? ""))) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 403,
        message: "You are not authorized to update this account.",
      });
    }

    if ((role !== undefined || status !== undefined) && !(await isAccountAdmin(req.userId ?? ""))) {
      return sendJsonResponse(res, { success: false, statusCode: 403, message: "Only platform admins may change role or status." });
    }

    if (typeof realName === "string") {
      const realNameValidationResult =
        accountService.validateRealName(realName);
      if (realNameValidationResult)
        return sendJsonResponse(res, {
          success: false,
          statusCode: 400,
          message: realNameValidationResult,
        });
    }

    if (typeof phone === "string") {
      const phoneValidationResult = accountService.validateCellPhone(phone);
      if (phoneValidationResult)
        return sendJsonResponse(res, {
          success: false,
          statusCode: 400,
          message: phoneValidationResult,
        });
    }

    const result = await accountService.updateAdminAccount({
      accountId: id,
      update: {
        ...(name ? { name: String(name) } : {}),
        ...(realName ? { realName: String(realName) } : {}),
        ...(email ? { email: String(email) } : {}),
        ...(phone ? { phone: String(phone) } : {}),
        ...(address ? { address: String(address) } : {}),
        ...(avatarUrl !== undefined || avatar_url !== undefined
          ? { avatar_url: avatarUrl !== undefined ? avatarUrl : avatar_url }
          : {}),
        ...(role ? { role: role as ListAccountsParams["role"] } : {}),
        ...(status ? { status: status as ListAccountsParams["status"] } : {}),
      },
    });
    sendJsonResponse(res, accountResponse(result));
  }

  async changeAccountPassword(req: RequestWithId, res: Response): Promise<any> {
    const { id, oldPassword, newPassword } = req.body;
    if (!id || !oldPassword || !newPassword) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "id, oldPassword, and newPassword are required.",
      });
    }
    if (id !== req.userId) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 403,
        message: "You are not authorized to update this account.",
      });
    }
    if (!accountService.validatePassword(newPassword)) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message:
          "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
      });
    }

    const result = await accountService.changeAdminAccountPassword({
      accountId: id,
      oldPassword,
      newPassword,
    });
    if (result.success) clearRefreshToken(res);
    sendJsonResponse(res, result.success ? { ...result, data: publicAccount(result.data) } : result);
  }

  async listAccounts(req: Request, res: Response): Promise<any> {
    const {
      page,
      limit,
      search,
      role,
      status,
      sellerId,
      accountGroupId,
      parentId,
    } = req.query;
    const result = await accountService.listAdminAccounts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search ? String(search) : undefined,
      role: role ? (String(role) as ListAccountsParams["role"]) : undefined,
      status: status
        ? (String(status) as ListAccountsParams["status"])
        : undefined,
      sellerId: sellerId ? String(sellerId) : undefined,
      accountGroupId: accountGroupId ? String(accountGroupId) : undefined,
      parentId: parentId ? String(parentId) : undefined,
    });
    sendJsonResponse(res, accountResponse(result));
  }

  async getAccount(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await accountService.getAdminAccountById(id);
    sendJsonResponse(res, accountResponse(result));
  }

  async assignAccountParent(req: RequestWithId, res: Response): Promise<any> {
    const { parentId } = req.body;
    const result = await accountService.assignAccountParent(
      req.userId ?? "",
      parentId,
    );
    sendJsonResponse(res, accountResponse(result));
  }

  async listAccountEmployees(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.listAccountEmployees(req.userId ?? "");
    sendJsonResponse(res, accountResponse(result));
  }
}

export default new AccountController();
