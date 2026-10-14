import { revokeAccountSessionsWithTx } from "./accountSession";
import { createHash, createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, isNull, lt, sql, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { validatePassword } from "../lib/accountProfile";

const tokens = schema.accountPasswordResetTokenTable;
const rates = schema.accountRecoveryRateLimitTable;
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invalidToken = () => new CustomError("Invalid or expired password reset link", 400, "PASSWORD_RESET_TOKEN_INVALID");

// Locks and counters are shared by every API instance. Rate-limit denial commits its counter.
export async function acceptRecoveryAttempt(namespace: string, value: string, limit: number, cooldownSeconds = 0) {
  if (!process.env.JWT_SECRET) throw new CustomError("Account recovery is not configured", 503);
  const key = namespace + ":" + createHmac("sha256", process.env.JWT_SECRET).update(value).digest("hex");
  return db.transaction(async (tx) => {
    await tx.insert(rates).values({ key, windowStartedAt: new Date(0), lastAcceptedAt: new Date(0), attempts: 1 }).onConflictDoNothing();
    const [row] = await tx.select().from(rates).where(eq(rates.key, key)).for("update");
    const [{ now }] = await tx.select({ now: sql<Date>`clock_timestamp()` }).from(rates).where(eq(rates.key, key));
    const current = new Date(now);
    const newWindow = current.getTime() - row.windowStartedAt.getTime() >= 3600_000;
    const attempts = newWindow ? 1 : Math.min(row.attempts + 1, 1_000_000);
    const accepted = attempts <= limit && current.getTime() - row.lastAcceptedAt.getTime() >= cooldownSeconds * 1000;
    await tx.update(rates).set({ attempts, windowStartedAt: newWindow ? current : row.windowStartedAt,
      ...(accepted ? { lastAcceptedAt: current } : {}) }).where(eq(rates.key, key));
    return accepted;
  });
}

export async function issuePasswordReset(email: string) {
  // Match existing login's exact email identity; do not silently change legacy casing rules.
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(schema.accountTable).where(eq(schema.accountTable.email, email)).for("update");
    if (!account || account.status !== "active" || account.deletedAt) return null;
    const token = randomBytes(32).toString("base64url");
    await tx.insert(tokens).values({ accountId: account.id, tokenHash: hashResetToken(token),
      credentialVersion: account.credentialVersion, expiresAt: sql`clock_timestamp() + interval '30 minutes'` });
    return { token, email: account.email };
  });
}

export async function consumePasswordReset(token: string, newPassword: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidToken();
  if (!validatePassword(newPassword)) throw new CustomError("Invalid new password", 400);
  const tokenHash = hashResetToken(token);
  const [candidate] = await db.select({ accountId: tokens.accountId }).from(tokens).where(eq(tokens.tokenHash, tokenHash));
  if (!candidate) throw invalidToken();
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(schema.accountTable).where(eq(schema.accountTable.id, candidate.accountId)).for("update");
    const [record] = await tx.select().from(tokens).where(and(eq(tokens.tokenHash, tokenHash), sql`${tokens.expiresAt} > clock_timestamp()`)).for("update");
    if (!account || account.status !== "active" || account.deletedAt || !record || record.usedAt || record.revokedAt || record.credentialVersion !== account.credentialVersion) throw invalidToken();
    const password = await bcrypt.hash(newPassword, 10);
    await revokeAccountSessionsWithTx(tx, account.id, "password_reset");
    await tx.update(schema.accountTable).set({ password, credentialVersion: account.credentialVersion + 1, updatedAt: new Date() }).where(eq(schema.accountTable.id, account.id));
    await tx.update(tokens).set({ usedAt: new Date() }).where(eq(tokens.id, record.id));
    await tx.update(tokens).set({ revokedAt: new Date() }).where(and(eq(tokens.accountId, account.id), isNull(tokens.usedAt), isNull(tokens.revokedAt)));
    return { email: account.email };
  });
}

// Bounded batches avoid a large delete transaction. Expiry enforcement never depends on this job.
export async function cleanupAccountRecovery() {
  let deleted = 0;
  for (;;) {
    const rows = await db.select({ id: tokens.id }).from(tokens).where(sql`${tokens.expiresAt} < now() - interval '7 days'`).limit(1000);
    if (!rows.length) break;
    deleted += (await db.delete(tokens).where(inArray(tokens.id, rows.map((r) => r.id))).returning({ id: tokens.id })).length;
  }
  await db.delete(rates).where(lt(rates.windowStartedAt, new Date(Date.now() - 2 * 86400_000)));
  return { deleted };
}
