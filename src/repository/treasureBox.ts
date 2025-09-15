import { and, count, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { generateInvitationCode } from "../lib/generateInvitationCode";
import db from "../lib/initDB";

/**
 * Processes a user completing a video watch.
 * It updates their daily stats and awards a treasure box if the conditions are met.
 * @param userId The ID of the user who watched the video.
 */
export async function processVideoCompletion(userId: string) {
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
export async function openTreasureBox(userId: string, treasureBoxId: string) {
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

/**
 * Retrieves all treasure boxes for a given user, sorted by most recently earned.
 * @param userId The ID of the user.
 * @returns A promise that resolves to an array of treasure boxes.
 */
export async function getTreasureBoxesByUserId(userId: string) {
  const treasureBoxes = await db.query.treasureBoxTable.findMany({
    where: eq(schema.treasureBoxTable.userId, userId),
    orderBy: (treasureBoxes, { desc }) => [desc(treasureBoxes.earnedAt)],
  });

  console.log(`\nTreasure boxes for user ${userId}:`, treasureBoxes);
  return treasureBoxes;
}
