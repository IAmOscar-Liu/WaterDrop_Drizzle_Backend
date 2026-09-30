import { handleServiceError } from "../lib/error";
import {
  creditSellerWallet,
  getAccountWallet,
  listAccountWalletTransactions,
  ListWalletTransactionsParams,
  getAccountWalletSummary,
} from "../repository/accountWallet";
import { ServiceResponse } from "../type/general";

class AccountWalletService {
  async getSummary(input: Parameters<typeof getAccountWalletSummary>[0]) {
    try {
      return { success: true as const, data: await getAccountWalletSummary(input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }
  async getWallet(
    accountId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getAccountWallet>>>> {
    try {
      return { success: true, data: await getAccountWallet(accountId) };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async listTransactions(
    input: ListWalletTransactionsParams,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof listAccountWalletTransactions>>>
  > {
    try {
      return {
        success: true,
        data: await listAccountWalletTransactions(input),
      };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async creditSellerWallet(
    input: Parameters<typeof creditSellerWallet>[0],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof creditSellerWallet>>>> {
    try {
      return { success: true, data: await creditSellerWallet(input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new AccountWalletService();
