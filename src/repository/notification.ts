import { and, count, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { canonicalNotification, createNotificationRecord, getSyncNotification, legacyNotification, mutateNotifications, requireNotificationUser } from "./notificationSync";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";

export async function createNotification(notificationData: schema.NewUserNotification) {
  return legacyNotification(await createNotificationRecord(notificationData));
}

export async function markNotificationsAsRead(userId: string, notificationIds: string[]) {
  return (await mutateNotifications(userId, notificationIds, "read")).legacyReadItems.map(legacyNotification);
}

export async function getNotificationById(notificationId: string, userId: string) {
  return legacyNotification(await getSyncNotification(userId, notificationId));
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
  await requireNotificationUser(db, userId);
  const pagination = getPagination(page, limit);

  const whereClause = compactConditions([
    eq(schema.userNotificationTable.userId, userId),
    isNull(schema.userNotificationTable.deletedAt),
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
    notifications: notifications.map((row) => legacyNotification(canonicalNotification(row))),
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
  await requireNotificationUser(db, userId);
  const stats = await db
    .select({
      type: schema.userNotificationTable.type,
      count: count(),
    })
    .from(schema.userNotificationTable)
    .where(
      and(
        eq(schema.userNotificationTable.userId, userId),
        isNull(schema.userNotificationTable.deletedAt),
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

export async function deleteNotifications(notificationIds: string[], userId: string) {
  return (await mutateNotifications(userId, notificationIds, "delete")).changedCount;
}

export async function resolveAppPushAudience({
  userIds = [],
  groupIds = [],
}: {
  userIds?: string[];
  groupIds?: string[];
}) {
  const targetUserIds = new Set<string>();

  if (userIds.length > 0) {
    const users = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(inArray(schema.userTable.id, userIds));
    users.forEach(({ id }) => targetUserIds.add(id));
  }

  if (groupIds.length > 0) {
    const [members, owners] = await Promise.all([
      db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(inArray(schema.userTable.groupId, groupIds)),
      db
        .select({ id: schema.groupTable.ownerId })
        .from(schema.groupTable)
        .where(inArray(schema.groupTable.id, groupIds)),
    ]);

    members.forEach(({ id }) => targetUserIds.add(id));
    owners.forEach(({ id }) => targetUserIds.add(id));
  }

  if (targetUserIds.size === 0) {
    return { userIds: [], tokens: [] };
  }

  const tokens = await db
    .select({ token: schema.deviceTokenTable.fcmToken })
    .from(schema.deviceTokenTable)
    .where(
      inArray(schema.deviceTokenTable.userId, Array.from(targetUserIds)),
    );

  return {
    userIds: Array.from(targetUserIds),
    tokens: Array.from(new Set(tokens.map(({ token }) => token))),
  };
}
