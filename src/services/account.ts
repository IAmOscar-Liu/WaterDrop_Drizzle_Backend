import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  completeAccountProfile,
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
  createSubAccount,
  softDeleteSubAccount,
  CreateSubAccountInput,
} from "../repository/account";
import { ServiceResponse } from "../type/general";
import { validatePassword, validateRealName, validateCellPhone } from "../lib/accountProfile";

class AdminService {
  async completeProfile(accountId: string, profile: Parameters<typeof completeAccountProfile>[1]) {
    try { return { success: true as const, data: await completeAccountProfile(accountId, profile) }; }
    catch (error) { return handleServiceError(error); }
  }

  async createSubAccount(requesterId: string, input: CreateSubAccountInput) {
    try {
      return { success: true as const, data: await createSubAccount(requesterId, input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async deleteSubAccount(requesterId: string, targetAccountId: string) {
    try {
      return {
        success: true as const,
        data: await softDeleteSubAccount(requesterId, targetAccountId),
      };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createAdminAccount(
    accountData: schema.NewAccount,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createAccount>>>> {
    try {
      let account = await createAccount(accountData); // Replace with real data fetching logic
      account = await updateAccountLastLogin(account.id, account.credentialVersion);
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
      account = await updateAccountLastLogin(account.id, account.credentialVersion);
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
  validatePassword = validatePassword;
  validateRealName = validateRealName;
  validateCellPhone = validateCellPhone;
}

export default new AdminService();
