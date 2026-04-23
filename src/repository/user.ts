import {
  and,
  count,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  lt,
  sql,
} from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import {
  generateInvitationCode,
  getCurrentLocalDateTime,
  getLastMonthYYYYMM,
  getNumOfDaysInMonth,
} from "../lib/general";
import { getMemberInfo } from "../lib/getMemberInfo";
import db from "../lib/initDB";

export async function createUser(
  user: Omit<typeof schema.userTable.$inferInsert, "referralCode">,
) {
  let referralCode: string;
  let isCodeUnique = false;

  // Loop until a unique referral code is generated.
  do {
    referralCode = generateInvitationCode();
    const [existingUser] = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.referralCode, referralCode))
      .limit(1);

    if (!existingUser) {
      isCodeUnique = true;
    }
  } while (!isCodeUnique);

  const [newUser] = await db
    .insert(schema.userTable)
    .values({ ...user, referralCode })
    .returning();
  console.log("New user created with id:", newUser.id);

  await db
    .insert(schema.userDailyStatTable)
    .values({ userId: newUser.id })
    .returning();

  return newUser;
}

export async function getUsers() {
  const groupCounts = db
    .select({
      groupId: schema.userTable.groupId,
      referralCount: count(schema.userTable.id).as("referral_count"),
    })
    .from(schema.userTable)
    .where(isNotNull(schema.userTable.groupId))
    .groupBy(schema.userTable.groupId)
    .as("group_counts");

  const users = await db
    .select({
      ...getTableColumns(schema.userTable),
      referralCount:
        sql<number>`coalesce(${groupCounts.referralCount}, 0)`.mapWith(Number),
    })
    .from(schema.userTable)
    // .leftJoin(groupCounts, eq(schema.userTable.groupId, groupCounts.groupId));
    .leftJoin(
      schema.groupTable,
      eq(schema.userTable.id, schema.groupTable.ownerId),
    )
    .leftJoin(groupCounts, eq(schema.groupTable.id, groupCounts.groupId));

  console.log("No. of users: ", users.length);
  return users;
}

export async function getUserIdsInTimezones(timezones: string[]) {
  const users = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(inArray(schema.userTable.timezone, timezones));

  return users.map((u) => u.id);
}

export async function getUserStatsInTimezones(timezones: string[]) {
  const userIds = await getUserIdsInTimezones(timezones);

  if (userIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(schema.userDailyStatTable)
    .where(inArray(schema.userDailyStatTable.userId, userIds));
}

export async function getFcmTokensInUserIds(userIds: string[]) {
  const deviceTokens = await db
    .select({ fcmToken: schema.deviceTokenTable.fcmToken })
    .from(schema.deviceTokenTable)
    .where(inArray(schema.deviceTokenTable.userId, userIds));
  return deviceTokens.map((d) => d.fcmToken);
}

export async function getUserMonthlyCoinStatsInUserIds(
  userIds: string[],
  month: string,
) {
  if (userIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(schema.userMonthlyCoinStatTable)
    .where(
      and(
        inArray(schema.userMonthlyCoinStatTable.userId, userIds),
        eq(schema.userMonthlyCoinStatTable.month, month),
      ),
    );
}

export async function updateUserTimezone(userId: string, timezone: string) {
  const [updatedUser] = await db
    .update(schema.userTable)
    .set({
      timezone,
      updatedAt: new Date(), // Explicitly update the timestamp
    })
    .where(eq(schema.userTable.id, userId))
    .returning();

  if (!updatedUser) {
    throw new CustomError(`User with id "${userId}" not found.`, 404);
  }

  console.log(`User ${userId} timezone updated to ${timezone}`);
  return updatedUser;
}

/**
 * Creates or updates a device token record.
 * Follows (userId, deviceId) uniqueness: if a row exists for the pair,
 * updates its fcmToken and lastUsedAt; otherwise inserts a new row.
 * @param userId The ID of the user.
 * @param fcmToken The FCM device token.
 * @param deviceId Optional device identifier used with userId for upsert.
 */
export async function upsertDeviceToken({
  userId,
  fcmToken,
  deviceId,
}: {
  userId: string;
  fcmToken: string;
  deviceId?: string;
}) {
  const [deviceToken] = await db
    .insert(schema.deviceTokenTable)
    .values({ userId, fcmToken, deviceId })
    .onConflictDoUpdate({
      target: [
        schema.deviceTokenTable.userId,
        schema.deviceTokenTable.deviceId,
      ],
      set: { fcmToken, lastUsedAt: new Date() },
    })
    .returning();

  return deviceToken;
}

export async function clearDeviceToken({
  userId,
  deviceId,
}: {
  userId: string;
  deviceId?: string | null;
}) {
  if (deviceId == null) {
    const deletedByUser = await db
      .delete(schema.deviceTokenTable)
      .where(eq(schema.deviceTokenTable.userId, userId))
      .returning();
    return deletedByUser;
  }

  const deletedByUserAndDevice = await db
    .delete(schema.deviceTokenTable)
    .where(
      and(
        eq(schema.deviceTokenTable.userId, userId),
        eq(schema.deviceTokenTable.deviceId, deviceId),
      ),
    )
    .returning();

  return deletedByUserAndDevice;
}

export async function deleteUnusedDeviceTokens(unusedInMs: number) {
  const cutoffTime = new Date(Date.now() - unusedInMs);

  const deletedTokens = await db
    .delete(schema.deviceTokenTable)
    .where(lt(schema.deviceTokenTable.lastUsedAt, cutoffTime))
    .returning();

  return deletedTokens;
}

export async function setMonthlyCoinExpire(userIds: string[], month: string) {
  const monthlyCoinStats = await db
    .update(schema.userMonthlyCoinStatTable)
    .set({ expired: true })
    .where(
      and(
        inArray(schema.userMonthlyCoinStatTable.userId, userIds),
        lt(schema.userMonthlyCoinStatTable.month, month),
        eq(schema.userMonthlyCoinStatTable.expired, false),
      ),
    )
    .returning();

  const userUnusedCoins: Record<string, number> = {};
  for (const stat of monthlyCoinStats) {
    if (!userUnusedCoins[stat.userId]) {
      userUnusedCoins[stat.userId] = stat.coinsEarned - stat.coinsSpent;
    } else {
      userUnusedCoins[stat.userId] += stat.coinsEarned - stat.coinsSpent;
    }
  }

  const updateUserIds = Object.keys(userUnusedCoins);

  const BATCH_SIZE = 100;
  for (let i = 0; i < updateUserIds.length; i += BATCH_SIZE) {
    const batchUserIds = updateUserIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batchUserIds.map((userId) =>
        db
          .update(schema.userTable)
          .set({
            coins: sql`${schema.userTable.coins} - ${userUnusedCoins[userId]}`,
          })
          .where(eq(schema.userTable.id, userId)),
      ),
    );
  }
}

export async function updateUser(
  userId: string,
  data: Partial<Pick<schema.User, "name" | "phone" | "address" | "email">>,
) {
  const [updatedUser] = await db
    .update(schema.userTable)
    .set({
      ...data,
      updatedAt: new Date(), // Explicitly update the timestamp
    })
    .where(eq(schema.userTable.id, userId))
    .returning();

  if (!updatedUser) {
    throw new CustomError(`User with id "${userId}" not found.`, 404);
  }

  console.log(`User ${userId} updated`);
  return updatedUser;
}

export async function validateReferralCode(referralCode: string) {
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.referralCode, referralCode));

  if (!user) {
    throw new CustomError(`Referral code "${referralCode}" not found.`, 404);
  }

  console.log(`Referral code "${referralCode}" is valid for user:`, user.id);
  return user;
}

