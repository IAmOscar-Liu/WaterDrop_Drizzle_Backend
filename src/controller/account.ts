import { Request, Response } from "express";
import accountService from "../services/account";
import { sendJsonResponse } from "../lib/general";
import {
  clearRefreshToken,
  generateAdminAccessToken,
  sendRefreshToken,
  validateToken,
} from "../lib/token";
import { RequestWithId } from "../type/request";
import { isAccountAdmin, ListAccountsParams } from "../repository/account";

class AccountController {
  async register(req: Request, res: Response): Promise<any> {
    const { name, email, password, phone, realName, address } = req.body;

    if (!name || !email || !password || !phone || !realName) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "Name, email, password, phone and realName are required.",
      });
    }

    if (!accountService.validatePassword(password)) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message:
          "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
      });
    }

    const phoneValidationResult = accountService.validateCellPhone(phone);
    if (phoneValidationResult)
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: phoneValidationResult,
      });

    const realNameValidationResult = accountService.validateRealName(realName);
    if (realNameValidationResult)
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: realNameValidationResult,
      });

    const result = await accountService.createAdminAccount({
      name: String(name),
      email: String(email),
      password: String(password),
      phone: String(phone),
      realName: String(realName),
      ...(address !== undefined ? { address: String(address) } : {}),
      role: "seller",
    });
    if (result.success) {
      sendRefreshToken(res, result.data);
      sendJsonResponse(res, {
        ...result,
        data: {
          user: result.data,
          token: generateAdminAccessToken(result.data),
        },
      });
    } else {
      sendJsonResponse(res, result);
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
    sendJsonResponse(res, result);
  }

  async deleteSubAccount(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.deleteSubAccount(
      req.userId ?? "",
      req.params.id,
    );
    sendJsonResponse(res, result);
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
      sendRefreshToken(res, result.data);
      sendJsonResponse(res, {
        ...result,
        data: {
          user: result.data,
          token: generateAdminAccessToken(result.data),
        },
      });
    } else {
      sendJsonResponse(res, result);
    }
  }

  logout(_: Request, res: Response) {
    clearRefreshToken(res);
    sendJsonResponse(res, { success: true, data: "OK" });
  }

  async getCurrentUser(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.getAdminAccountById(req.userId ?? "");
    sendJsonResponse(res, result);
  }

  async refreshToken(req: RequestWithId, res: Response): Promise<any> {
    const refreshToken = req.cookies[process.env.REFRESH_TOKEN_NAME!];

    if (!refreshToken) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 401,
        message: "Refresh token doesn't exist",
      });
    }

    const payload: any = validateToken(refreshToken);
    if (!payload || typeof payload === "string" || !payload.data?.id) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 403,
        message: "Invalid refresh token",
      });
    }

    // Security Best Practice: Verify the user from the token still exists in the DB.
    const accountCheck = await accountService.getAdminAccountById(
      payload.data.id,
    );
    if (
      !accountCheck.success ||
      accountCheck.data.status !== "active" ||
      accountCheck.data.deletedAt
    ) {
      // Clear the invalid cookie and deny the request.
      clearRefreshToken(res);
      return sendJsonResponse(res, {
        success: false,
        statusCode: 403,
        message: "Account no longer exists.",
      });
    }

    // The account is valid, issue a new refresh token and a new access token.
    const newAccessToken = generateAdminAccessToken(accountCheck.data);
    sendRefreshToken(res, accountCheck.data);
    sendJsonResponse(res, {
      success: true,
      data: { token: newAccessToken },
    });
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
    sendJsonResponse(res, result);
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
    sendJsonResponse(res, result);
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
    sendJsonResponse(res, result);
  }

  async getAccount(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await accountService.getAdminAccountById(id);
    sendJsonResponse(res, result);
  }

  async assignAccountParent(req: RequestWithId, res: Response): Promise<any> {
    const { parentId } = req.body;
    const result = await accountService.assignAccountParent(
      req.userId ?? "",
      parentId,
    );
    sendJsonResponse(res, result);
  }

  async listAccountEmployees(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.listAccountEmployees(req.userId ?? "");
    sendJsonResponse(res, result);
  }
}

export default new AccountController();
