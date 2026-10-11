import { handleServiceError } from "../lib/error";
import { ServiceResponse } from "../type/general";
import { getSyncNotification, getSyncNotificationStats, listSyncNotifications, mutateNotifications } from "../repository/notificationSync";

async function respond<T>(operation: () => Promise<T>): Promise<ServiceResponse<T>> {
  try { return { success: true, data: await operation() }; }
  catch (error) { return handleServiceError(error); }
}
export default {
  list: (query: Parameters<typeof listSyncNotifications>[0]) => respond(() => listSyncNotifications(query)),
  stats: (userId: string) => respond(() => getSyncNotificationStats(userId)),
  detail: (userId: string, id: string) => respond(() => getSyncNotification(userId, id)),
  read: (userId: string, ids: string[]) => respond(async () => {
    const { notifications, stats } = await mutateNotifications(userId, ids, "read");
    return { notifications, stats };
  }),
  delete: (userId: string, ids: string[]) => respond(async () => {
    const { deleted, stats } = await mutateNotifications(userId, ids, "delete");
    return { deleted, stats };
  }),
};
