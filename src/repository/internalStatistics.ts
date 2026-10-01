import { eq, sql, SQL } from "drizzle-orm";
import * as s from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";

export type InternalStatisticsInput = { requesterId: string; startDate: string; endDate: string; dataset?: "users" | "coin-flows" | "ad-finance" };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Coverage = "complete" | "partial" | "unavailable";
function metric(value: string | null, unit: string, basis: string, status: Coverage = "complete", reason: string | null = null) {
  return { value, unit, basis, coverage: { status, reason } };
}
const missing = (unit: string, reason: string) => metric(null, unit, "unavailable", "unavailable", reason);
const ledgerReason = "Recorded ledger entries only; historical completeness has not been audited. Opening balances are excluded from new issuance.";

export function internalDateRange(startDate: string, endDate: string) {
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(startDate) || !valid(endDate)) throw new CustomError("Use valid YYYY-MM-DD dates.", 400);
  const startAt = new Date(`${startDate}T00:00:00+08:00`);
  const endExclusive = new Date(new Date(`${endDate}T00:00:00+08:00`).getTime() + 86400000);
  const days = (endExclusive.getTime() - startAt.getTime()) / 86400000;
  if (days < 1 || days > 366) throw new CustomError("Date range must contain 1 to 366 Taipei days.", 400);
  return { startAt: startAt.toISOString(), endExclusive: endExclusive.toISOString(), days };
}

async function authorize(tx: Tx, requesterId: string) {
  const [actor] = await tx.select().from(s.accountTable).where(eq(s.accountTable.id, requesterId));
  if (!actor || actor.role !== "admin" || actor.status !== "active" || actor.deletedAt) {
    throw new CustomError("Internal statistics require an active platform administrator.", 403);
  }
}

// Each financial source is aggregated separately: joins must never multiply ledger entries.
const adFields: Record<string, SQL> = {
  fundingInflows: sql`case when type = 'wallet_funding' then amount::numeric else 0 end`,
  legacyDeposits: sql`case when type = 'deposit' then amount::numeric else 0 end`,
  budgetWithdrawals: sql`case when type = 'budget_withdrawal' then -amount::numeric else 0 end`,
  viewSpend: sql`case when type = 'view_debit' then -amount::numeric else 0 end`,
  settlementReturns: sql`case when type = 'seller_return_credit' then amount::numeric else 0 end`,
  transfersIn: sql`case when type = 'balance_transfer_in' then amount::numeric else 0 end`,
  transfersOut: sql`case when type = 'balance_transfer_out' then -amount::numeric else 0 end`,
};
const notOpening = sql`idempotency_key not like 'legacy_unattributed_user_balances_v1:%' and coalesce(metadata->>'source', '') <> 'legacy_balance_backfill'`;
const coinFields: Record<string, SQL> = {
  acquiredCoins: sql`case when type = 'acquire' and direction = 'credit' and ${notOpening} then amount else 0 end`,
  cashRefundConvertedCoins: sql`case when type = 'cash_refund_conversion' and direction = 'credit' then amount else 0 end`,
  refundedCoins: sql`case when type = 'refund' and direction = 'credit' and coalesce(metadata->>'creditedToUser', 'true') <> 'false' then amount else 0 end`,
  expiredRefundCoins: sql`case when type = 'refund' and direction = 'credit' and metadata->>'creditedToUser' = 'false' then amount else 0 end`,
  expiredCoins: sql`case when type = 'expiry' and direction = 'debit' then amount else 0 end`,
  manualNetCoins: sql`case when type = 'manual' and ${notOpening} then case when direction = 'credit' then amount else -amount end else 0 end`,
};
const advanceFields: Record<string, SQL> = {
  advanceCreatedCoins: sql`case when type = 'platform_advance_created' then coin_amount else 0 end`,
  advanceRepaidCoins: sql`case when type = 'platform_advance_repaid' then coin_amount else 0 end`,
  advanceCancelledCoins: sql`case when type = 'platform_advance_cancelled_expiry' then coin_amount else 0 end`,
  advanceWrittenOffCoins: sql`case when type = 'platform_advance_written_off_archive' then coin_amount else 0 end`,
};
async function flows(tx: Tx, table: SQL, fields: Record<string, SQL>, range: ReturnType<typeof internalDateRange>, daily: boolean) {
  const columns = sql.join(Object.entries(fields).map(([name, expr]) => sql`coalesce(sum(${expr}), 0)::numeric(30,2)::text as ${sql.identifier(name)}`), sql`, `);
  return await tx.execute(sql`select ${daily ? sql`(created_at at time zone 'Asia/Taipei')::date::text as date,` : sql``} ${columns}, min(created_at)::text as "firstRecordedAt"
    from ${table} where created_at >= ${range.startAt}::timestamptz and created_at < ${range.endExclusive}::timestamptz
    ${daily ? sql`group by (created_at at time zone 'Asia/Taipei')::date order by (created_at at time zone 'Asia/Taipei')::date` : sql``}`);
}
function flowMetrics(row: Record<string, unknown> | undefined, fields: Record<string, SQL>, unit: string) {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, metric(row ? String(row[key]) : null, unit, "recorded_flow", row ? "partial" : "unavailable", row ? ledgerReason : "NO_RECORDED_DATA; coverage for this date has not been verified.")]));
}

