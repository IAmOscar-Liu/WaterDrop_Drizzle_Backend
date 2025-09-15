import { and, count, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { generateInvitationCode } from "../lib/generateInvitationCode";
import db from "../lib/initDB";
import { getMemberInfo } from "../lib/getMemberInfo";

export async function createUser(
  user: Omit<typeof schema.userTable.$inferInsert, "referralCode">
) {
  // await db.delete(userTable);

  const [newUser] = await db
    .insert(schema.userTable)
    .values({
      ...user,
      referralCode: generateInvitationCode(),
    })
    .returning();
  console.log("New user created with id:", newUser.id);

  await db
    .insert(schema.userDailyStatTable)
    .values({ userId: newUser.id })
    .returning();
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
      eq(schema.userTable.id, schema.groupTable.ownerId)
    )
    .leftJoin(groupCounts, eq(schema.groupTable.id, groupCounts.groupId));

  console.log("Users:", users);
  return users;
}

export async function joinGroupByReferralCode(
  referralCode: string,
  userId: string
) {
  const [referrer] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.referralCode, referralCode));

  if (!referrer) {
    throw new Error(`Referral code "${referralCode}" not found.`);
  }

  // Prevent a user from using their own referral code
  if (referrer.id === userId) {
    throw new Error("You cannot use your own referral code.");
  }

  // 2. Find the group owned by the referrer
  let [group] = await db
    .select()
    .from(schema.groupTable)
    .where(eq(schema.groupTable.ownerId, referrer.id));

  // 3. If the group doesn't exist, create it
  if (!group) {
    console.log(
      `Referrer ${referrer.name} does not have a group. Creating one...`
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
    throw new Error(`User with id "${userId}" not found.`);
  }

  console.log(
    `User "${updatedUser.name}" has joined group ${group.id}, owned by "${referrer.name}".`
  );

  return updatedUser;
}

export async function getUserByOauthProviderAndOauthId(
  oauthProvider: schema.User["oauthProvider"],
  oauthId: string
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

  const users = await db
    .select({
      ...getTableColumns(schema.userTable),
      referralCount:
        sql<number>`coalesce(${groupCounts.referralCount}, 0)`.mapWith(Number),
    })
    .from(schema.userTable)
    .leftJoin(
      schema.groupTable,
      eq(schema.userTable.id, schema.groupTable.ownerId)
    )
    .leftJoin(groupCounts, eq(schema.groupTable.id, groupCounts.groupId))
    .where(
      and(
        eq(schema.userTable.oauthProvider, oauthProvider),
        eq(schema.userTable.oauthId, oauthId)
      )
    );

  let user = users[0];
  if (user) user = { ...user, ...getMemberInfo(user.referralCount) };
  console.log("User by oAuth:", user);
  return user;
}

export async function getDailyStatByUserId(
  userId: string
): Promise<schema.UserDailyStat> {
  // Find the user and their daily stat in one query
  const userWithStat = await db.query.userTable.findFirst({
    where: eq(schema.userTable.id, userId),
    with: {
      dailyStat: true,
    },
  });

  if (!userWithStat) {
    throw new Error(`User with id "${userId}" not found.`);
  }

  // If the daily stat already exists, return it
  if (userWithStat.dailyStat) {
    console.log("Found existing daily stat:", userWithStat.dailyStat);
    return userWithStat.dailyStat;
  }

  // If it doesn't exist, create it with default values
  console.log(`No daily stat found for user ${userId}. Creating one...`);
  const [newStat] = await db
    .insert(schema.userDailyStatTable)
    .values({ userId: userId })
    .returning();

  console.log("New daily stat created:", newStat);
  return newStat;
}
