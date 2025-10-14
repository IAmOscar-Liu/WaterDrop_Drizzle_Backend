import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  changeAccountPassword,
  createAccount,
  getAccountByEmailAndPassword,
  getAccountById,
  updateAccount,
} from "../repository/account";
import { ServiceResponse } from "../type/general";

class AdminService {
  async createAdminAccount(
    accountData: schema.NewAccount
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createAccount>>>> {
    try {
      const account = await createAccount(accountData); // Replace with real data fetching logic
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

  async getAdminAccountByEmailAndPassword(
    email: string,
    password: string
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getAccountByEmailAndPassword>>>
  > {
    try {
      const account = await getAccountByEmailAndPassword(email, password); // Replace with real data fetching logic
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

  async getAdminAccountById(
    accountId: string
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
    update: Partial<Omit<schema.Account, "id" | "password" | "createdAt">>;
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
        newPassword
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
}

export default new AdminService();
