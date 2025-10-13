import cron from "node-cron";
import { resetDailyStats } from "../repository/treasureBox";
import {
  getUserIdsInTimezones,
  updateGroupAdViewsCountYesterday,
} from "../repository/user";
import { CustomError } from "./error";

const BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.

// Schedule a task to run every hour to check for users in timezones at midnight.
const dailyTask = cron.schedule(
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

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + BATCH_SIZE);

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

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batchUserIds = userIds.slice(i, i + BATCH_SIZE);

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

export default dailyTask;
