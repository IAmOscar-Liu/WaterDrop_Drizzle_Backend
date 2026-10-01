import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { minorUnitsToMoney, moneyToMinorUnits, normalizeMoney } from "../lib/money";
import { lockWalletIdempotencyKeyWithTx } from "./accountWallet";
import { recordAdminActivityWithTx } from "./adminActivity";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WithdrawalInput = {
  advertisementId: string;
  requesterId: string;
  mode: "all" | "amount";
  amount?: string;
  expectedBalance: string;
  confirmationToken: string;
  idempotencyKey: string;
};
const fail = (code: string, message: string, status = 409): never => {
  throw new CustomError(message, status, code);
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function adMoney(value: number) {
  try { return normalizeMoney(value); }
  catch { return fail("WITHDRAWAL_BLOCKED", "Advertisement balance requires accounting reconciliation."); }
}

async function authorize(tx: Tx, advertisementId: string, requesterId: string) {
  const [actor] = await tx.select().from(s.accountTable).where(eq(s.accountTable.id, requesterId));
  if (!actor || actor.status !== "active" || actor.deletedAt || !["admin", "seller"].includes(actor.role)) {
    return fail("WITHDRAWAL_FORBIDDEN", "An active administrator or owning seller is required.", 403);
  }
  const [row] = await tx.select({ ad: s.advertisementTable, sellerId: s.productTable.sellerId })
    .from(s.advertisementTable).innerJoin(s.productTable, eq(s.productTable.id, s.advertisementTable.productId))
    .where(eq(s.advertisementTable.id, advertisementId));
  if (!row) return fail("ADVERTISEMENT_NOT_FOUND", "Advertisement not found.", 404);
  if (actor.role !== "admin" && row.sellerId !== requesterId) {
    return fail("WITHDRAWAL_FORBIDDEN", "You cannot withdraw another seller's budget.", 403);
  }
  const [owner] = await tx.select().from(s.accountTable).where(eq(s.accountTable.id, row.sellerId));
  if (!owner || owner.role !== "seller" || owner.status !== "active" || owner.deletedAt) {
    return fail("WITHDRAWAL_BLOCKED", "The owning seller must be active.");
  }
  return row;
}

async function snapshot(tx: Tx, advertisementId: string, requesterId: string, sellerId: string) {
  const [ad] = await tx.select().from(s.advertisementTable).where(eq(s.advertisementTable.id, advertisementId));
  const [stats] = await tx.select().from(s.advertisementStatsTable).where(eq(s.advertisementStatsTable.advertisementId, advertisementId));
  if (!stats) return fail("WITHDRAWAL_BLOCKED", "Advertisement statistics are missing.");
  const [wallet] = await tx.select().from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId, sellerId));
  const [funding] = await tx.select().from(s.advertisementCoinFundingAccountTable).where(eq(s.advertisementCoinFundingAccountTable.advertisementId, advertisementId));
  const [pending] = await tx.select({ count: sql<string>`count(*)::text` }).from(s.treasureBoxRewardAllocationTable)
    .where(and(eq(s.treasureBoxRewardAllocationTable.advertisementId, advertisementId), eq(s.treasureBoxRewardAllocationTable.status, "demand")));
  // Ledger count detects an intervening debit/credit even if the balance returns to its old value.
  const [ledger] = await tx.select({ count: sql<string>`count(*)::text` }).from(s.advertisementTransactionTable)
    .where(eq(s.advertisementTransactionTable.advertisementId, advertisementId));
  const balance = adMoney(stats.balance);
  const reasons: { code: string; message: string }[] = [];
  if (stats.status !== "archived" || !ad.archivedAt || !ad.financiallyClosedAt) {
    reasons.push({ code: "ADVERTISEMENT_NOT_FINANCIALLY_CLOSED", message: "Archive and financially close the advertisement first." });
  }
  if (!wallet || (funding && (funding.sourceSellerId !== sellerId || funding.status !== "closed" || Number(funding.sellerFundingAvailableAmount) !== 0 || Number(funding.platformAdvanceOutstandingAmount) !== 0)) || pending.count !== "0") {
    reasons.push({ code: "WITHDRAWAL_BLOCKED", message: "Wallet initialization or outstanding funding obligations require reconciliation." });
  }
  if (moneyToMinorUnits(balance) === BigInt(0)) reasons.push({ code: "ZERO_BALANCE", message: "There is no remaining advertisement balance." });
  const confirmationToken = digest([advertisementId, requesterId, sellerId, balance, ledger.count, ad.financiallyClosedAt, stats.status]);
  return { ad, stats, wallet, balance, reasons, confirmationToken };
}

