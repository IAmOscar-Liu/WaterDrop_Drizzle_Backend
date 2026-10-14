import "../lib/env";
import { client } from "../lib/initDB";
import { backfillSellerProfiles } from "../repository/accountProfileBackfill";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Usage: backfillSellerProfiles.ts [--apply]");
  const apply = args.includes("--apply");
  console.log(`Seller profile ${apply ? "backfill" : "audit (read only)"}; environment: ${process.env.NODE_ENV ?? "local"}`);
  const report = await backfillSellerProfiles(apply);
  console.table(report);
  console.log(`${report.length} incomplete seller rows checked. No role, status, or credential changes.`);
  if (report.some((row) => row.missingProfileFields.length)) {
    console.error("Some sellers need remediation or must finish onboarding. Review before deployment.");
    process.exitCode = 2;
  }
}
main().catch(() => { console.error("Seller profile audit/backfill failed; check migration and database access."); process.exitCode = 1; })
  .finally(() => client.end());
