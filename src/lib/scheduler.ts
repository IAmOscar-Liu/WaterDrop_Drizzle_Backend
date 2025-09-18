import cron from "node-cron";
import { resetDailyStats } from "../repository/treasureBox";
import { getUserIdsInTimezones } from "../repository/user";
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

    let offset = 0;
    let usersProcessed = 0;

    try {
      while (true) {
        const userIds = await getUserIdsInTimezones({
          limit: BATCH_SIZE,
          offset,
          timezones: timezonesAtMidnight,
        });

        if (userIds.length === 0) {
          break;
        }

        console.log(
          `Processing batch of ${userIds.length} users in ${timezonesAtMidnight.length} timezones...`
        );

        await Promise.all(
          userIds.map((userId) =>
            resetDailyStats(userId).catch((err) => {
              if (err instanceof CustomError && err.statusCode === 404) return;
              console.error(`Error resetting stats for user ${userId}:`, err);
            })
          )
        );

        usersProcessed += userIds.length;
        offset += BATCH_SIZE;
      }

      console.log(
        `✅ Daily reset complete for current ${timezonesAtMidnight.length} timezones. Total users processed: ${usersProcessed}`
      );
    } catch (error) {
      console.error(
        `An error occurred during batch processing for current ${timezonesAtMidnight.length} timezones:`,
        error
      );
    }
  }
);

export default dailyTask;
