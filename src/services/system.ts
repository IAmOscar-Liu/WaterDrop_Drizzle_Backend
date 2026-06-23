import fs from "fs/promises";
import path from "path";
import { BANK_ACCOUNT_UPDATE_REMINDER } from "../constants/user";
import { handleServiceError } from "../lib/error";
import { ServiceResponse } from "../type/general";

class SystemService {
  async getInfo(): Promise<ServiceResponse<Record<string, any>>> {
    return Promise.resolve({
      success: true,
      data: {
        bankAccountUpdateReminder: BANK_ACCOUNT_UPDATE_REMINDER,
      },
    });
  }

  async getProductRecommendation(): Promise<ServiceResponse<any>> {
    try {
      const filePath = path.resolve(
        process.cwd(),
        "src/assets/json/product-recommendation.json",
      );
      const content = await fs.readFile(filePath, "utf-8");

      return { success: true, data: JSON.parse(content) };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getCustomerSupportContent(): Promise<ServiceResponse<any>> {
    try {
      const filePath = path.resolve(
        process.cwd(),
        "src/assets/json/customer-support-content.json",
      );
      const content = await fs.readFile(filePath, "utf-8");

      return { success: true, data: JSON.parse(content) };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getBankList(): Promise<ServiceResponse<any>> {
    try {
      const filePath = path.resolve(
        process.cwd(),
        "src/assets/json/bankList.json",
      );
      const content = await fs.readFile(filePath, "utf-8");
      const json = JSON.parse(content);

      return { success: true, data: json["banks"] };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new SystemService();
