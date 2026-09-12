import { runCoinLedgerMaintenance } from "../repository/coinLedger";

export async function runCoinLedgerMaintenanceJob() {
  const result = await runCoinLedgerMaintenance();
  if (!result.skipped) {
    console.log("Coin ledger maintenance completed:", result);
  }
  return result;
}
