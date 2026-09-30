import "../lib/env";

import { parseArgs } from "node:util";
import { client } from "../lib/initDB";
import { creditManualUserCoins } from "../repository/coinLedger";

const ALLOWED_ENVIRONMENTS = new Set(["local", "development"]);

async function main() {
  const environment = process.env.NODE_ENV ?? "";
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      "Manual coin credits are only allowed in local and development environments.",
    );
  }

  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      amount: { type: "string" },
      reason: { type: "string" },
      "idempotency-key": { type: "string" },
      operator: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (
    !values["user-id"] ||
    !values.amount ||
    !values.reason ||
    !values["idempotency-key"]
  ) {
    throw new Error(
      "Required arguments: --user-id, --amount, --reason, --idempotency-key.",
    );
  }

  const result = await creditManualUserCoins({
    userId: values["user-id"],
    amount: values.amount,
    reason: values.reason,
    idempotencyKey: values["idempotency-key"],
    operator: values.operator ?? "cli",
  });
  console.log({
    status: result.alreadyApplied ? "already_applied" : "credited",
    userId: values["user-id"],
    creditedCoin: result.creditedCoin,
    balance: result.balance,
    expiresAt: result.lot.expiresAt,
    lotId: result.lot.id,
    transactionId: result.transaction.id,
  });
}

main()
  .catch((error) => {
    console.error("Manual coin credit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
