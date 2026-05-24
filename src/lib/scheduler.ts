import cron from "node-cron";
import { resetDailyStats } from "../repository/treasureBox";
import {
  deleteUnusedDeviceTokens,
  getFcmTokensInUserIds,
  getUserIdsInTimezones,
  getUserMonthlyCoinStatsInUserIds,
  getUserStatsInTimezones,
  setMonthlyCoinExpire,
  updateGroupAdViewsCountYesterday,
} from "../repository/user";
import { CustomError } from "./error";
import {
  getCurrentLocalDateTime,
  getLastMonthYYYYMM,
  getNumOfDaysInMonth,
} from "./general";
import { sendMulticastPushNotification } from "./sendNotification";
import { createNotification } from "../repository/notification";
import {
  deleteIdempotencyKeys,
  expirePendingOrders,
  expirePaymentProcessingOrders,
} from "../repository/order";
import { pollEcPayLogisticsTradeInfo } from "./polling";
import { Worker } from "worker_threads";
import path from "path";
import { existsSync } from "fs";

const RESET_BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.

// Schedule a task to run every hour to check for users in timezones at midnight.
export const dailyResetTask = cron.schedule(
  "*/30 * * * *", // every 30 minutes
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `30 minute cron job for dailyResetTask started. Time: ${new Date()}`,
    );

    const timezones = (Intl as any).supportedValuesOf("timeZone") as string[];
    const timezonesAtMidnight = timezones.filter((tz) => {
      const { localHour, localMinute } = getCurrentLocalDateTime(tz);
      return localHour === 0 && localMinute < 30;
    });

    if (timezonesAtMidnight.length === 0) {
      console.log("No timezones at midnight.");
      return;
    }

    console.log(
      `${timezonesAtMidnight.length} timezones at midnight:`,
      timezonesAtMidnight.join(", "),
    );

    const userIds = await getUserIdsInTimezones(timezonesAtMidnight);

    for (let i = 0; i < userIds.length; i += RESET_BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + RESET_BATCH_SIZE);

      await Promise.all(
        batchUserIds.map((userId) =>
          updateGroupAdViewsCountYesterday(userId).catch((err) => {
            console.error(`Error resetting stats for user ${userId}:`, err);
          }),
        ),
      );

      console.log(
        `✅ Daily reset complete for current ${
          timezonesAtMidnight.length
        } timezones. Total users processed: ${i + batchUserIds.length}`,
      );
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

      console.log(
        `✅ Daily reset complete for current ${
          timezonesAtMidnight.length
        } timezones. Total users processed: ${i + batchUserIds.length}`,
      );
    }
  },
);

const FCM_MAX_BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.