export async function getInternalStatistics(input: InternalStatisticsInput, daily = false) {
  const range = internalDateRange(input.startDate, input.endDate);
  return db.transaction(async (tx) => {
    await authorize(tx, input.requesterId);
    const [clock] = await tx.execute(sql`select current_timestamp::text as "asOf"`);
    const metadata = {
      asOf: String(clock.asOf), timezone: "Asia/Taipei", startDate: input.startDate, endDate: input.endDate,
      startAt: range.startAt, endExclusive: range.endExclusive,
      userPolicy: "All retained app-user rows, including test accounts; no supported disabled/test flag. Deleted rows are absent; accounts are not deduplicated into people.",
      coinPoolDefinition: "Claimable unopened boxes + effective unexpired available lots + reserved lots. Consumed, expired, seller funding and platform advances are separate and not added again.",
      adFundingDefinition: "wallet_funding only. Legacy deposits shown separately without asserting verified investment. Transfers and settlement returns are not new funding; withdrawals are not view spend.",
      coverage: { historicalLedger: "partial", coverageStart: null, reason: ledgerReason },
      historicalStocks: missing("snapshot", "NO_HISTORICAL_SNAPSHOTS"),
    };
    if (daily) {
      let rows: Record<string, unknown>[];
      let advances: Record<string, unknown>[] = [];
      if (input.dataset === "users") {
        rows = await tx.execute(sql`select (created_at at time zone 'Asia/Taipei')::date::text as date, count(*)::text as registrations from users
          where created_at >= ${range.startAt}::timestamptz and created_at < ${range.endExclusive}::timestamptz
          group by (created_at at time zone 'Asia/Taipei')::date`);
      } else if (input.dataset === "coin-flows") {
        rows = await flows(tx, sql`user_coin_transactions`, coinFields, range, true);
        advances = await flows(tx, sql`advertisement_coin_funding_transactions`, advanceFields, range, true);
      } else rows = await flows(tx, sql`advertisement_transactions`, adFields, range, true);
      const byDate = new Map(rows.map((row) => [String(row.date), row]));
      const advanceByDate = new Map(advances.map((row) => [String(row.date), row]));
      const points = Array.from({ length: range.days }, (_, i) => {
        const date = new Date(Date.parse(input.startDate) + i * 86400000).toISOString().slice(0, 10);
        const row = byDate.get(date);
        return { date, metrics: input.dataset === "users"
          ? { registrations: metric(String(row?.registrations ?? "0"), "accounts", "registrations_among_retained_users") }
          : input.dataset === "coin-flows"
            ? { ...flowMetrics(row, coinFields, "coins"), ...flowMetrics(advanceByDate.get(date), advanceFields, "coins"), spentCoins: missing("coins", "NO_COMPLETE_GROSS_SPEND_EVENT_HISTORY") }
            : flowMetrics(row, adFields, "TWD") };
      });
      return { ...metadata, dataset: input.dataset, points };
    }
    const [users] = await tx.execute(sql`select count(*)::text as total, count(*) filter (where created_at >= ${range.startAt}::timestamptz and created_at < ${range.endExclusive}::timestamptz)::text as registrations from users`);
    const [stocks] = await tx.execute(sql`
      with lots as (select
        coalesce(sum(available_amount),0) as recorded_available,
        coalesce(sum(available_amount) filter (where expires_at > current_timestamp and status = 'active'),0) as available,
        coalesce(sum(available_amount) filter (where expires_at <= current_timestamp),0) as pending_expiry,
        coalesce(sum(reserved_amount),0) as reserved, coalesce(sum(consumed_amount),0) as consumed,
        coalesce(sum(expired_amount),0) as expired from user_coin_lots),
      boxes as (select coalesce(sum(coins_awarded::numeric) filter (where accounting_status = 'claimable' and claim_deadline_at > current_timestamp and is_active is distinct from false and is_opened = false),0) as unclaimed,
        count(*) filter (where (accounting_status is null or (accounting_status = 'claimable' and claim_deadline_at is null)) and is_active is distinct from false and is_opened = false) as unknown_boxes from treasure_boxes),
      ads as (select coalesce(sum(balance::numeric),0) as balance, coalesce(sum(total_spent::numeric),0) as spent,
        coalesce(sum(seller_returned_currency_amount),0) as returned from advertisement_stats),
      funding as (select coalesce(sum(platform_advance_outstanding_amount),0) as advances,
        coalesce(sum(platform_promotional_expense_amount),0) as promotional,
        coalesce(sum(seller_funding_available_amount),0) as funding_available,
        coalesce(sum(platform_advance_outstanding_amount / coin_to_currency_rate),0) as advances_twd from advertisement_coin_funding_accounts),
      reconciliation as (select count(*) as mismatches from users u left join
        (select user_id, sum(available_amount) as amount from user_coin_lots group by user_id) l on l.user_id=u.id
        where abs(u.coins::numeric-coalesce(l.amount,0)) > 0.005)
      select recorded_available::numeric(30,2)::text, available::numeric(30,2)::text, pending_expiry::numeric(30,2)::text,
        reserved::numeric(30,2)::text, consumed::numeric(30,2)::text, expired::numeric(30,2)::text,
        unclaimed::numeric(30,2)::text, unknown_boxes::text, balance::numeric(30,2)::text, spent::numeric(30,2)::text,
        returned::numeric(30,2)::text, advances::numeric(30,2)::text, promotional::numeric(30,2)::text,
        funding_available::numeric(30,2)::text, advances_twd::numeric(30,2)::text, mismatches::text,
        ((unclaimed+available+reserved)/10)::numeric(30,2)::text as pool_twd,
        (unclaimed+available+reserved)::numeric(30,2)::text as pool,
        case when balance > 0 then ((unclaimed+available+reserved)/10/balance)::numeric(30,8)::text else null end as ratio
      from lots cross join boxes cross join ads cross join funding cross join reconciliation`);
    const completePool = stocks.mismatches === "0" && stocks.unknown_boxes === "0";
    const poolReason = completePool ? null : "INCOMPLETE_COVERAGE: legacy unclassified boxes or user balances not reconciled to lots.";
    const stock = (field: string, unit = "coins", basis = "current_recorded_stock") => metric(String(stocks[field]), unit, basis);
    const [adPeriod] = await flows(tx, sql`advertisement_transactions`, adFields, range, false);
    const [coinPeriod] = await flows(tx, sql`user_coin_transactions`, coinFields, range, false);
    const [advancePeriod] = await flows(tx, sql`advertisement_coin_funding_transactions`, advanceFields, range, false);
    const [adLifetime] = await flows(tx, sql`advertisement_transactions`, adFields, { ...range, startAt: "0001-01-01T00:00:00Z", endExclusive: new Date(String(clock.asOf)).toISOString() }, false);
    const coinToCurrencyRate = "10.000000";
    return {
      ...metadata,
      users: { total: metric(String(users.total), "accounts", "current_retained_users"), periodRegistrations: metric(String(users.registrations), "accounts", "registrations_among_retained_users") },
      coins: {
        unclaimed: metric(String(stocks.unclaimed), "coins", "claimable_boxes_with_known_deadlines", stocks.unknown_boxes === "0" ? "complete" : "partial", stocks.unknown_boxes === "0" ? null : "Unclassified boxes or missing claim deadlines are excluded."), available: stock("available"), reserved: stock("reserved"),
        recordedAvailable: stock("recorded_available"), pendingExpiry: stock("pending_expiry"),
        recordedNetConsumed: metric(String(stocks.consumed), "coins", "mutable_lot_consumption", "partial", "Not lifetime gross consumption; historical consumption before opening lots is unavailable."),
        recordedExpired: metric(String(stocks.expired), "coins", "mutable_lot_expiry", "partial", "Recorded lots only; pre-ledger expiry unavailable."),
        platformAdvanceOutstanding: stock("advances"), platformAdvanceTwd: stock("advances_twd", "TWD", "sum_each_funding_account_at_its_recorded_rate"),
        platformPromotionalExpense: stock("promotional"), sellerFundingAvailable: stock("funding_available"),
        outstandingPool: metric(completePool ? String(stocks.pool) : null, "coins", metadata.coinPoolDefinition, completePool ? "complete" : "unavailable", poolReason),
        poolTwd: metric(completePool ? String(stocks.pool_twd) : null, "TWD", "outstandingPool / 10", completePool ? "complete" : "unavailable", poolReason),
        reconciliation: { mismatchedUsers: String(stocks.mismatches), unclassifiedClaimableBoxes: String(stocks.unknown_boxes) },
        period: { ...flowMetrics(coinPeriod.firstRecordedAt ? coinPeriod : undefined, coinFields, "coins"), ...flowMetrics(advancePeriod.firstRecordedAt ? advancePeriod : undefined, advanceFields, "coins"), spentCoins: missing("coins", "NO_COMPLETE_GROSS_SPEND_EVENT_HISTORY") },
      },
      advertisements: {
        remainingBalance: stock("balance", "TWD"), recordedGrossViewSpend: stock("spent", "TWD"), settlementReturns: stock("returned", "TWD"),
        lifetimeRecorded: flowMetrics(adLifetime.firstRecordedAt ? adLifetime : undefined, adFields, "TWD"),
        period: flowMetrics(adPeriod.firstRecordedAt ? adPeriod : undefined, adFields, "TWD"),
      },
      ratio: { ...metric(completePool && stocks.ratio !== null ? String(stocks.ratio) : null, "ratio", "current outstanding coin pool in TWD / current remaining ad balance", completePool && stocks.ratio !== null ? "complete" : "unavailable", !completePool ? "INCOMPLETE_COVERAGE" : stocks.ratio === null ? "NON_POSITIVE_DENOMINATOR" : null), coinToCurrencyRate, rateBasis: "Current product valuation convention of 10 coins per TWD; not a historical exchange-rate reconstruction." },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