export async function joinGroupByReferralCode(
  referralCode: string,
  userId: string,
) {
  const [referrer] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.referralCode, referralCode));

  if (!referrer) {
    throw new CustomError(`Referral code "${referralCode}" not found.`, 404);
  }

  // Prevent a user from using their own referral code
  if (referrer.id === userId) {
    throw new CustomError("You cannot use your own referral code.", 400);
  }

  // 2. Find the group owned by the referrer
  let [group] = await db
    .select()
    .from(schema.groupTable)
    .where(eq(schema.groupTable.ownerId, referrer.id));

  // 3. If the group doesn't exist, create it
  if (!group) {
    console.log(
      `Referrer ${referrer.name} does not have a group. Creating one...`,
    );
    [group] = await db
      .insert(schema.groupTable)
      .values({ ownerId: referrer.id })
      .returning();
    console.log(`New group created with id: ${group.id}`);
  }

  // 4. Make the current user join the group
  const [updatedUser] = await db
    .update(schema.userTable)
    .set({ groupId: group.id })
    .where(eq(schema.userTable.id, userId))
    .returning();

  if (!updatedUser) {
    throw new CustomError(`User with id "${userId}" not found.`, 404);
  }

  console.log(
    `User "${updatedUser.name}" has joined group ${group.id}, owned by "${referrer.name}".`,
  );

  return updatedUser;
}

export async function getSimpleUserById(id: string) {
  const [user] = await db
    .select({
      id: schema.userTable.id,
      name: schema.userTable.name,
      email: schema.userTable.email,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, id));

  if (!user) return null;
  console.log("Simple user by id:", user.id);
  return user;
}

export async function getUserById(id: string) {
  const groupCounts = db
    .select({
      groupId: schema.userTable.groupId,
      referralCount: count(schema.userTable.id).as("referral_count"),
    })
    .from(schema.userTable)
    .where(isNotNull(schema.userTable.groupId))
    .groupBy(schema.userTable.groupId)
    .as("group_counts");

  const [user] = await db
    .select({
      ...getTableColumns(schema.userTable),
      referralCount:
        sql<number>`coalesce(${groupCounts.referralCount}, 0)`.mapWith(Number),
    })
    .from(schema.userTable)
    .leftJoin(
      schema.groupTable,
      eq(schema.userTable.id, schema.groupTable.ownerId),
    )
    .leftJoin(groupCounts, eq(schema.groupTable.id, groupCounts.groupId))
    .where(eq(schema.userTable.id, id));

  if (!user) return null;
  console.log("User by id:", user.id);
  return {
    ...user,
    ...getMemberInfo(user.referralCount),
    coinsExpireSoon: await getCoinsExpireSoon(user.id, user.timezone),
  };
}

