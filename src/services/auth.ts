import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import { resetDailyStats } from "../repository/treasureBox";
import {
  createUser,
  getDailyStatByUserId,
  getUserById,
  getUserByOauthProviderAndOauthId,
  joinGroupByReferralCode,
  updateUser,
  updateUserTimezone,
  upsertDeviceToken,
  validateReferralCode,
  updateUserTermsAcceptedAt,
  clearDeviceToken,
} from "../repository/user";
import { ServiceResponse } from "../type/general";

type AuthLoginResponse = {
  user: schema.User;
  isNewUser: boolean;
};

class AuthService {
  async deviceToken(input: {
    userId: string;
    fcmToken: string;
    deviceId?: string;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof upsertDeviceToken>>>> {
    try {
      const result = await upsertDeviceToken(input);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async clearDeviceToken(input: {
    userId: string;
    deviceId?: string | null;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof clearDeviceToken>>>> {
    try {
      const result = await clearDeviceToken(input);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async login({
    name,
    email,
    oauthProvider,
    oauthId,
    timezone,
  }: Pick<
    typeof schema.userTable.$inferInsert,
    "name" | "email" | "oauthProvider" | "oauthId" | "timezone"
  >): Promise<ServiceResponse<AuthLoginResponse>> {
    try {
      let user = await getUserByOauthProviderAndOauthId(oauthProvider, oauthId);
      if (user) {
        if (timezone && user.timezone != timezone) {
          await updateUserTimezone(user.id, timezone);
          user = await getUserById(user.id); // Refresh user data
        }
        return {
          success: true,
          data: { user: user!, isNewUser: false },
        };
      }
      await createUser({ name, email, oauthProvider, oauthId, timezone });
      user = await getUserByOauthProviderAndOauthId(oauthProvider, oauthId);
      if (user)
        return {
          success: true,
          data: { user: user!, isNewUser: true },
        };
      return { success: false, message: "Failed to create user" };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async profile(id: string): Promise<ServiceResponse<schema.User>> {
    try {
      const user = await getUserById(id);
      if (user) {
        return { success: true, data: user };
      } else {
        return { success: false, statusCode: 404, message: "User not found" };
      }
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async updateProfile({
    userId,
    data,
  }: {
    userId: string;
    data: Partial<Pick<schema.User, "name" | "phone" | "address" | "email">>;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof updateUser>>>> {
    try {
      const updatedUser = await updateUser(userId, data);
      return { success: true, data: updatedUser };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async dailyStats(id: string): Promise<ServiceResponse<schema.UserDailyStat>> {
    try {
      const stats = await getDailyStatByUserId(id);
      return { success: true, data: stats };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async validateReferralCode(
    referralCode: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof validateReferralCode>>>
  > {
    try {
      const result = await validateReferralCode(referralCode);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async joinGroup({
    referralCode,
    userId,
  }: {
    referralCode: string;
    userId: string;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof joinGroupByReferralCode>>>
  > {
    try {
      const result = await joinGroupByReferralCode(referralCode, userId);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async resetDailyStats(
    userId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof resetDailyStats>>>> {
    try {
      const result = await resetDailyStats(userId);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateTermsAcceptedAt(
    userId: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateUserTermsAcceptedAt>>>
  > {
    try {
      const result = await updateUserTermsAcceptedAt(userId);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new AuthService();
