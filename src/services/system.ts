import fs from "fs/promises";
import path from "path";
import { handleServiceError } from "../lib/error";
import { ServiceResponse } from "../type/general";

class SystemService {
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
}

export default new SystemService();