export async function getUserByOauthProviderAndOauthId(
  oauthProvider: schema.User["oauthProvider"],
  oauthId: string,
) {
  const groupCounts = db
    .select({
      groupId: schema.userTable.groupId,
      referralCount: count(schema.userTable.id).as("referral_count"),
    })
    .from(schema.userTable)
    .where(isNotNull(schema.userTable.groupId))
    .groupBy(schema.userTable.groupId)
    .as("group_counts");

  let [user] = await db
    .select({
      ...getTableColumns(schema.userTable),
      referralCount:
        sql<number>`coalesce(${groupCounts.referralCount}, 0)`.mapWith(Number),
    })
    .from(schema.userTable)
    .leftJoin(
      schema.groupTable,
      eq(schema.userTable.id, schema.groupTable.ownerId),
    )
    .leftJoin(groupCounts, eq(schema.groupTable.id, groupCounts.groupId))
    .where(
      and(
        eq(schema.userTable.oauthProvider, oauthProvider),
        eq(schema.userTable.oauthId, oauthId),
      ),
    );

  if (!user) return null;
  console.log("User by oAuth:", user.id);
  return {
    ...user,
    ...getMemberInfo(user.referralCount),
    coinsExpireSoon: await getCoinsExpireSoon(user.id, user.timezone),
  };
}

export async function getDailyStatByUserId(
  userId: string,
): Promise<schema.UserDailyStat> {
  // Find the user and their daily stat in one query
  const userWithStat = await db.query.userTable.findFirst({
    where: eq(schema.userTable.id, userId),
    with: {
      dailyStat: true,
    },
  });

  if (!userWithStat) {
    throw new CustomError(`User with id "${userId}" not found.`, 404);
  }

  // If the daily stat already exists, return it
  if (userWithStat.dailyStat) {
    console.log("Found existing daily stat:", userWithStat.dailyStat.id);
    return userWithStat.dailyStat;
  }

  // If it doesn't exist, create it with default values
  console.log(`No daily stat found for user ${userId}. Creating one...`);
  const [newStat] = await db
    .insert(schema.userDailyStatTable)
    .values({ userId: userId })
    .returning();

  console.log("New daily stat created:", newStat.id);
  return newStat;
}

export async function updateGroupAdViewsCountYesterday(userId: string) {
  return db.transaction(async (tx) => {
    let userIdsInGroup: string[] = [];

    // Find the group owned by the user
    const [group] = await tx
      .select({ id: schema.groupTable.id })
      .from(schema.groupTable)
      .where(eq(schema.groupTable.ownerId, userId));

    if (group) {
      // Get all users in that group
      const usersInGroup = await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.groupId, group.id));

      userIdsInGroup = usersInGroup.map((u) => u.id);
    }

    // Also include the owner
    const allUserIds = [...userIdsInGroup, userId];

    const results = await tx
      .select({ totalViews: schema.userDailyStatTable.totalViews })
      .from(schema.userDailyStatTable)
      .where(and(inArray(schema.userDailyStatTable.userId, allUserIds)));

    const groupAdViewsCountYesterday = results.reduce(
      (total, result) => total + result.totalViews,
      0,
    );

    const [updatedStat] = await tx
      .update(schema.userDailyStatTable)
      .set({ groupAdViewsCountYesterday })
      .where(eq(schema.userDailyStatTable.userId, userId))
      .returning();
    return updatedStat;
  });
}

async function getCoinsExpireSoon(userId: string, timezone?: string | null) {
  if (!timezone) return null;

  const { localMonth, localDay } = getCurrentLocalDateTime(timezone);
  if (localDay <= getNumOfDaysInMonth(localMonth) - 7) return null;

  const yearMonthString = getLastMonthYYYYMM(timezone);

  const [userMonthlyCoinStat] = await db
    .select()
    .from(schema.userMonthlyCoinStatTable)
    .where(
      and(
        eq(schema.userMonthlyCoinStatTable.userId, userId),
        eq(schema.userMonthlyCoinStatTable.month, yearMonthString),
        eq(schema.userMonthlyCoinStatTable.expired, false),
      ),
    );

  return userMonthlyCoinStat
    ? userMonthlyCoinStat.coinsEarned - userMonthlyCoinStat.coinsSpent
    : null;
}

export async function updateUserTermsAcceptedAt(userId: string) {
  const [updatedUser] = await db
    .update(schema.userTable)
    .set({ termsAcceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.userTable.id, userId))
    .returning();

  if (!updatedUser) throw new CustomError("User not found", 404);

  return await getUserById(userId);
}