export async function previewAdvertisementWithdrawal(advertisementId: string, requesterId: string) {
  return db.transaction(async (tx) => {
    const { sellerId } = await authorize(tx, advertisementId, requesterId);
    const state = await snapshot(tx, advertisementId, requesterId, sellerId);
    return {
      advertisementId, sellerId, eligible: state.reasons.length === 0, reasons: state.reasons,
      balance: state.balance, withdrawableAmount: state.reasons.length ? "0.00" : state.balance,
      walletBalance: state.wallet?.walletBalance ?? null, currency: "TWD",
      advertisementStatus: state.stats.status, financiallyClosedAt: state.ad.financiallyClosedAt,
      confirmationToken: state.confirmationToken,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function withdrawAdvertisementBudget(input: WithdrawalInput) {
  const expectedBalance = normalizeMoney(input.expectedBalance);
  const amount = input.mode === "amount" ? normalizeMoney(input.amount ?? "") : null;
  const fingerprint = digest([input.requesterId, input.advertisementId, input.mode, amount, expectedBalance, input.confirmationToken]);
  return db.transaction(async (tx) => {
    await lockWalletIdempotencyKeyWithTx(tx, input.idempotencyKey);
    const initial = await authorize(tx, input.advertisementId, input.requesterId);
    // Product ownership can be changed by admins. Lock it before the ad and re-authorize.
    await tx.select({ id: s.productTable.id }).from(s.productTable).where(eq(s.productTable.id, initial.ad.productId)).for("update");
    const { sellerId } = await authorize(tx, input.advertisementId, input.requesterId);
    const [existing] = await tx.select().from(s.accountWalletTransactionTable).where(eq(s.accountWalletTransactionTable.idempotencyKey, input.idempotencyKey));
    if (existing) {
      const metadata = existing.metadata as { fingerprint?: string; response?: Record<string, unknown> } | null;
      if (existing.type !== "advertisement_budget_return" || metadata?.fingerprint !== fingerprint || !metadata.response) {
        return fail("IDEMPOTENCY_CONFLICT", "Idempotency key already belongs to a different operation.");
      }
      return { ...metadata.response, idempotentReplay: true };
    }
    const [adKey] = await tx.select({ id: s.advertisementTransactionTable.id }).from(s.advertisementTransactionTable).where(eq(s.advertisementTransactionTable.idempotencyKey, input.idempotencyKey));
    const [transferKey] = await tx.select({ id: s.advertisementBalanceTransferTable.id }).from(s.advertisementBalanceTransferTable).where(eq(s.advertisementBalanceTransferTable.idempotencyKey, input.idempotencyKey));
    if (adKey || transferKey) return fail("IDEMPOTENCY_CONFLICT", "Idempotency key already belongs to another operation.");
    // Match settlement's funding-account -> stats ordering. Ad lock serializes close/transfer.
    await tx.select({ id: s.advertisementTable.id }).from(s.advertisementTable).where(eq(s.advertisementTable.id, input.advertisementId)).for("update");
    await tx.select({ id: s.accountWalletTable.id }).from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId, sellerId)).for("update");
    await tx.select({ id: s.advertisementCoinFundingAccountTable.id }).from(s.advertisementCoinFundingAccountTable).where(eq(s.advertisementCoinFundingAccountTable.advertisementId, input.advertisementId)).for("update");
    await tx.select({ id: s.advertisementStatsTable.id }).from(s.advertisementStatsTable).where(eq(s.advertisementStatsTable.advertisementId, input.advertisementId)).for("update");
    const state = await snapshot(tx, input.advertisementId, input.requesterId, sellerId);
    if (state.balance !== expectedBalance || state.confirmationToken !== input.confirmationToken) return fail("BALANCE_CHANGED", "Advertisement changed; obtain a new preview and confirm again.");
    if (state.reasons.length) return fail(state.reasons[0].code, state.reasons[0].message);
    const withdrawnAmount = amount ?? state.balance;
    const cents = moneyToMinorUnits(withdrawnAmount);
    if (cents <= BigInt(0)) return fail("INVALID_WITHDRAWAL_REQUEST", "Amount must be positive.", 400);
    if (cents > moneyToMinorUnits(state.balance)) return fail("INSUFFICIENT_AD_BALANCE", "Amount exceeds the remaining advertisement balance.");
    const advertisementBalanceAfter = minorUnitsToMoney(moneyToMinorUnits(state.balance) - cents);
    if (adMoney(Number(withdrawnAmount)) !== withdrawnAmount || adMoney(Number(advertisementBalanceAfter)) !== advertisementBalanceAfter) {
      return fail("WITHDRAWAL_BLOCKED", "Amount cannot be represented safely by the existing advertisement balance column.");
    }
    const wallet = state.wallet!;
    const walletCentsAfter = moneyToMinorUnits(wallet.walletBalance) + cents;
    if (walletCentsAfter > BigInt("999999999999999999")) return fail("WITHDRAWAL_BLOCKED", "Wallet balance would exceed the supported currency range.");
    const walletBalanceAfter = minorUnitsToMoney(walletCentsAfter);
    const walletTransactionId = randomUUID();
    const advertisementTransactionId = randomUUID();
    const response = {
      advertisementId: input.advertisementId, mode: input.mode, withdrawnAmount,
      advertisementBalanceBefore: state.balance, advertisementBalanceAfter,
      walletBalanceBefore: wallet.walletBalance, walletBalanceAfter, walletId: wallet.id,
      walletTransactionId, advertisementTransactionId, advertisementStatus: "archived",
      financiallyClosedAt: state.ad.financiallyClosedAt!.toISOString(), idempotentReplay: false,
    };
    await tx.update(s.advertisementStatsTable).set({ balance: Number(advertisementBalanceAfter) }).where(eq(s.advertisementStatsTable.id, state.stats.id));
    await tx.update(s.accountWalletTable).set({ walletBalance: walletBalanceAfter }).where(eq(s.accountWalletTable.id, wallet.id));
    await tx.insert(s.accountWalletTransactionTable).values({
      id: walletTransactionId, walletId: wallet.id, accountId: sellerId, actorAccountId: input.requesterId,
      advertisementId: input.advertisementId, type: "advertisement_budget_return", amount: withdrawnAmount,
      balanceBefore: wallet.walletBalance, balanceAfter: walletBalanceAfter, idempotencyKey: input.idempotencyKey,
      reason: "回收廣告費", metadata: { fingerprint, response },
    });
    await tx.insert(s.advertisementTransactionTable).values({
      id: advertisementTransactionId, advertisementId: input.advertisementId, sourceSellerId: sellerId,
      type: "budget_withdrawal", amount: -Number(withdrawnAmount), balanceBefore: state.balance,
      balanceAfter: advertisementBalanceAfter, idempotencyKey: input.idempotencyKey,
      accountWalletTransactionId: walletTransactionId, metadata: { actorAccountId: input.requesterId, mode: input.mode },
    });
    await recordAdminActivityWithTx(tx, { actorAccountId: input.requesterId, sellerId,
      eventType: "advertisement.budget_withdrawn", entityType: "advertisement", entityId: input.advertisementId,
      metadata: { withdrawnAmount, walletTransactionId, advertisementTransactionId } });
    return response;
  });
}
