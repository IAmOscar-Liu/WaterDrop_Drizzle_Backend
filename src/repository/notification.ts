import { and, count, eq, ilike, inArray, or } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

export async function createNotification(
  notificationData: schema.NewUserNotification,
) {
  const [newNotification] = await db
    .insert(schema.userNotificationTable)
    .values(notificationData)
    .returning();

  return newNotification;
}

export async function markNotificationsAsRead(
  userId: string,
  notificationIds: string[],
) {
  const updatedNotifications = await db
    .update(schema.userNotificationTable)
    .set({ isRead: true })
    .where(
      and(
        eq(schema.userNotificationTable.userId, userId),
        inArray(schema.userNotificationTable.id, notificationIds),
      ),
    )
    .returning();

  return updatedNotifications;
}

export async function getNotificationById(notificationId: string) {
  return db.query.userNotificationTable.findFirst({
    where: eq(schema.userNotificationTable.id, notificationId),
  });
}

export interface ListNotificationsParams extends PaginationParams {
  userId: string;
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
  const pagination = getPagination(page, limit);

  const whereClause = compactConditions([
    eq(schema.userNotificationTable.userId, userId),
    onlyUnread ? eq(schema.userNotificationTable.isRead, false) : undefined,
    types && types.length > 0
      ? inArray(schema.userNotificationTable.type, types)
      : undefined,
    search
      ? or(
          ilike(schema.userNotificationTable.title, `%${search}%`),
          ilike(schema.userNotificationTable.body, `%${search}%`),
        )
      : undefined,
  ]);

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.userNotificationTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  const notifications = await db.query.userNotificationTable.findMany({
    where: whereClause,
    limit: pagination.limit,
    offset: pagination.offset,
    orderBy: (notif, { desc }) => [desc(notif.createdAt)],
  });

  return {
    notifications,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
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
        eq(schema.userNotificationTable.isRead, false),
      ),
    )
    .groupBy(schema.userNotificationTable.type);

  // Transform the result into a more convenient key-value object
  const initialStats = { total: 0 };
  const statsMap = stats.reduce((acc, stat) => {
    acc[stat.type] = stat.count;
    acc.total += stat.count;
    return acc;
  }, initialStats as Record<schema.UserNotification["type"] | "total", number>);

  return statsMap;
}

export async function deleteNotifications(notificationIds: string[]) {
  const deletedCount = await db
    .delete(schema.userNotificationTable)
    .where(inArray(schema.userNotificationTable.id, notificationIds))
    .returning()
    .then((rows) => rows.length);

  return deletedCount;
}
