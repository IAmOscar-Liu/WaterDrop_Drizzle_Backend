import cron from "node-cron";
import { resetDailyStats } from "../repository/treasureBox";
import {
  getFcmTokensInUserIds,
  getUserIdsInTimezones,
  getUserStatsInTimezones,
  updateGroupAdViewsCountYesterday,
} from "../repository/user";
import { CustomError } from "./error";
import { sendMulticastPushNotification } from "./sendNotification";

const RESET_BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.

// Schedule a task to run every hour to check for users in timezones at midnight.
export const dailyResetTask = cron.schedule(
  "*/30 * * * *", // every 30 minutes
  async () => {
    console.log(`30 minute cron job started. Time: ${new Date()}`);

    const timezones = (Intl as any).supportedValuesOf("timeZone") as string[];
    const timezonesAtMidnight = timezones.filter((tz) => {
      // Use Intl.DateTimeFormat for a more reliable way to get the local hour.
      const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
        timeZone: tz,
        hour: "numeric",
        minute: "numeric",
        hour12: false, // Use 24-hour format
      });
      const parts = formatter.formatToParts(new Date());
      const localHour = parseInt(
        parts.find((p) => p.type === "hour")?.value ?? "0",
        10
      );
      const localMinute = parseInt(
        parts.find((p) => p.type === "minute")?.value ?? "0",
        10
      );
      return localHour === 0 && localMinute < 30;
    });

    if (timezonesAtMidnight.length === 0) {
      console.log("No timezones at midnight.");
      return;
    }

    console.log(
      `${timezonesAtMidnight.length} timezones at midnight:`,
      timezonesAtMidnight.join(", ")
    );

    const userIds = await getUserIdsInTimezones(timezonesAtMidnight);

    for (let i = 0; i < userIds.length; i += RESET_BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + RESET_BATCH_SIZE);

      await Promise.all(
        batchUserIds.map((userId) =>
          updateGroupAdViewsCountYesterday(userId).catch((err) => {
            console.error(`Error resetting stats for user ${userId}:`, err);
          })
        )
      );

      console.log(
        `✅ Daily reset complete for current ${
          timezonesAtMidnight.length
        } timezones. Total users processed: ${i + batchUserIds.length}`
      );
    }

    for (let i = 0; i < userIds.length; i += RESET_BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + RESET_BATCH_SIZE);

      await Promise.all(
        batchUserIds.map((userId) =>
          resetDailyStats(userId).catch((err) => {
            if (err instanceof CustomError && err.statusCode === 404) return;
            console.error(`Error resetting stats for user ${userId}:`, err);
          })
        )
      );

      console.log(
        `✅ Daily reset complete for current ${
          timezonesAtMidnight.length
        } timezones. Total users processed: ${i + batchUserIds.length}`
      );
    }
  }
);

const FCM_MAX_BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.

// Schedule a task to run every hour to check for users in timezones at 21:00.
export const dailyNotificationTask = cron.schedule(
  "*/30 * * * *", // every 30 minutes
  async () => {
    console.log(`30 minute cron job started. Time: ${new Date()}`);

    const timezones = (Intl as any).supportedValuesOf("timeZone") as string[];
    const timezonesAtSpecificTime = timezones.filter((tz) => {
      // Use Intl.DateTimeFormat for a more reliable way to get the local hour.
      const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
        timeZone: tz,
        hour: "numeric",
        minute: "numeric",
        hour12: false, // Use 24-hour format
      });
      const parts = formatter.formatToParts(new Date());
      const localHour = parseInt(
        parts.find((p) => p.type === "hour")?.value ?? "0",
        10
      );
      const localMinute = parseInt(
        parts.find((p) => p.type === "minute")?.value ?? "0",
        10
      );
      return localHour === 21 && localMinute < 30;
    });

    if (timezonesAtSpecificTime.length === 0) {
      console.log("No timezones at 21:00.");
      return;
    }

    console.log(
      `${timezonesAtSpecificTime.length} timezones at 21:00:`,
      timezonesAtSpecificTime.join(", ")
    );

    const userIds = (await getUserStatsInTimezones(timezonesAtSpecificTime))
      .filter((stats) => stats.totalViews < 20)
      .map((stats) => stats.userId);
    const fcmTokens = await getFcmTokensInUserIds(userIds);

    for (let i = 0; i < fcmTokens.length; i += FCM_MAX_BATCH_SIZE) {
      const batchFcmTokens = fcmTokens.slice(i, i + FCM_MAX_BATCH_SIZE);

      await sendMulticastPushNotification({
        tokens: batchFcmTokens,
        notification: {
          title: "您尚未看完今日的廣告",
          body: "快把握時間賺取金幣吧!",
        },
        data: {
          command: "explore",
        },
      });

      console.log(
        `✅ Daily notification complete for current ${
          timezonesAtSpecificTime.length
        } timezones. Total tokens processed: ${i + batchFcmTokens.length}`
      );
    }
  }
);
