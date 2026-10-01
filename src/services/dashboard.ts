import { getInternalStatistics } from "../repository/internalStatistics";
import { handleServiceError } from "../lib/error";
import {
  getDashboardKpi,
  getDashboardPendingTasks,
  getDashboardTimeSeries,
  getRecentAdminActivities,
} from "../repository/adminDashboard";

class DashboardService {
  private async respond<T>(work: () => Promise<T>) {
    try {
      return { success: true as const, data: await work() };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  getInternal(input: Parameters<typeof getInternalStatistics>[0], daily = false) {
    return this.respond(() => getInternalStatistics(input, daily));
  }
  getKpi(input: Parameters<typeof getDashboardKpi>[0]) {
    return this.respond(() => getDashboardKpi(input));
  }
  getTimeSeries(input: Parameters<typeof getDashboardTimeSeries>[0]) {
    return this.respond(() => getDashboardTimeSeries(input));
  }
  getPendingTasks(input: Parameters<typeof getDashboardPendingTasks>[0]) {
    return this.respond(() => getDashboardPendingTasks(input));
  }
  getRecentActivities(input: Parameters<typeof getRecentAdminActivities>[0]) {
    return this.respond(() => getRecentAdminActivities(input));
  }
}

export default new DashboardService();
