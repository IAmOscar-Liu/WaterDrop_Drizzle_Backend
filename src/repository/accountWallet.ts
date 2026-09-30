import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import {
  addMoney,
  moneyToMinorUnits,
  normalizeMoney,
} from "../lib/money";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";
import { recordAdminActivityWithTx } from "./adminActivity";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function normalizeSignedMoney(value: string | number) {
  const raw = String(value);
  return raw.startsWith("-")
    ? `-${normalizeMoney(raw.slice(1))}`
    : normalizeMoney(raw);
}

export type ListWalletTransactionsParams = PaginationParams & {
  accountId: string;
  type?: schema.AccountWalletTransaction["type"];
  startAt?: Date;
  endAt?: Date;
};

export async function lockWalletIdempotencyKeyWithTx(
  tx: DbTransaction,
  idempotencyKey: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
  );
}

export async function getAccountWallet(accountId: string) {
  const [account] = await db
    .select({ id: schema.accountTable.id })
    .from(schema.accountTable)
    .where(eq(schema.accountTable.id, accountId))
    .limit(1);
  if (!account) throw new CustomError("Account not found.", 404);

  const [wallet] = await db
    .select()
    .from(schema.accountWalletTable)
    .where(eq(schema.accountWalletTable.accountId, accountId))
    .limit(1);
  if (!wallet) {
    throw new CustomError(
      "Account wallet has not been initialized. Run the wallet backfill first.",
      409,
    );
  }
  return wallet;
}

export async function listAccountWalletTransactions({
  accountId,
  type,
  startAt,
  endAt,
  page,
  limit,
}: ListWalletTransactionsParams) {
  await getAccountWallet(accountId);
  const pagination = getPagination(page, limit);
  const where = compactConditions([
    eq(schema.accountWalletTransactionTable.accountId, accountId),
    type ? eq(schema.accountWalletTransactionTable.type, type) : undefined,
    startAt
      ? gte(schema.accountWalletTransactionTable.createdAt, startAt)
      : undefined,
    endAt
      ? lte(schema.accountWalletTransactionTable.createdAt, endAt)
      : undefined,
  ]);

  const [[totalRow], transactions] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.accountWalletTransactionTable)
      .where(where),
    db
      .select()
      .from(schema.accountWalletTransactionTable)
      .where(where)
      .orderBy(
        desc(schema.accountWalletTransactionTable.createdAt),
        desc(schema.accountWalletTransactionTable.sequence),
      )
      .limit(pagination.limit)
      .offset(pagination.offset),
  ]);

  return {
    transactions,
    page: pagination.page,
    limit: pagination.limit,
    total: totalRow.value,
    totalPages: getTotalPages(totalRow.value, pagination.limit),
  };
}

export async function getAccountWalletSummary({
  accountId,
  startAt,
  endAt,
}: {
  accountId: string;
  startAt?: Date;
  endAt?: Date;
}) {
  const wallet = await getAccountWallet(accountId);
  if (startAt && endAt && startAt > endAt) {
    throw new CustomError("startAt must be before endAt", 400);
  }

  const [openingTransaction] = startAt
    ? await db
        .select({ balanceAfter: schema.accountWalletTransactionTable.balanceAfter })
        .from(schema.accountWalletTransactionTable)
        .where(
          and(
            eq(schema.accountWalletTransactionTable.accountId, accountId),
            sql`${schema.accountWalletTransactionTable.createdAt} < ${startAt}`,
          ),
        )
        .orderBy(
          desc(schema.accountWalletTransactionTable.createdAt),
          desc(schema.accountWalletTransactionTable.sequence),
        )
        .limit(1)
    : [];
  const [closingTransaction] = endAt
    ? await db
        .select({ balanceAfter: schema.accountWalletTransactionTable.balanceAfter })
        .from(schema.accountWalletTransactionTable)
        .where(
          and(
            eq(schema.accountWalletTransactionTable.accountId, accountId),
            lte(schema.accountWalletTransactionTable.createdAt, endAt),
          ),
        )
        .orderBy(
          desc(schema.accountWalletTransactionTable.createdAt),
          desc(schema.accountWalletTransactionTable.sequence),
        )
        .limit(1)
    : [];

  const where = compactConditions([
    eq(schema.accountWalletTransactionTable.accountId, accountId),
    startAt ? gte(schema.accountWalletTransactionTable.createdAt, startAt) : undefined,
    endAt ? lte(schema.accountWalletTransactionTable.createdAt, endAt) : undefined,
  ]);
  const [totals] = await db
    .select({
      adminCredits: sql<string>`coalesce(sum(case when ${schema.accountWalletTransactionTable.type} = 'admin_credit' then ${schema.accountWalletTransactionTable.amount} else 0 end), 0)::numeric(18,2)`,
      legacyOpeningCredits: sql<string>`coalesce(sum(case when ${schema.accountWalletTransactionTable.type} = 'legacy_opening_balance' then ${schema.accountWalletTransactionTable.amount} else 0 end), 0)::numeric(18,2)`,
      advertisementFundingDebits: sql<string>`coalesce(sum(case when ${schema.accountWalletTransactionTable.type} = 'advertisement_funding_debit' then ${schema.accountWalletTransactionTable.amount} else 0 end), 0)::numeric(18,2)`,
      transactionCount: count(),
    })
    .from(schema.accountWalletTransactionTable)
    .where(where);

  return {
    accountId,
    openingBalance: normalizeMoney(openingTransaction?.balanceAfter ?? "0"),
    adminCredits: normalizeMoney(totals.adminCredits),
    legacyOpeningCredits: normalizeMoney(totals.legacyOpeningCredits),
    advertisementFundingDebits: normalizeSignedMoney(
      totals.advertisementFundingDebits,
    ),
    closingBalance: normalizeMoney(
      endAt ? closingTransaction?.balanceAfter ?? "0" : wallet.walletBalance,
    ),
    transactionCount: totals.transactionCount,
    startAt: startAt?.toISOString() ?? null,
    endAt: endAt?.toISOString() ?? null,
  };
}

