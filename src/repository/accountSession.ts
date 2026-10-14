import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";

const sessions = schema.accountSessionTable;
const tokens = schema.accountRefreshTokenTable;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const newToken = () => `ar_${randomBytes(32).toString("base64url")}`;
const validShape = (value?: string): value is string => typeof value === "string" && /^ar_[A-Za-z0-9_-]{43}$/.test(value);
const invalid = () => new CustomError("Refresh session is unavailable; please log in", 403, "REFRESH_TOKEN_INVALID");

// Every mutation locks account -> session -> token. Reset/password changes use the same order.
export async function createAccountSession(accountId: string, expectedVersion: number) {
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(schema.accountTable).where(eq(schema.accountTable.id, accountId)).for("update");
    if (!account || account.status !== "active" || account.deletedAt || account.credentialVersion !== expectedVersion) {
      throw new CustomError("Credentials changed; please log in again", 401, "ACCOUNT_CREDENTIALS_CHANGED");
    }
    const [session] = await tx.insert(sessions).values({ accountId, credentialVersion: expectedVersion,
      expiresAt: sql`clock_timestamp() + interval '30 days'` }).returning();
    const refreshToken = newToken();
    await tx.insert(tokens).values({ sessionId: session.id, tokenHash: hash(refreshToken) });
    return { session, refreshToken };
  });
}

export async function rotateAccountRefreshToken(raw?: string) {
  if (!validShape(raw)) throw invalid();
  const [candidate] = await db.select({ sessionId: sessions.id, accountId: sessions.accountId })
    .from(tokens).innerJoin(sessions, eq(sessions.id, tokens.sessionId)).where(eq(tokens.tokenHash, hash(raw)));
  if (!candidate) throw invalid();
  const result = await db.transaction(async (tx) => {
    const [account] = await tx.select().from(schema.accountTable).where(eq(schema.accountTable.id, candidate.accountId)).for("update");
    const [session] = await tx.select({ session: sessions, expired: sql<boolean>`${sessions.expiresAt} <= clock_timestamp()` })
      .from(sessions).where(eq(sessions.id, candidate.sessionId)).for("update");
    if (!account || !session) return { error: "REFRESH_TOKEN_INVALID" } as const;
    const [token] = await tx.select().from(tokens).where(and(eq(tokens.sessionId, candidate.sessionId), eq(tokens.tokenHash, hash(raw)))).for("update");
    if (!token) return { error: "REFRESH_TOKEN_INVALID" } as const;
    if (session.session.revokedAt) return { error: "REFRESH_TOKEN_INVALID" } as const;
    if (token.usedAt) {
      await tx.update(sessions).set({ revokedAt: new Date(), revocationReason: "refresh_reuse" }).where(eq(sessions.id, candidate.sessionId));
      // Return the error until AFTER commit, otherwise revocation would be rolled back.
      return { error: "REFRESH_TOKEN_REUSED" } as const;
    }
    if (session.expired || account.status !== "active" || account.deletedAt || account.credentialVersion !== session.session.credentialVersion) {
      await tx.update(sessions).set({ revokedAt: new Date(), revocationReason: "account_or_session_invalid" }).where(eq(sessions.id, candidate.sessionId));
      return { error: "REFRESH_TOKEN_INVALID" } as const;
    }
    const refreshToken = newToken();
    await tx.update(tokens).set({ usedAt: new Date() }).where(eq(tokens.id, token.id));
    await tx.insert(tokens).values({ sessionId: candidate.sessionId, tokenHash: hash(refreshToken) });
    return { session: session.session, refreshToken };
  });
  if (result.error) throw new CustomError("Refresh session is unavailable; please log in", 403, result.error);
  return result;
}

export async function assertAccountSession(accountId: string, sessionId: string, credentialVersion: number) {
  const [session] = await db.select({ id: sessions.id }).from(sessions)
    .innerJoin(schema.accountTable, eq(schema.accountTable.id, sessions.accountId))
    .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId), eq(sessions.credentialVersion, credentialVersion),
      eq(schema.accountTable.credentialVersion, credentialVersion), eq(schema.accountTable.status, "active"),
      isNull(schema.accountTable.deletedAt), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > clock_timestamp()`));
  if (!session) throw new CustomError("Session expired or revoked; please log in", 401, "ACCOUNT_SESSION_INVALID");
}

export async function revokeAccountSessionsWithTx(tx: Tx, accountId: string, reason: string) {
  // Caller already holds the account lock. All session mutations acquire it first.
  await tx.update(sessions).set({ revokedAt: new Date(), revocationReason: reason })
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
}

export async function revokeAccountSession(raw?: string, access?: { accountId: string; sessionId: string }) {
  let target: { accountId: string; sessionId: string } | undefined;
  if (validShape(raw)) {
    [target] = await db.select({ accountId: sessions.accountId, sessionId: sessions.id }).from(tokens)
      .innerJoin(sessions, eq(sessions.id, tokens.sessionId)).where(eq(tokens.tokenHash, hash(raw)));
  }
  target ??= access;
  if (!target) return;
  const { accountId, sessionId } = target;
  await db.transaction(async (tx) => {
    await tx.select({ id: schema.accountTable.id }).from(schema.accountTable).where(eq(schema.accountTable.id, accountId)).for("update");
    await tx.update(sessions).set({ revokedAt: new Date(), revocationReason: "logout" })
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
  });
}

export async function cleanupAccountSessions() {
  let deleted = 0;
  for (;;) {
    const rows = await db.select({ id: sessions.id }).from(sessions).where(sql`${sessions.expiresAt} < now() - interval '7 days'`).limit(1000);
    if (!rows.length) return { deleted };
    deleted += (await db.delete(sessions).where(inArray(sessions.id, rows.map((row) => row.id))).returning({ id: sessions.id })).length;
    // Token history cascades only after the whole session has expired + retention.
  }
}
