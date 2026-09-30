import fs from "fs/promises";
import path from "path";
import { BANK_ACCOUNT_UPDATE_REMINDER } from "../constants/user";
import { handleServiceError } from "../lib/error";
import { ServiceResponse } from "../type/general";
import { sendMulticastPushNotification } from "../lib/sendNotification";
import { resolveAppPushAudience } from "../repository/notification";
import { MulticastMessage } from "firebase-admin/messaging";

class SystemService {
  async sendNotification(
    message: MulticastMessage,
  ): Promise<ServiceResponse<string>> {
    try {
      await sendMulticastPushNotification(message);
      return { success: true, data: "OK" };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async sendAppNotification(input: {
    userIds?: string[];
    groupIds?: string[];
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }): Promise<
    ServiceResponse<{
      targetedUserCount: number;
      tokenCount: number;
      batchCount: number;
    }>
  > {
    try {
      const audience = await resolveAppPushAudience(input);
      const batches: string[][] = [];
      for (let i = 0; i < audience.tokens.length; i += 500) {
        batches.push(audience.tokens.slice(i, i + 500));
      }

      await Promise.all(
        batches.map((tokens) =>
          sendMulticastPushNotification({
            tokens,
            notification: input.notification,
            data: input.data,
          }),
        ),
      );

      return {
        success: true,
        data: {
          targetedUserCount: audience.userIds.length,
          tokenCount: audience.tokens.length,
          batchCount: batches.length,
        },
      };
    } catch (error) {
      return handleServiceError(error);
    }
  }

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
