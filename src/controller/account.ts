import { Request, Response } from "express";
import accountService from "../services/account";
import { sendJsonResponse, validatePassword } from "../lib/general";
import { generateToken, sendRefreshToken, validateToken } from "../lib/token";
import { RequestWithId } from "../type/request";
import { isAccountAdmin, ListAccountsParams } from "../repository/account";

class AccountController {
  async register(req: Request, res: Response): Promise<any> {
    const { name, email, password, phone, address, role } = req.body;

    if (!name || !email || !password) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "Name, email, and password are required.",
      });
    }
    if (!validatePassword(password)) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message:
          "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
      });
    }

    const result = await accountService.createAdminAccount({
      name,
      email,
      password,
      phone,
      address,
      role: role ?? "seller", // Assuming 'admin' is a valid role
    });
    if (result.success) {
      sendRefreshToken(res, result.data);
      sendJsonResponse(res, {
        ...result,
        data: {
          user: result.data,
          token: generateToken(result.data, "30m"),
        },
      });
    } else {
      sendJsonResponse(res, result);
    }
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
      password
    );
    if (result.success) {
      sendRefreshToken(res, result.data);
      sendJsonResponse(res, {
        ...result,
        data: {
          user: result.data,
          token: generateToken(result.data, "30m"),
        },
      });
    } else {
      sendJsonResponse(res, result);
    }
  }

  logout(_: Request, res: Response) {
    res.clearCookie(process.env.REFRESH_TOKEN_NAME!);
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
      payload.data.id
    );
    if (!accountCheck.success) {
      // Clear the invalid cookie and deny the request.
      res.clearCookie(process.env.REFRESH_TOKEN_NAME!);
      return sendJsonResponse(res, {
        success: false,
        statusCode: 403,
        message: "Account no longer exists.",
      });
    }

    // The account is valid, issue a new refresh token and a new access token.
    const newAccessToken = generateToken(accountCheck.data, "30m");
    sendRefreshToken(res, accountCheck.data);
    sendJsonResponse(res, {
      success: true,
      data: { token: newAccessToken },
    });
  }

  async updateAccount(req: RequestWithId, res: Response): Promise<any> {
    const { id, ...update } = req.body;
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
    const result = await accountService.updateAdminAccount({
      accountId: id,
      update,
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
    if (!validatePassword(newPassword)) {
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
    const { page, limit, search, role, status } = req.query;
    const result = await accountService.listAdminAccounts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search ? String(search) : undefined,
      role: role ? (String(role) as ListAccountsParams["role"]) : undefined,
      status: status
        ? (String(status) as ListAccountsParams["status"])
        : undefined,
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
      parentId
    );
    sendJsonResponse(res, result);
  }

  async listAccountEmployees(req: RequestWithId, res: Response): Promise<any> {
    const result = await accountService.listAccountEmployees(req.userId ?? "");
    sendJsonResponse(res, result);
  }
}

export default new AccountController();
