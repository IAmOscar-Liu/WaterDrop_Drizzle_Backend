import { earningsLaunchAt } from "./lib/earningsMoney";
import { recoverAutoRefillEvents } from "./repository/adAutomation";
import { sellerEarningsReleaseTask } from "./lib/scheduler";
import { releaseSellerEarnings } from "./repository/sellerEarnings";
// Environment variables must load before modules that read them at import time.
import "./lib/env";

import app from "./app";
import { ensureEcpayStoreListOnStartup } from "./lib/initEcpayStoreList";
import {
  appBadgeTask,
  paymentReconciliationTask,
  accountRecoveryCleanupTask,
  coinLedgerMaintenanceTask,
  chatSyncCleanupTask,
  notificationSyncCleanupTask,
  dailyNotificationTask,
  dailyResetTask,
  deleteCoinLedgerJobRunsTask,
  deleteIdempotencyKeysTask,
  deleteUnusedDeviceTokensTask,
  expireOrdersTask,
  expirePaymentProcessingOrdersTask,
  fetchEcPayStoreListTask,
  monthlyCoinExpirationNotificationTask,
  monthlyCoinStatExpirationTask,
  pollLogisticsTradeInfoTask,
} from "./lib/scheduler";

const PORT = process.env.PORT ?? 4000;

earningsLaunchAt(); // Validate an explicitly configured launch timestamp before serving requests.
sellerEarningsReleaseTask.start();
if (process.env.NO_CRON !== "true") recoverAutoRefillEvents().catch(error => console.error("Auto-refill startup recovery failed", error));
if (process.env.NO_CRON !== "true") releaseSellerEarnings().catch(error => console.error("Earnings release catch-up failed", error));
paymentReconciliationTask.start();
appBadgeTask.start();
accountRecoveryCleanupTask.start();
chatSyncCleanupTask.start();
notificationSyncCleanupTask.start();
dailyResetTask.start();
coinLedgerMaintenanceTask.start();
deleteCoinLedgerJobRunsTask.start();
dailyNotificationTask.start();
monthlyCoinStatExpirationTask.start();
monthlyCoinExpirationNotificationTask.start();
deleteUnusedDeviceTokensTask.start();
expireOrdersTask.start();
expirePaymentProcessingOrdersTask.start();
pollLogisticsTradeInfoTask.start();
fetchEcPayStoreListTask.start();
deleteIdempotencyKeysTask.start();

console.log("Cron jobs have been started.");

if (process.env.NODE_ENV !== "test") {
  ensureEcpayStoreListOnStartup();
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
