// Environment variables must load before modules that read them at import time.
import "./lib/env";

import app from "./app";
import { ensureEcpayStoreListOnStartup } from "./lib/initEcpayStoreList";
import {
  coinLedgerMaintenanceTask,
  dailyNotificationTask,
  dailyResetTask,
  deleteIdempotencyKeysTask,
  deleteUnusedDeviceTokensTask,
  expireOrdersTask,
  fetchEcPayStoreListTask,
  monthlyCoinExpirationNotificationTask,
  monthlyCoinStatExpirationTask,
  pollLogisticsTradeInfoTask,
} from "./lib/scheduler";

const PORT = process.env.PORT ?? 4000;

dailyResetTask.start();
coinLedgerMaintenanceTask.start();
dailyNotificationTask.start();
monthlyCoinStatExpirationTask.start();
monthlyCoinExpirationNotificationTask.start();
deleteUnusedDeviceTokensTask.start();
expireOrdersTask.start();
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
