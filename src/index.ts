import "dotenv/config";
import { and, count, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./db/schema";
import { generateInvitationCode } from "./lib/generateInvitationCode";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function createUser(
  user: Omit<typeof schema.userTable.$inferInsert, "referralCode">
) {
  // await db.delete(userTable);
  // console.log("All users deleted!");

  // const user: typeof schema.userTable.$inferInsert = {

  //   referralCode: generateInvitationCode(),
  // };

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

async function getUsers() {
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
}

async function joinGroupByReferralCode(referralCode: string, userId: string) {
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

async function getUserByOauthProviderAndOauthId(
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

  const [user] = await db
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

  console.log("User by oAuth:", user);
  return user;
}

async function getDailyStatByUserId(
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

/**
 * Processes a user completing a video watch.
 * It updates their daily stats and awards a treasure box if the conditions are met.
 * @param userId The ID of the user who watched the video.
 */
async function processVideoCompletion(userId: string) {
  await db.transaction(async (tx) => {
    // Step 1: Get or create the user's daily stats for today.
    let dailyStat = await tx.query.userDailyStatTable.findFirst({
      where: eq(schema.userDailyStatTable.userId, userId),
    });

    if (!dailyStat) {
      console.log(`No daily stat found for user ${userId}. Creating one...`);
      [dailyStat] = await tx
        .insert(schema.userDailyStatTable)
        .values({ userId })
        .returning();
    }

    // Step 2: Check if the user can watch more videos today.
    if (!dailyStat.canWatchMore) {
      console.log(`User ${userId} cannot watch more videos today.`);
      return;
    }

    // Step 3: Decrement video counters
    const [updatedStat] = await tx
      .update(schema.userDailyStatTable)
      .set({
        totalViews: sql`${schema.userDailyStatTable.totalViews} + 1`,
        remainingViews: sql`${schema.userDailyStatTable.remainingViews} - 1`,
        nextTreasureBoxIn: sql`${schema.userDailyStatTable.nextTreasureBoxIn} - 1`,
      })
      .where(eq(schema.userDailyStatTable.userId, userId))
      .returning();

    console.log(
      `User ${userId} watched a video. Remaining views: ${updatedStat.remainingViews}, Next box in: ${updatedStat.nextTreasureBoxIn}`
    );

    // Step 4: Check if a treasure box should be awarded
    if (
      updatedStat.nextTreasureBoxIn <= 0 &&
      updatedStat.treasureBoxesEarned < 10
    ) {
      console.log(`Awarding a treasure box to user ${userId}...`);

      // Generate random coins for the treasure box
      const coinsAwarded = Math.floor(Math.random() * 41) + 10; // 10 to 50 coins

      // Insert new treasure box
      await tx.insert(schema.treasureBoxTable).values({
        userId: userId,
        coinsAwarded: coinsAwarded,
      });
      console.log(`Awarded a treasure box with ${coinsAwarded} coins.`);

      // Reset the counter for the next treasure box and increment earned boxes
      await tx
        .update(schema.userDailyStatTable)
        .set({
          nextTreasureBoxIn: 2,
          treasureBoxesEarned: sql`${schema.userDailyStatTable.treasureBoxesEarned} + 1`,
        })
        .where(eq(schema.userDailyStatTable.userId, userId));
    }

    // Step 5: If user has no remaining views, update their status
    if (updatedStat.remainingViews <= 0) {
      console.log(`User ${userId} has no remaining views for today.`);
      await tx
        .update(schema.userDailyStatTable)
        .set({ canWatchMore: false })
        .where(eq(schema.userDailyStatTable.userId, userId));
    }
  });
}

/**
 * Opens a treasure box for a user, adds the awarded coins to their balance,
 * and marks the box as opened.
 * @param userId The ID of the user opening the box.
 * @param treasureBoxId The ID of the treasure box to open.
 */
async function openTreasureBox(userId: string, treasureBoxId: string) {
  return db.transaction(async (tx) => {
    // Step 1: Find the treasure box and ensure it belongs to the user and is not opened.
    const [treasureBox] = await tx
      .select()
      .from(schema.treasureBoxTable)
      .where(
        and(
          eq(schema.treasureBoxTable.id, treasureBoxId),
          eq(schema.treasureBoxTable.userId, userId)
        )
      );

    if (!treasureBox) {
      throw new Error(
        "Treasure box not found or you don't have permission to open it."
      );
    }

    if (treasureBox.isOpened) {
      throw new Error("This treasure box has already been opened.");
    }

    // Step 2: Update the user's coin balance.
    const [updatedUser] = await tx
      .update(schema.userTable)
      .set({
        coins: sql`${schema.userTable.coins} + ${treasureBox.coinsAwarded}`,
      })
      .where(eq(schema.userTable.id, userId))
      .returning({
        id: schema.userTable.id,
        name: schema.userTable.name,
        coins: schema.userTable.coins,
      });

    if (!updatedUser) {
      // This should theoretically not happen if the user exists for the treasure box
      throw new Error("User not found.");
    }

    console.log(
      `User "${updatedUser.name}" claimed ${treasureBox.coinsAwarded} coins! New balance: ${updatedUser.coins}.`
    );

    // Step 3: Mark the treasure box as opened.
    await tx
      .update(schema.treasureBoxTable)
      .set({
        isOpened: true,
        openedAt: new Date(),
      })
      .where(eq(schema.treasureBoxTable.id, treasureBoxId));

    console.log(`Treasure box ${treasureBoxId} has been opened.`);

    return updatedUser;
  });
}

// createUser({
//   oauthProvider: "google",
//   oauthId: "llkjafdafedadfaf",
//   email: "ddtor@lksdfdd.com",
//   name: "Ian",
//   phone: "0234775599",
// });
// getUsers();
// getUserByOauthProviderAndOauthId("google", "dasfafaf22dddddsss");
// joinGroupByReferralCode("JEF1eS", "018dffd0-f397-4085-9413-215aa83e1592");
// getDailyStatByUserId("018dffd0-f397-4085-9413-215aa83e1592");
// processVideoCompletion("018dffd0-f397-4085-9413-215aa83e1592");
openTreasureBox(
  "018dffd0-f397-4085-9413-215aa83e1592",
  "0809eb10-c232-4259-b88d-0822eaeae4be"
);
