import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { notificationTypeEnum, userTable } from "../db/schema";

async function main() {
  const { values } = parseArgs({ options: {
    "user-id": { type: "string" }, type: { type: "string" },
    push: { type: "boolean", default: false }, help: { type: "boolean", short: "h" },
  }, allowPositionals: false });
  if (values.help) {
    console.log("Usage: npm run notification:auto-send:local -- --user-id <UUID> [--type system_alert] [--push]");
    console.log("Creates a Message Center notification every 10 seconds. --push also attempts FCM. Ctrl+C stops.");
    return;
  }
  if (process.env.NODE_ENV !== "local") throw new Error("This helper is local-only.");
  const userId = z.uuid().parse(values["user-id"]);
  const type = z.enum(notificationTypeEnum.enumValues).parse(values.type ?? "system_alert");
  await import("../lib/env");
  const { default: db, client } = await import("../lib/initDB");
  const { createNotification } = await import("../repository/notification");
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const user = await db.query.userTable.findFirst({ columns: { id: true }, where: eq(userTable.id, userId) });
    if (!user) throw new Error("App user not found.");
    console.log(`[notification-test] Watching user ${userId}; creates ${type} every 10 seconds. Push ${values.push ? "enabled" : "disabled"}. Ctrl+C stops.`);
    let nextAt = Date.now() + 10_000;
    while (!stopped) {
      if (Date.now() >= nextAt) {
        const title = "訊息中心測試";
        const body = `${new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "medium" }).format(new Date())} (UTC+08:00)`;
        const notification = await createNotification({ userId, type, title, body });
        console.log(`[notification-test] Saved ${notification.id}; notification.created and stats published.`);
        if (values.push && !stopped) {
          try {
            const { getFcmTokensInUserIds } = await import("../repository/user");
            const { sendMulticastPushNotification } = await import("../lib/sendNotification");
            const tokens = [...new Set(await getFcmTokensInUserIds([userId]))];
            if (!tokens.length) console.log("[notification-test] Push skipped: no registered device tokens.");
            for (let i = 0; i < tokens.length && !stopped; i += 500) {
              await sendMulticastPushNotification({
                tokens: tokens.slice(i, i + 500), notification: { title, body },
                data: { command: "message", notificationId: notification.id },
              });
            }
          } catch { console.error("[notification-test] Push unavailable; saved notification and SSE are unaffected."); }
        }
        nextAt = Date.now() + 10_000;
      }
      await sleep(250);
    }
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await client.end({ timeout: 5 });
  }
}
main().catch((error) => {
  console.error("[notification-test] Failed:", error instanceof Error ? error.message.split("\n")[0] : "Unknown error");
  process.exitCode = 1;
});
