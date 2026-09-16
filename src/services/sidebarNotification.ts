import { handleServiceError } from "../lib/error";
import {
  getSidebarNotificationSummary,
  markSidebarSectionSeen,
} from "../repository/sidebarNotification";

class SidebarNotificationService {
  async getSummary(input: Parameters<typeof getSidebarNotificationSummary>[0]) {
    try {
      return { success: true as const, data: await getSidebarNotificationSummary(input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }
  async markSeen(input: Parameters<typeof markSidebarSectionSeen>[0]) {
    try {
      return { success: true as const, data: await markSidebarSectionSeen(input) };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new SidebarNotificationService();
