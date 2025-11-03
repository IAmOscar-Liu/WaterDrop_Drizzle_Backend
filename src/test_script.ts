import "dotenv/config";
import { createNotification } from "./repository/notification";
import {
  getFcmTokensInUserIds,
  getUserIdsInTimezones,
  getUserMonthlyCoinStatsInUserIds,
  setMonthlyCoinExpire,
} from "./repository/user";
import { getCurrentYearMonthString } from "./lib/general";
import { sendMulticastPushNotification } from "./lib/sendNotification";

const FCM_MAX_BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.
const RESET_BATCH_SIZE = 100;

// export async function testScript() {
//   console.log(await getUserById("e9b24ffc-7bc4-4c74-ab4a-d7983e20b314"));
// }

export async function testScript() {
  let userIds = await getUserIdsInTimezones(["Asia/Taipei"]);

  if (userIds.length === 0) {
    console.log("No users found in the targeted timezones.");
    return;
  }

  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const yearMonthString = getCurrentYearMonthString("Asia/Taipei", now); // yyyy-mm

  const userMonthlyCoinStats = (
    await getUserMonthlyCoinStatsInUserIds(userIds, yearMonthString)
  ).filter((stat) => stat.coinsEarned > stat.coinsSpent);

  for (let i = 0; i < userMonthlyCoinStats.length; i += RESET_BATCH_SIZE) {
    const batchCoinStats = userMonthlyCoinStats.slice(i, i + RESET_BATCH_SIZE);

    await Promise.allSettled(
      batchCoinStats.map((stat) =>
        createNotification({
          userId: stat.userId,
          type: "system_alert",
          title: "金幣即將過期通知",
          body: `您${now.getMonth() + 1}月份的金幣尚有${
            stat.coinsEarned - stat.coinsSpent
          }未使用，即將在 ${
            now.getMonth() + 3
          }/01 00:00 過期，快把握時間使用您的金幣吧!`,
        })
      )
    );
  }

  userIds = userMonthlyCoinStats.map((stats) => stats.userId);

  const fcmTokens = await getFcmTokensInUserIds(userIds);
  for (let i = 0; i < fcmTokens.length; i += FCM_MAX_BATCH_SIZE) {
    const batchFcmTokens = fcmTokens.slice(i, i + FCM_MAX_BATCH_SIZE);

    await sendMulticastPushNotification({
      tokens: batchFcmTokens,
      notification: {
        title: "金幣即將過期通知",
        body: `您${now.getMonth() + 1}月份的金幣即將在 ${
          now.getMonth() + 3
        }/01 00:00 過期，快把握時間使用您的金幣吧!`,
      },
      data: {
        command: "message",
      },
    });

    console.log(`Total tokens processed: ${i + batchFcmTokens.length}`);
  }
}

// testScript();

async function testScript2() {
  setMonthlyCoinExpire(["236511b2-cab3-45bb-88d6-8208e9ed7ab5"], "2025-10");
}

testScript2();
