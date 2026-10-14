import { eq } from "drizzle-orm";
import db from "../lib/initDB";
import * as schema from "../db/schema";
import { generateAdminAccessToken, generateToken } from "../lib/token";

// Tests that directly insert account fixtures must also model a previously issued login session.
// Real authentication/rotation tests use the HTTP login endpoint instead.
const sessions = new Map<string, Promise<schema.AccountSession>>();
export async function fixtureToken(payload: { id: string }) {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DATABASE_MANAGED !== "true") throw new Error("Disposable tests only");
  const account = await db.query.accountTable.findFirst({ where: eq(schema.accountTable.id, payload.id) });
  if (!account) return generateToken(payload)!;
  const key = `${account.id}:${account.credentialVersion}`;
  if (!sessions.has(key)) sessions.set(key, db.insert(schema.accountSessionTable).values({
    accountId: account.id, credentialVersion: account.credentialVersion, expiresAt: new Date(Date.now() + 30 * 86400_000),
  }).returning().then(([session]) => session));
  const session = await sessions.get(key)!;
  return generateAdminAccessToken(account, session.id, session.expiresAt);
}
