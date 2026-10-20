import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { revokeAccountSessionsWithTx } from "./accountSession";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type VerificationActor = { accountId: string; sessionId: string; credentialVersion: number };
type Purpose = "verify" | "change";
const tokens = schema.accountEmailVerificationTokenTable;
export const hashEmailVerificationToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () => new CustomError("Invalid or expired email verification link", 400, "EMAIL_VERIFICATION_TOKEN_INVALID");

// Account -> session -> token, matching password change/logout/refresh lock ordering.
async function lockActor(tx: Tx, actor: VerificationActor) {
  const [account] = await tx.select().from(schema.accountTable).where(eq(schema.accountTable.id, actor.accountId)).for("update");
  if (!account || account.status !== "active" || account.deletedAt) throw new CustomError("Account unavailable", 403);
  const [session] = await tx.select().from(schema.accountSessionTable).where(and(
    eq(schema.accountSessionTable.id, actor.sessionId), eq(schema.accountSessionTable.accountId, actor.accountId),
    eq(schema.accountSessionTable.credentialVersion, actor.credentialVersion), isNull(schema.accountSessionTable.revokedAt),
    sql`${schema.accountSessionTable.expiresAt} > clock_timestamp()`,
  )).for("update");
  if (!session || account.credentialVersion !== actor.credentialVersion) throw new CustomError("Session expired or revoked; please log in", 401, "ACCOUNT_SESSION_INVALID");
  return account;
}

export async function revokeEmailVerificationWithTx(tx: Tx, accountId: string) {
  await tx.update(tokens).set({ revokedAt: new Date() }).where(and(eq(tokens.accountId, accountId), isNull(tokens.usedAt), isNull(tokens.revokedAt)));
}

export async function issueEmailVerification(accountId: string, options: {
  actor?: VerificationActor; expectedVersion?: number; newEmail?: string; password?: string;
} = {}) {
  return db.transaction(async (tx) => {
    const account = options.actor ? await lockActor(tx, options.actor)
      : (await tx.select().from(schema.accountTable).where(eq(schema.accountTable.id, accountId)).for("update"))[0];
    if (!account || account.id !== accountId || account.status !== "active" || account.deletedAt) throw new CustomError("Account unavailable", 403);
    if (options.expectedVersion !== undefined && account.credentialVersion !== options.expectedVersion) throw invalid();
    const purpose: Purpose = options.newEmail === undefined ? "verify" : "change";
    if (purpose === "verify" && account.emailVerifiedAt) return null;
    const targetEmail = options.newEmail ?? account.email;
    if (purpose === "change") {
      if (!options.actor || !options.password || !await bcrypt.compare(options.password, account.password)) {
        throw new CustomError("Incorrect password", 403, "EMAIL_CHANGE_PASSWORD_INVALID");
      }
      if (targetEmail === account.email) throw new CustomError("New email must differ from current email", 400);
      const [existing] = await tx.select({ id: schema.accountTable.id }).from(schema.accountTable).where(eq(schema.accountTable.email, targetEmail));
      if (existing) throw new CustomError("Email unavailable", 409, "ACCOUNT_EMAIL_UNAVAILABLE");
    }
    // A resend replaces the outstanding link of the same purpose. An email
    // correction must not invalidate verification of the still-current email.
    await tx.update(tokens).set({ revokedAt: new Date() }).where(and(eq(tokens.accountId, accountId),
      eq(tokens.purpose, purpose), isNull(tokens.usedAt), isNull(tokens.revokedAt)));
    const token = randomBytes(32).toString("base64url");
    await tx.insert(tokens).values({ accountId, emailSnapshot: account.email, targetEmail, purpose,
      credentialVersion: account.credentialVersion, tokenHash: hashEmailVerificationToken(token),
      expiresAt: sql`clock_timestamp() + interval '30 minutes'` });
    return { token, email: targetEmail, oldEmail: account.email, purpose };
  });
}

export async function consumeEmailVerification(actor: VerificationActor, token: string, purpose: Purpose) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  try {
    return await db.transaction(async (tx) => {
      const account = await lockActor(tx, actor);
      const [record] = await tx.select().from(tokens).where(and(eq(tokens.tokenHash, hashEmailVerificationToken(token)),
        eq(tokens.accountId, actor.accountId), eq(tokens.purpose, purpose), sql`${tokens.expiresAt} > clock_timestamp()`)).for("update");
      if (!record || record.usedAt || record.revokedAt || record.emailSnapshot !== account.email || record.credentialVersion !== account.credentialVersion) throw invalid();
      if (purpose === "change") {
        await revokeAccountSessionsWithTx(tx, account.id, "email_changed");
        await tx.update(schema.accountPasswordResetTokenTable).set({ revokedAt: new Date() }).where(and(
          eq(schema.accountPasswordResetTokenTable.accountId, account.id), isNull(schema.accountPasswordResetTokenTable.usedAt), isNull(schema.accountPasswordResetTokenTable.revokedAt)));
      }
      await tx.update(schema.accountTable).set({ emailVerifiedAt: new Date(), updatedAt: new Date(),
        ...(purpose === "change" ? { email: record.targetEmail, credentialVersion: account.credentialVersion + 1 } : {}),
      }).where(eq(schema.accountTable.id, account.id));
      await tx.update(tokens).set({ usedAt: new Date() }).where(eq(tokens.id, record.id));
      // Also invalidate any pending email change once the account's current
      // verification state changes. The caller can request a fresh change link.
      await revokeEmailVerificationWithTx(tx, account.id);
      return { accountId: account.id, oldEmail: account.email, email: record.targetEmail };
    });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505") throw new CustomError("Email unavailable", 409, "ACCOUNT_EMAIL_UNAVAILABLE");
    throw error;
  }
}

export async function cleanupEmailVerification() {
  let deleted = 0;
  for (;;) {
    const rows = await db.select({ id: tokens.id }).from(tokens).where(sql`${tokens.expiresAt} < now() - interval '7 days'`).limit(1000);
    if (!rows.length) return { deleted };
    deleted += (await db.delete(tokens).where(inArray(tokens.id, rows.map(r => r.id))).returning()).length;
  }
}
