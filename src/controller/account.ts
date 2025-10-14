import { Request, Response } from "express";
import accountService from "../services/account";
import { sendJsonResponse } from "../lib/general";
import { generateToken, sendRefreshToken, validateToken } from "../lib/token";
import { RequestWithId } from "../type/request";

class AccountController {
  async register(req: Request, res: Response): Promise<any> {
    const { name, email, password, phone, address } = req.body;

    if (!name || !email || !password) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "Name, email, and password are required.",
      });
    }

    const result = await accountService.createAdminAccount({
      name,
      email,
      password,
      phone,
      address,
      role: "seller", // Assuming 'admin' is a valid role
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
    const { id, name, email, phone, address } = req.body;
    if (!id) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 400,
        message: "id is required.",
      });
    }
    if (id !== req.userId) {
      return sendJsonResponse(res, {
        success: false,
        statusCode: 403,
        message: "You are not authorized to update this account.",
      });
    }
    const result = await accountService.updateAdminAccount({
      accountId: id,
      update: {
        name,
        email,
        phone,
        address,
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
    const result = await accountService.changeAdminAccountPassword({
      accountId: id,
      oldPassword,
      newPassword,
    });
    sendJsonResponse(res, result);
  }
}

export default new AccountController();
