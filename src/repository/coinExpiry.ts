import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  effectiveTimezone,
  getEndOfNextLocalMonth,
  isCoinExpirySoon,
  isCoinLedgerEnabled,
  toCoinUnits,
} from "../lib/coinAccounting";
import db from "../lib/initDB";

export type CoinExpirySummary = {
  userId: string;
  userTimezone: string;
  amount: number;
  deadlines: { expiresAt: Date; timezone: string; amount: number }[];
};

// Shared source of truth for app login/profile and the expiry notification job.
export async function getCoinExpirySummaries(
  now = new Date(),
  userIds?: string[],
): Promise<CoinExpirySummary[]> {
  if (userIds?.length === 0) return [];
  const summaries = new Map<string, CoinExpirySummary>();
  function add(userId: string, userTimezone: string | null, expiresAt: Date,
    timezone: string, amount: number | string) {
    const units = toCoinUnits(amount);
    if (units <= 0 || !isCoinExpirySoon(now, expiresAt, timezone)) return;
    const summary = summaries.get(userId) ?? {
      userId, userTimezone: effectiveTimezone(userTimezone), amount: 0, deadlines: [],
    };
    summary.amount = (toCoinUnits(summary.amount) + units) / 100;
    const deadline = summary.deadlines.find(
      (entry) => entry.expiresAt.getTime() === expiresAt.getTime() && entry.timezone === timezone,
    );
    if (deadline) deadline.amount = (toCoinUnits(deadline.amount) + units) / 100;
    else summary.deadlines.push({ expiresAt, timezone, amount: units / 100 });
    summaries.set(userId, summary);
  }

  if (isCoinLedgerEnabled()) {
    const lots = await db.select({
      userId: schema.userCoinLotTable.userId,
      userTimezone: schema.userTable.timezone,
      expiresAt: schema.userCoinLotTable.expiresAt,
      timezone: schema.userCoinLotTable.timezoneSnapshot,
      amount: schema.userCoinLotTable.availableAmount,
    }).from(schema.userCoinLotTable)
      .innerJoin(schema.userTable, eq(schema.userTable.id, schema.userCoinLotTable.userId))
      .where(and(
        userIds ? inArray(schema.userCoinLotTable.userId, userIds) : undefined,
        eq(schema.userCoinLotTable.status, "active"),
        gt(schema.userCoinLotTable.availableAmount, "0"),
        gt(schema.userCoinLotTable.expiresAt, now),
        // Broad SQL bound; the exact local-calendar window is checked below.
        lte(schema.userCoinLotTable.expiresAt, new Date(now.getTime() + 8 * 86400000)),
      ));
    for (const lot of lots) {
      add(lot.userId, lot.userTimezone, lot.expiresAt, effectiveTimezone(lot.timezone), lot.amount);
    }
  } else {
    const stats = await db.select({
      userId: schema.userMonthlyCoinStatTable.userId,
      timezone: schema.userTable.timezone,
      month: schema.userMonthlyCoinStatTable.month,
      coinsEarned: schema.userMonthlyCoinStatTable.coinsEarned,
      coinsSpent: schema.userMonthlyCoinStatTable.coinsSpent,
    }).from(schema.userMonthlyCoinStatTable)
      .innerJoin(schema.userTable, eq(schema.userTable.id, schema.userMonthlyCoinStatTable.userId))
      .where(and(
        userIds ? inArray(schema.userMonthlyCoinStatTable.userId, userIds) : undefined,
        eq(schema.userMonthlyCoinStatTable.expired, false),
        sql`${schema.userMonthlyCoinStatTable.coinsEarned} > ${schema.userMonthlyCoinStatTable.coinsSpent}`,
      ));
    for (const stat of stats) {
      const [year, month] = stat.month.split("-").map(Number);
      const timezone = effectiveTimezone(stat.timezone);
      const expiry = getEndOfNextLocalMonth(new Date(Date.UTC(year, month - 1, 15, 12)), timezone);
      add(stat.userId, stat.timezone, expiry, timezone,
        (toCoinUnits(stat.coinsEarned) - toCoinUnits(stat.coinsSpent)) / 100);
    }
  }
  return [...summaries.values()].map((summary) => ({
    ...summary,
    deadlines: summary.deadlines.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()),
  }));
}

export async function getCoinsExpireSoon(userId: string, now = new Date()) {
  const [summary] = await getCoinExpirySummaries(now, [userId]);
  return summary?.amount ?? null;
}
