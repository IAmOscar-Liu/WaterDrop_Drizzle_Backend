import { reconcileBadge, badgeWorkUsers, captureBadgeWork, finishBadgeWork, retryBadgeWork } from "../repository/appBadge";
import { sendUserPush } from "./appBadgePush";
import { handleServiceError } from "../lib/error";
import { withPostgresAdvisoryLock } from "../lib/postgresAdvisoryLock";

export async function getAppBadge(userId: string) {
  try { return { success: true as const, data: await reconcileBadge(userId) }; }
  catch (error) { return handleServiceError(error); }
}
export async function runBadgeWorker() {
  // One worker across PM2 instances; no FCM calls inside a database transaction.
  return withPostgresAdvisoryLock("waterdrop:badge-worker", async () => {
    const started = Date.now();
    let processed = 0, failed = 0;
    for (const { id: userId } of await badgeWorkUsers(50)) {
      if (Date.now() - started >= 45000) break;
      try {
        const captured = await captureBadgeWork(userId);
        const badge = await reconcileBadge(userId);
        let deliveredVersion = badge.version;
        if (badge.version > captured.lastSentVersion || captured.work.some(w => w.forceDelivery)) {
          const sent = await sendUserPush(userId, { data: { command: "badge_sync" },
            apns: { headers: { "apns-collapse-id": "app-badge", "apns-expiration": String(Math.floor(Date.now() / 1000) + 300) } } });
          if (sent.retry) throw new Error("Retryable device delivery failure");
          deliveredVersion = sent.badge.version;
        }
        await finishBadgeWork(userId, captured.work.map(w => w.id), deliveredVersion);
        processed++;
      } catch {
        failed++;
        await retryBadgeWork(userId);
      }
    }
    return { processed, failed };
  });
}