export async function creditSellerWallet({
  accountId,
  actorAccountId,
  amount,
  idempotencyKey,
  reason,
  externalReference,
  metadata,
}: {
  accountId: string;
  actorAccountId: string;
  amount: string;
  idempotencyKey: string;
  reason?: string;
  externalReference?: string;
  metadata?: Record<string, unknown>;
}) {
  const normalizedAmount = normalizeMoney(amount);
  if (moneyToMinorUnits(normalizedAmount) <= BigInt(0)) {
    throw new CustomError("Credit amount must be positive.", 400);
  }

  return db.transaction(async (tx) => {
    await lockWalletIdempotencyKeyWithTx(tx, idempotencyKey);

    const [existing] = await tx
      .select()
      .from(schema.accountWalletTransactionTable)
      .where(
        eq(schema.accountWalletTransactionTable.idempotencyKey, idempotencyKey),
      )
      .limit(1);
    if (existing) {
      if (
        existing.type !== "admin_credit" ||
        existing.accountId !== accountId ||
        existing.actorAccountId !== actorAccountId ||
        normalizeMoney(existing.amount) !== normalizedAmount
      ) {
        throw new CustomError(
          "Idempotency key was already used for a different wallet operation.",
          409,
        );
      }

      const wallet = await getWalletForTransaction(tx, existing.walletId);
      return {
        wallet: { ...wallet, walletBalance: existing.balanceAfter },
        transaction: existing,
        idempotentReplay: true,
      };
    }

    const [actor] = await tx
      .select({ role: schema.accountTable.role })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.id, actorAccountId))
      .limit(1);
    if (!actor || actor.role !== "admin") {
      throw new CustomError("Administrator access required.", 403);
    }

    const [target] = await tx
      .select({ role: schema.accountTable.role })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.id, accountId))
      .limit(1);
    if (!target) throw new CustomError("Account not found.", 404);
    if (target.role !== "seller") {
      throw new CustomError("Only seller wallets may be credited.", 409);
    }

    const [walletBefore] = await tx
      .select()
      .from(schema.accountWalletTable)
      .where(eq(schema.accountWalletTable.accountId, accountId))
      .for("update");
    if (!walletBefore) {
      throw new CustomError(
        "Account wallet has not been initialized. Run the wallet backfill first.",
        409,
      );
    }

    const balanceAfter = addMoney(walletBefore.walletBalance, normalizedAmount);
    const [wallet] = await tx
      .update(schema.accountWalletTable)
      .set({ walletBalance: balanceAfter })
      .where(eq(schema.accountWalletTable.id, walletBefore.id))
      .returning();

    const [transaction] = await tx
      .insert(schema.accountWalletTransactionTable)
      .values({
        walletId: wallet.id,
        accountId,
        actorAccountId,
        type: "admin_credit",
        amount: normalizedAmount,
        balanceBefore: walletBefore.walletBalance,
        balanceAfter,
        idempotencyKey,
        reason,
        externalReference,
        metadata,
      })
      .returning();

    await recordAdminActivityWithTx(tx, {
      actorAccountId,
      sellerId: accountId,
      eventType: "wallet.credited",
      entityType: "account_wallet_transaction",
      entityId: transaction.id,
      metadata: { amount: normalizedAmount, reason, externalReference },
    });

    return { wallet, transaction, idempotentReplay: false };
  });
}

async function getWalletForTransaction(tx: DbTransaction, walletId: string) {
  const [wallet] = await tx
    .select()
    .from(schema.accountWalletTable)
    .where(eq(schema.accountWalletTable.id, walletId))
    .limit(1);
  if (!wallet) throw new CustomError("Account wallet not found.", 404);
  return wallet;
}
