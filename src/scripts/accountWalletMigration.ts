import "../lib/env";

import { sql } from "drizzle-orm";

import * as schema from "../db/schema";
import db, { client } from "../lib/initDB";
import { withPostgresAdvisoryLock } from "../lib/postgresAdvisoryLock";

const MIGRATION_LOCK = "waterdrop:account-wallet-migration:v1";
type Command = "audit" | "backfill" | "reconcile";

function parseCommand(): { command: Command; apply: boolean } {
  const command = (process.argv[2] ?? "audit") as Command;
  if (!["audit", "backfill", "reconcile"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return { command, apply: process.argv.includes("--apply") };
}

async function hasTransactionTable() {
  const [row] = await db.execute<{ exists: boolean }>(sql`
    select to_regclass('public.account_wallet_transactions') is not null as exists
  `);
  return row.exists;
}

export async function getAccountWalletAuditSummary() {
  const transactionsExist = await hasTransactionTable();
  const [base] = await db.execute<{
    account_count: number;
    wallet_count: number;
    missing_wallet_count: number;
    orphan_wallet_count: number;
    negative_wallet_count: number;
    locked_above_balance_count: number;
    over_precision_wallet_count: number;
    nonzero_wallet_count: number;
    wallet_balance_total: string;
    advertisement_balance_total: string;
    legacy_deposit_count: number;
  }>(sql`
    select
      (select count(*)::int from accounts) as account_count,
      (select count(*)::int from account_wallets) as wallet_count,
      (select count(*)::int from accounts a where not exists (
        select 1 from account_wallets w where w.account_id = a.id
      )) as missing_wallet_count,
      (select count(*)::int from account_wallets w where not exists (
        select 1 from accounts a where a.id = w.account_id
      )) as orphan_wallet_count,
      (select count(*)::int from account_wallets
        where wallet_balance < 0 or locked_balance < 0
          or total_revenue_cash < 0 or total_revenue_coin < 0
      ) as negative_wallet_count,
      (select count(*)::int from account_wallets
        where locked_balance > wallet_balance
      ) as locked_above_balance_count,
      (select count(*)::int from account_wallets
        where wallet_balance <> round(wallet_balance::numeric, 2)
          or locked_balance <> round(locked_balance::numeric, 2)
          or total_revenue_cash <> round(total_revenue_cash::numeric, 2)
          or total_revenue_coin <> round(total_revenue_coin::numeric, 2)
      ) as over_precision_wallet_count,
      (select count(*)::int from account_wallets where wallet_balance <> 0)
        as nonzero_wallet_count,
      (select coalesce(sum(wallet_balance), 0)::text from account_wallets)
        as wallet_balance_total,
      (select coalesce(sum(balance), 0)::text from advertisement_stats)
        as advertisement_balance_total,
      (select count(*)::int from advertisement_transactions where type = 'deposit')
        as legacy_deposit_count
  `);

  let nonzeroWithoutHistory: number | null = null;
  if (transactionsExist) {
    const [row] = await db.execute<{ value: number }>(sql`
      select count(*)::int as value
      from account_wallets w
      where w.wallet_balance <> 0
        and not exists (
          select 1 from account_wallet_transactions t where t.wallet_id = w.id
        )
    `);
    nonzeroWithoutHistory = row.value;
  }

  return {
    ...base,
    transaction_table_exists: transactionsExist,
    nonzero_wallets_without_history: nonzeroWithoutHistory,
  };
}

export async function backfillAccountWallets(apply: boolean) {
  if (!apply) {
    console.log("Dry run only. Pass --apply to create missing wallets and opening transactions.");
    console.log(await getAccountWalletAuditSummary());
    return;
  }
  if (process.env.ACCOUNT_WALLET_AD_FUNDING_ENABLED === "true") {
    throw new Error(
      "Disable ACCOUNT_WALLET_AD_FUNDING_ENABLED while running the wallet backfill.",
    );
  }
  if (!(await hasTransactionTable())) {
    throw new Error("Run the account-wallet database migration before backfill.");
  }

  const lock = await withPostgresAdvisoryLock(MIGRATION_LOCK, async () =>
    db.transaction(async (tx) => {
      const createdWallets = await tx.execute(sql`
        insert into ${schema.accountWalletTable} (account_id)
        select a.id
        from ${schema.accountTable} a
        where not exists (
          select 1 from ${schema.accountWalletTable} w where w.account_id = a.id
        )
        on conflict (account_id) do nothing
        returning id
      `);

      const openingTransactions = await tx.execute(sql`
        insert into ${schema.accountWalletTransactionTable} (
          wallet_id,
          account_id,
          actor_account_id,
          advertisement_id,
          type,
          amount,
          balance_before,
          balance_after,
          idempotency_key,
          reason
        )
        select
          w.id,
          w.account_id,
          null,
          null,
          'legacy_opening_balance',
          w.wallet_balance,
          0,
          w.wallet_balance,
          'wallet-backfill:' || w.id::text,
          'Opening balance preserved during account-wallet migration'
        from ${schema.accountWalletTable} w
        where w.wallet_balance > 0
          and not exists (
            select 1
            from ${schema.accountWalletTransactionTable} t
            where t.wallet_id = w.id
          )
        on conflict (idempotency_key) do nothing
        returning id
      `);

      return {
        createdWallets: createdWallets.length,
        openingTransactions: openingTransactions.length,
      };
    }),
  );
  if (!lock.acquired) {
    throw new Error("Another account-wallet migration is already running.");
  }

  console.log(lock.value);
  console.log(await getAccountWalletAuditSummary());
}

export async function reconcileAccountWallets() {
  if (!(await hasTransactionTable())) {
    throw new Error("Account wallet transaction table does not exist.");
  }

  const [result] = await db.execute<{
    missing_wallet_count: number;
    orphan_wallet_count: number;
    negative_wallet_count: number;
    broken_chain_count: number;
    aggregate_mismatch_count: number;
    unpaired_funding_count: number;
  }>(sql`
    with ordered as (
      select
        t.*,
        lag(t.balance_after) over (
          partition by t.wallet_id order by t.sequence
        ) as previous_balance_after
      from ${schema.accountWalletTransactionTable} t
    ), wallet_sums as (
      select wallet_id, coalesce(sum(amount), 0) as ledger_balance
      from ${schema.accountWalletTransactionTable}
      group by wallet_id
    )
    select
      (select count(*)::int from ${schema.accountTable} a where not exists (
        select 1 from ${schema.accountWalletTable} w where w.account_id = a.id
      )) as missing_wallet_count,
      (select count(*)::int from ${schema.accountWalletTable} w where not exists (
        select 1 from ${schema.accountTable} a where a.id = w.account_id
      )) as orphan_wallet_count,
      (select count(*)::int from ${schema.accountWalletTable}
        where wallet_balance < 0 or locked_balance < 0
      ) as negative_wallet_count,
      (select count(*)::int from ordered
        where (previous_balance_after is null and balance_before <> 0)
           or (previous_balance_after is not null and balance_before <> previous_balance_after)
           or balance_after <> balance_before + amount
      ) as broken_chain_count,
      (select count(*)::int
        from ${schema.accountWalletTable} w
        left join wallet_sums s on s.wallet_id = w.id
        where w.wallet_balance <> coalesce(s.ledger_balance, 0)
      ) as aggregate_mismatch_count,
      (select count(*)::int
        from ${schema.accountWalletTransactionTable} wt
        left join ${schema.advertisementTransactionTable} at
          on at.account_wallet_transaction_id = wt.id
        where wt.type = 'advertisement_funding_debit'
          and (
            at.id is null
            or at.type <> 'wallet_funding'
            or at.advertisement_id <> wt.advertisement_id
            or at.amount::numeric <> -wt.amount
          )
      ) as unpaired_funding_count
  `);

  console.log(result);
  if (Object.values(result).some((value) => Number(value) !== 0)) {
    throw new Error("Account-wallet reconciliation failed.");
  }
  console.log("Account-wallet reconciliation passed.");
}

async function main() {
  const { command, apply } = parseCommand();
  if (command === "audit") console.log(await getAccountWalletAuditSummary());
  if (command === "backfill") await backfillAccountWallets(apply);
  if (command === "reconcile") await reconcileAccountWallets();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.end();
    });
}
