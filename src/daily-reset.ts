import "./lib/env";

import { CustomError } from "./lib/error";
import { resetDailyStats } from "./repository/treasureBox";
import {
  getUserIdsInTimezones,
  updateGroupAdViewsCountYesterday,
} from "./repository/user";

const RESET_BATCH_SIZE = 100;

async function testDailyReset() {
  const userIds = await getUserIdsInTimezones(["Asia/Taipei"]);

  for (let i = 0; i < userIds.length; i += RESET_BATCH_SIZE) {
    const batchUserIds = userIds.slice(i, i + RESET_BATCH_SIZE);

    await Promise.all(
      batchUserIds.map((userId) =>
        updateGroupAdViewsCountYesterday(userId).catch((err) => {
          console.error(`Error resetting stats for user ${userId}:`, err);
        }),
      ),
    );

    console.log(`Total users processed: ${i + batchUserIds.length}`);
  }

  for (let i = 0; i < userIds.length; i += RESET_BATCH_SIZE) {
    const batchUserIds = userIds.slice(i, i + RESET_BATCH_SIZE);

    await Promise.all(
      batchUserIds.map((userId) =>
        resetDailyStats(userId).catch((err) => {
          if (err instanceof CustomError && err.statusCode === 404) return;
          console.error(`Error resetting stats for user ${userId}:`, err);
        }),
      ),
    );

    console.log(`Total users processed: ${i + batchUserIds.length}`);
  }
}

testDailyReset();
