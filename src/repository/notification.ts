import { and, count, eq, ilike, inArray, or, SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";

export async function createNotification(
  notificationData: schema.NewUserNotification
) {
  const [newNotification] = await db
    .insert(schema.userNotificationTable)
    .values(notificationData)
    .returning();

  console.log("New Notification Created:", newNotification.id);
  return newNotification;
}

export async function markNotificationsAsRead(
  userId: string,
  notificationIds: string[]
) {
  const updatedNotifications = await db
    .update(schema.userNotificationTable)
    .set({ isRead: true })
    .where(
      and(
        eq(schema.userNotificationTable.userId, userId),
        inArray(schema.userNotificationTable.id, notificationIds)
      )
    )
    .returning();

  console.log(
    `Marked ${updatedNotifications.length} notifications as read for user ${userId}.`
  );
  return updatedNotifications;
}

export async function getNotificationById(notificationId: string) {
  return db.query.userNotificationTable.findFirst({
    where: eq(schema.userNotificationTable.id, notificationId),
  });
}

export interface ListNotificationsParams {
  userId: string;
  page?: number;
  limit?: number;
  search?: string;
  types?: schema.UserNotification["type"][];
  onlyUnread?: boolean;
}

export async function listNotifications({
  userId,
  page = 1,
  limit = 10,
  search,
  types,
  onlyUnread = false,
}: ListNotificationsParams) {
  const offset = (page - 1) * limit;

  const conditions: (SQL | undefined)[] = [
    eq(schema.userNotificationTable.userId, userId),
    onlyUnread ? eq(schema.userNotificationTable.isRead, false) : undefined,
    types && types.length > 0
      ? inArray(schema.userNotificationTable.type, types)
      : undefined,
    search
      ? or(
          ilike(schema.userNotificationTable.title, `%${search}%`),
          ilike(schema.userNotificationTable.body, `%${search}%`)
        )
      : undefined,
  ];

  const whereClause = and(...conditions.filter((c): c is SQL => !!c));

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.userNotificationTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  const notifications = await db.query.userNotificationTable.findMany({
    where: whereClause,
    limit,
    offset,
    orderBy: (notif, { desc }) => [desc(notif.createdAt)],
  });

  console.log(
    `Fetched ${notifications.length} notifications for user ${userId}.`
  );
  return { notifications, total, page, limit, totalPages };
}

/**
 * Counts the number of unread notifications for each type for a given user.
 * @param userId The ID of the user.
 * @returns An object where keys are notification types and values are the counts of unread notifications.
 */
export async function getNotificationStats(userId: string) {
  const stats = await db
    .select({
      type: schema.userNotificationTable.type,
      count: count(),
    })
    .from(schema.userNotificationTable)
    .where(
      and(
        eq(schema.userNotificationTable.userId, userId),
        eq(schema.userNotificationTable.isRead, false)
      )
    )
    .groupBy(schema.userNotificationTable.type);

  // Transform the result into a more convenient key-value object
  const initialStats = { total: 0 };
  const statsMap = stats.reduce((acc, stat) => {
    acc[stat.type] = stat.count;
    acc.total += stat.count;
    return acc;
  }, initialStats as Record<schema.UserNotification["type"] | "total", number>);

  console.log(`Fetched notification stats for user ${userId}.`);
  return statsMap;
}

export async function deleteNotifications(notificationIds: string[]) {
  const deletedCount = await db
    .delete(schema.userNotificationTable)
    .where(inArray(schema.userNotificationTable.id, notificationIds))
    .returning()
    .then((rows) => rows.length);

  console.log(`Deleted ${deletedCount} notifications.`);
  return deletedCount;
}
