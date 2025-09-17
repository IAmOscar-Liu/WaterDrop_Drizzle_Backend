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
  validateReferralCode,
} from "../repository/user";
import { ServiceResponse } from "../type/general";

type AuthLoginResponse = {
  user: schema.User;
  isNewUser: boolean;
};

class AuthService {
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
      if (updatedUser) {
        return { success: true, data: updatedUser };
      } else {
        return { success: false, statusCode: 404, message: "User not found" };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async dailyStats(id: string): Promise<ServiceResponse<schema.UserDailyStat>> {
    try {
      const stats = await getDailyStatByUserId(id);
      if (stats) {
        return { success: true, data: stats };
      } else {
        return { success: false, statusCode: 404, message: "stats not found" };
      }
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async validateReferralCode(
    referralCode: string
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof validateReferralCode>>>
  > {
    try {
      const result = await validateReferralCode(referralCode);
      if (result) {
        return { success: true, data: result };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "Referral code not found",
        };
      }
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
      if (result) {
        return { success: true, data: result };
      } else {
        return { success: false, statusCode: 404, message: "Group not found" };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async resetDailyStats(
    userId: string
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof resetDailyStats>>>> {
    try {
      const result = await resetDailyStats(userId);
      if (result) {
        return { success: true, data: result };
      } else {
        return { success: false, statusCode: 404, message: "User not found" };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new AuthService();
