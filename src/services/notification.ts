import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createNotification,
  getNotificationById,
  getNotificationStats,
  deleteNotifications,
  listNotifications,
  ListNotificationsParams,
  markNotificationsAsRead,
} from "../repository/notification";
import { ServiceResponse } from "../type/general";

class NotificationService {
  async listNotifications(
    params: ListNotificationsParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listNotifications>>>> {
    try {
      const notifications = await listNotifications(params);
      if (notifications) {
        return { success: true, data: notifications };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "notifications not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getNotificationById(
    notificationId: string
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getNotificationById>>>> {
    try {
      const notification = await getNotificationById(notificationId);
      if (notification) {
        return { success: true, data: notification };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "notification not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getNotificationStats(
    userId: string
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getNotificationStats>>>
  > {
    try {
      const stats = await getNotificationStats(userId);
      if (stats) {
        return { success: true, data: stats };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "stats not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createNotification(
    notificationData: Omit<schema.NewUserNotification, "id">
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createNotification>>>> {
    try {
      const notification = await createNotification(notificationData); // Replace with real data fetching logic
      if (notification) {
        return { success: true, data: notification };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "notification not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async markNotificationsAsRead({
    userId,
    notificationIds,
  }: {
    userId: string;
    notificationIds: string[];
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof markNotificationsAsRead>>>
  > {
    try {
      const notifications = await markNotificationsAsRead(
        userId,
        notificationIds
      );
      if (notifications) {
        return { success: true, data: notifications };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "notifications not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async deleteNotifications(
    notificationIds: string[]
  ): Promise<ServiceResponse<string>> {
    try {
      const deletedCount = await deleteNotifications(notificationIds);
      if (deletedCount > 0) {
        return {
          success: true,
          data: `Deleted ${deletedCount} notifications.`,
        };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "notifications not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new NotificationService();
