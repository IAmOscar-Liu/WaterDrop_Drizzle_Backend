import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  changeAccountPassword,
  createAccount,
  getAccountByEmailAndPassword,
  getAccountById,
  updateAccount,
  listAccounts,
  ListAccountsParams,
  updateAccountLastLogin,
  assignAccountParent,
  listAccountEmployees,
} from "../repository/account";
import { ServiceResponse } from "../type/general";
import ecpayService from "./ecpay";

class AdminService {
  async createAdminAccount(
    accountData: schema.NewAccount,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createAccount>>>> {
    try {
      let account = await createAccount(accountData); // Replace with real data fetching logic
      account = await updateAccountLastLogin(account.id);
      return { success: true, data: account };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getAdminAccountByEmailAndPassword(
    email: string,
    password: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getAccountByEmailAndPassword>>>
  > {
    try {
      let account = await getAccountByEmailAndPassword(email, password); // Replace with real data fetching logic
      account = await updateAccountLastLogin(account.id);
      return { success: true, data: account };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getAdminAccountById(
    accountId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getAccountById>>>> {
    try {
      const account = await getAccountById(accountId); // Replace with real data fetching logic
      if (account) {
        return { success: true, data: account };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "account not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateAdminAccount({
    accountId,
    update,
  }: {
    accountId: string;
    update: Parameters<typeof updateAccount>[1];
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof updateAccount>>>> {
    try {
      const account = await updateAccount(accountId, update); // Replace with real data fetching logic
      if (account) {
        return { success: true, data: account };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "account not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async changeAdminAccountPassword({
    accountId,
    oldPassword,
    newPassword,
  }: {
    accountId: string;
    oldPassword: string;
    newPassword: string;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof changeAccountPassword>>>
  > {
    try {
      const account = await changeAccountPassword(
        accountId,
        oldPassword,
        newPassword,
      ); // Replace with real data fetching logic
      if (account) {
        return { success: true, data: account };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "account not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAdminAccounts(
    params: ListAccountsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAccounts>>>> {
    try {
      const accounts = await listAccounts(params); // Replace with real data fetching logic
      return { success: true, data: accounts };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async assignAccountParent(
    accountId: string,
    parentId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof assignAccountParent>>>> {
    try {
      const account = await assignAccountParent(accountId, parentId);
      return { success: true, data: account };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listAccountEmployees(
    accountId: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof listAccountEmployees>>>
  > {
    try {
      const employees = await listAccountEmployees(accountId);
      return { success: true, data: employees };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  /**
   * Validates a password to ensure it meets complex security requirements.
   * - At least 8 characters long
   * - At least one uppercase letter
   * - At least one lowercase letter
   * - At least one number
   * - At least one special character
   *
   * @param password The password string to validate.
   * @returns {boolean} True if the password is valid, false otherwise.
   */
  validatePassword(password: string): boolean {
    const hasMinLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    // Matches any character that is not a word character (alphanumeric and underscore) or whitespace.
    // You can customize this regex to be more or less strict.
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return (
      hasMinLength &&
      hasUppercase &&
      hasLowercase &&
      hasNumber &&
      hasSpecialChar
    );
  }

  validateRealName(realName: string) {
    const nameLength = ecpayService.getEcpayLength(realName);
    if (nameLength < 4 || nameLength > 10) {
      return `姓名長度須介於 4 到 10 個字元之間 (目前長度: ${nameLength})`;
    }
    if (ecpayService.hasEmoji(realName)) {
      return `姓名不可包含表情符號`;
    }
    return null;
  }

  validateCellPhone(phone: string) {
    const phoneRegex = /^09\d{8}$/;
    if (!phoneRegex.test(phone)) {
      return `手機格式錯誤，須為 09 開頭的 10 碼數字`;
    }
    return null;
  }
}

export default new AdminService();
