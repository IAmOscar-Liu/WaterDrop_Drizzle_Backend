import { getCoinExpirySummaries } from "../repository/coinExpiry";
import { createNotification } from "../repository/notification";
import { getFcmTokensInUserIds } from "../repository/user";
import { getLocalDate, getZonedParts } from "./coinAccounting";
import { sendMulticastPushNotification } from "./sendNotification";

const defaultDependencies = { createNotification, getFcmTokensInUserIds, sendMulticastPushNotification };

export async function runCoinExpiryNotificationJob(
  now = new Date(),
  dependencies = defaultDependencies,
) {
  const recipients = (await getCoinExpirySummaries(now)).filter((summary) => {
    const { hour, minute } = getZonedParts(now, summary.userTimezone);
    return hour === 6 && minute < 30;
  });
  let notified = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const results = await Promise.allSettled(recipients.slice(i, i + 100).map(async (summary) => {
      const title = "金幣即將過期通知";
      const body = summary.deadlines.map((deadline) => {
        const date = getLocalDate(deadline.expiresAt, deadline.timezone).replace(/-/g, "/");
        const { hour, minute } = getZonedParts(deadline.expiresAt, deadline.timezone);
        const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        return `您尚有${deadline.amount}金幣未使用，將於 ${date} ${time} (${deadline.timezone}) 過期。`;
      }).join("\n") + "快把握時間使用您的金幣吧!";
      await dependencies.createNotification({
        userId: summary.userId, type: "system_alert", title, body,
      });
      const tokens = await dependencies.getFcmTokensInUserIds([summary.userId]);
      for (let offset = 0; offset < tokens.length; offset += 100) {
        await dependencies.sendMulticastPushNotification({
          tokens: tokens.slice(offset, offset + 100),
          notification: { title, body },
          data: { command: "message" },
        });
      }
    }));
    for (const result of results) {
      if (result.status === "fulfilled") notified++;
      else {
        failed++;
        console.error("Coin expiry notification failed:", result.reason);
      }
    }
  }
  return { notified, failed };
}
