import { and, eq, isNull } from "drizzle-orm";
import db from "../lib/initDB";
import { accountTable } from "../db/schema";
import { missingProfileFields } from "../lib/accountProfile";

// Owner-run only, after schema migration; never invoked by API startup.
export async function backfillSellerProfiles(apply = false) {
  const accounts = await db.select().from(accountTable).where(and(eq(accountTable.role, "seller"), isNull(accountTable.profileCompletedAt)));
  const report: { accountId: string; missingProfileFields: string[]; action: string }[] = [];
  for (const candidate of accounts) {
    if (!apply) {
      const missing = missingProfileFields(candidate);
      report.push({ accountId: candidate.id, missingProfileFields: missing, action: missing.length ? "needs-remediation" : "eligible" });
      continue;
    }
    await db.transaction(async (tx) => {
      const [account] = await tx.select().from(accountTable).where(eq(accountTable.id, candidate.id)).for("update");
      if (!account || account.role !== "seller" || account.profileCompletedAt) return;
      const missing = missingProfileFields(account);
      if (!missing.length) await tx.update(accountTable).set({ profileCompletedAt: new Date() }).where(eq(accountTable.id, account.id));
      report.push({ accountId: account.id, missingProfileFields: missing, action: missing.length ? "needs-remediation" : "completed" });
    });
  }
  return report;
}
