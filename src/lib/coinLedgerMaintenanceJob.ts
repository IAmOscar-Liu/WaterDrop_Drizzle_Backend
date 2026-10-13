import { runCoinLedgerMaintenance } from "../repository/coinLedger";

export async function runCoinLedgerMaintenanceJob() {
  const result = await runCoinLedgerMaintenance();
  if (!result.skipped) {
    console.log("Coin ledger maintenance completed:", result);
    if (result.financialClose.failed > 0) {
      console.warn("Some archived advertisements could not be financially closed; retrying next maintenance run:",
        result.financialClose);
    }
  }
  return result;
}