// Schedule a task to run every hour to check for users in timezones at 21:00.
export const dailyNotificationTask = cron.schedule(
  "*/30 * * * *", // every 30 minutes
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `30 minute cron job for dailyNotificationTask started. Time: ${new Date()}`,
    );

    const timezones = (Intl as any).supportedValuesOf("timeZone") as string[];
    const timezonesAtSpecificTime = timezones.filter((tz) => {
      const { localHour, localMinute } = getCurrentLocalDateTime(tz);
      return localHour === 21 && localMinute < 30;
    });

    if (timezonesAtSpecificTime.length === 0) {
      console.log("No timezones at 21:00.");
      return;
    }

    console.log(
      `${timezonesAtSpecificTime.length} timezones at 21:00:`,
      timezonesAtSpecificTime.join(", "),
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
        } timezones. Total tokens processed: ${i + batchFcmTokens.length}`,
      );
    }
  },
);

// New cron job for monthly coin stat expiration
// This job runs every 30 minutes, checks for timezones where it's the first day of the month,
// and expires coin stats for users in those timezones.
export const monthlyCoinStatExpirationTask = cron.schedule(
  "*/30 * 1,28,29,30,31 * *", // Every 30 minutes, on day the last day and 1 of the month
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `30 minute cron job for monthlyCoinStatExpirationTask started. Time: ${new Date()}`,
    );

    try {
      const timezones = (Intl as any).supportedValuesOf("timeZone") as string[];
      const timezonesAtStartOfMonth = timezones.filter((tz) => {
        const { localDay, localHour, localMinute } =
          getCurrentLocalDateTime(tz);

        // Check if it's the first day of the month and the first hour (00:00 - 00:59).
        return localDay === 1 && localHour === 0 && localMinute < 30;
      });

      if (timezonesAtStartOfMonth.length === 0) {
        console.log("No timezones at the start of a new month.");
        return;
      }

      console.log(
        `Found ${timezonesAtStartOfMonth.length} timezones at the start of a month:`,
        timezonesAtStartOfMonth.join(", "),
      );

      const userIds = await getUserIdsInTimezones(timezonesAtStartOfMonth);

      if (userIds.length === 0) {
        console.log("No users found in the targeted timezones.");
        return;
      }

      // Get the year and month of the *previous* month.
      const yearMonthString = getLastMonthYYYYMM(timezonesAtStartOfMonth[0]); // yyyy-mm

      // For these users, expire all their monthly stats. The logic to keep the current month active
      // is handled by creating a new entry when coins are earned/spent.
      await setMonthlyCoinExpire(userIds, yearMonthString);

      console.log(
        `✅ Monthly coin stat expiration complete for ${userIds.length} users.`,
      );
    } catch (error) {
      console.error("Error during monthly coin stat expiration:", error);
    }
  },
);

export const monthlyCoinExpirationNotificationTask = cron.schedule(
  "*/30 * 21-31 * *", // Every 30 minutes, 8 days before the end of the month
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `30 minute cron job for monthlyCoinExpirationNotificationTask started. Time: ${new Date()}`,
    );

    const timezones = (Intl as any).supportedValuesOf("timeZone") as string[];
    const timezonesAtSpecificTime = timezones.filter((tz) => {
      const { localMonth, localDay, localHour, localMinute } =
        getCurrentLocalDateTime(tz);
      return (
        localDay > getNumOfDaysInMonth(localMonth) - 7 &&
        localHour === 6 &&
        localMinute < 30
      );
    });

    if (timezonesAtSpecificTime.length === 0) {
      console.log("No timezones at 6:00.");
      return;
    }

    console.log(
      `${timezonesAtSpecificTime.length} timezones at 6:00:`,
      timezonesAtSpecificTime.join(", "),
    );

    let userIds = await getUserIdsInTimezones(timezonesAtSpecificTime);

    if (userIds.length === 0) {
      console.log("No users found in the targeted timezones.");
      return;
    }

    const yearMonthString = getLastMonthYYYYMM(timezonesAtSpecificTime[0]); // yyyy-mm

    const userMonthlyCoinStats = (
      await getUserMonthlyCoinStatsInUserIds(userIds, yearMonthString)
    ).filter((stat) => stat.coinsEarned > stat.coinsSpent);

    const { localMonth, localYear } = getCurrentLocalDateTime(
      timezonesAtSpecificTime[0],
    );
    const lastMonth = localMonth === 1 ? 12 : localMonth - 1;
    const nextMonth = localMonth === 12 ? 1 : localMonth + 1;
    const nextYear = localMonth === 12 ? localYear + 1 : localYear;

    for (let i = 0; i < userMonthlyCoinStats.length; i += RESET_BATCH_SIZE) {
      const batchCoinStats = userMonthlyCoinStats.slice(
        i,
        i + RESET_BATCH_SIZE,
      );

      await Promise.allSettled(
        batchCoinStats.map((stat) =>
          createNotification({
            userId: stat.userId,
            type: "system_alert",
            title: "金幣即將過期通知",
            body: `您${lastMonth}月份的金幣尚有${
              stat.coinsEarned - stat.coinsSpent
            }未使用，即將在 ${nextYear}/${nextMonth
              .toString()
              .padStart(2, "0")}/01 00:00 過期，快把握時間使用您的金幣吧!`,
          }),
        ),
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
          body: `您${lastMonth}月份的金幣即將在 ${nextYear}/${nextMonth
            .toString()
            .padStart(2, "0")}/01 00:00 過期，快把握時間使用您的金幣吧!`,
        },
        data: {
          command: "message",
        },
      });

      console.log(
        `✅ Daily notification complete for current ${
          timezonesAtSpecificTime.length
        } timezones. Total tokens processed: ${i + batchFcmTokens.length}`,
      );
    }
  },
);

export const deleteUnusedDeviceTokensTask = cron.schedule(
  "0 * * * *", // every hour
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `Hourly cron job for deleteUnusedDeviceTokensTask started. Time: ${new Date()}`,
    );

    try {
      const result = await deleteUnusedDeviceTokens(60 * 24 * 60 * 60 * 1000); // 2 months ago
      console.log(`Deleted ${result.length} unused device tokens.`);
    } catch (error) {
      console.error(`Error during deleteUnusedDeviceTokensTask:`, error);
    }
  },
);

export const expireOrdersTask = cron.schedule(
  "*/30 * * * *", // every 30 minutes
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `30 minute cron job for expireOrdersTask started. Time: ${new Date()}`,
    );
    try {
      const [pendingResult, paymentProcessingResult] = await Promise.all([
        expirePendingOrders(30 * 60 * 1000), // 30 minutes ago
        expirePaymentProcessingOrders(2 * 24 * 60 * 60 * 1000), // 2 days ago
      ]);
      console.log(
        `${pendingResult.length + paymentProcessingResult.length} orders expired.`,
      );
    } catch (error) {
      console.error(`Error during expireOrdersTask:`, error);
    }
  },
);

export const pollLogisticsTradeInfoTask = cron.schedule(
  "*/30 * * * *", // every 30 minutes
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `30 minute cron job for pollLogisticsTradeInfoTask started. Time: ${new Date()}`,
    );
    try {
      await pollEcPayLogisticsTradeInfo();
    } catch (error) {
      console.error(`Error during pollLogisticsTradeInfoTask:`, error);
    }
  },
);

// Run ECPay store list refresh once daily at 02:00 Asia/Taipei
export const fetchEcPayStoreListTask = cron.schedule(
  "0 2 * * *",
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `Scheduled 02:00 (Asia/Taipei) job: fetchEcPayStoreListTask started. Time: ${new Date()}`,
    );

    try {
      const tsFile = path.resolve(process.cwd(), "src/ecpay-storeList.ts");
      const jsFile = path.resolve(process.cwd(), "dist/ecpay-storeList.js");

      const workerFile = existsSync(jsFile) ? jsFile : tsFile;
      const useTsRunner = workerFile === tsFile;

      const worker = new Worker(workerFile, {
        ...(useTsRunner
          ? { execArgv: ["-r", "ts-node/register/transpile-only"] }
          : {}),
        workerData: {
          outDir: "src/assets/json",
        },
      });

      worker.on("message", (msg) => {
        if (msg?.ok) {
          console.log(
            `fetchEcPayStoreListTask: Worker finished. Output: ${msg.outPath}`,
          );
        } else {
          console.error(
            "fetchEcPayStoreListTask: Worker reported error:",
            msg?.error,
          );
        }
      });
      worker.on("error", (err) => {
        console.error("fetchEcPayStoreListTask: Worker error:", err);
      });
      worker.on("exit", (code) => {
        if (code !== 0) {
          console.error(
            `fetchEcPayStoreListTask: Worker stopped with exit code ${code}`,
          );
        } else {
          console.log("fetchEcPayStoreListTask: Worker exited successfully.");
        }
      });
    } catch (error) {
      console.error("Error starting fetchEcPayStoreListTask worker:", error);
    }
  },
  { timezone: "Asia/Taipei" },
);

export const deleteIdempotencyKeysTask = cron.schedule(
  "0 */2 * * *", // every 2 hours
  async () => {
    if (process.env.NO_CRON === "true") return;
    console.log(
      `2 hour cron job for deleteIdempotencyKeysTask started. Time: ${new Date()}`,
    );

    try {
      await deleteIdempotencyKeys(3 * 24 * 60 * 60 * 1000); // 3 days ago
      console.log("Expired idempotency keys deleted.");
    } catch (error) {
      console.error(`Error during deleteIdempotencyKeysTask:`, error);
    }
  },
);
