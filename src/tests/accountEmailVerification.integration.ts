import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mock } from "node:test";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { verificationMailer, emailVerificationPage } from "../services/accountEmailVerification";
import { consumeEmailVerification, issueEmailVerification, hashEmailVerificationToken, cleanupEmailVerification, VerificationActor } from "../repository/accountEmailVerification";
import { issuePasswordReset, consumePasswordReset } from "../repository/accountRecovery";
import { revokeAccountSession } from "../repository/accountSession";
import { updateAccount } from "../repository/account";
import { resolveAdminSellerScope } from "../repository/adminScope";
import { fixtureToken } from "./accountSessionFixture";
import { swaggerSpec } from "../lib/swagger";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  process.env.ACCOUNT_EMAIL_VERIFICATION_URL = "https://seller.example.test/verify-email";
  process.env.ACCOUNT_EMAIL_VERIFICATION_ALLOWED_URLS = "http://localhost:3000/verify-email";
  const mails: Parameters<typeof verificationMailer.send>[0][] = [];
  let failMail = false;
  const mail = mock.method(verificationMailer, "send", async (m: Parameters<typeof verificationMailer.send>[0]) => {
    mails.push(m); return failMail ? { success: false as const, error: new Error("simulated") } : { success: true as const };
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, body?: unknown, token?: string, method = "POST", cookie?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any, cookie: r.headers.get("set-cookie")?.split(";")[0], headers: r.headers };
  };
  const call = (path: string, body?: unknown, token?: string, method = "POST", cookie?: string) => request("/api/admin/account" + path, body, token, method, cookie);
  const password = "Valid-password-123!", profile = { name: "測試商店", realName: "王小明", phone: "0912345678" };
  const credentials = () => ({ email: `${randomUUID()}@example.test`, password });
  const tokenIn = (m: typeof mails[number]) => m.html.match(/#token=([A-Za-z0-9_-]{43})/)![1];
  const actor = (access: string): VerificationActor => { const p = jwt.decode(access) as jwt.JwtPayload; return { accountId: p.data.id, sessionId: p.sid, credentialVersion: p.data.credentialVersion }; };
  const clearRates = () => db.delete(schema.accountRecoveryRateLimitTable);
  const readAccount = async (id: string) => (await db.select().from(schema.accountTable).where(eq(schema.accountTable.id, id)))[0];
  try {
    const input = credentials();
    const registered = await call("/register", { ...input, ...profile, isEmailVerified: true, emailVerifiedAt: new Date() });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    const access = registered.body.data.token, id = registered.body.data.user.id;
    assert.equal(registered.body.data.user.isEmailVerified, false);
    assert.equal(registered.body.data.user.emailVerifiedAt, null);
    assert.equal(registered.body.data.user.isProfileComplete, true);
    assert.equal(mails.length, 1); assert.equal(mails[0].to, input.email); assert.equal(mails[0].disableTracking, true);
    const initial = tokenIn(mails[0]);
    const [stored] = await db.select().from(schema.accountEmailVerificationTokenTable).where(eq(schema.accountEmailVerificationTokenTable.tokenHash, hashEmailVerificationToken(initial)));
    assert.equal(stored.purpose, "verify"); assert.ok(!JSON.stringify(stored).includes(initial));
    assert.ok(Math.abs(stored.expiresAt.getTime() - stored.createdAt.getTime() - 1800_000) < 1000);
    assert.equal((await call("/register", input)).status, 409);
    for (const path of ["/api/admin/product/list", "/api/admin/advertisement/list", "/api/admin/account-wallet/me", "/api/admin/order/list", "/api/admin/refund/list", "/api/admin/chatroom/events", "/api/admin/chatroom/sync/list", "/api/admin/dashboard/kpi", "/api/admin/sidebar-notifications/summary"]) {
      const r = await request(path, undefined, access, "GET");
      assert.equal(r.status, 403, path); assert.equal(r.body.code, "ACCOUNT_EMAIL_UNVERIFIED", path);
    }
    assert.equal((await request("/api/file/image/upload", {}, access)).body.code, "ACCOUNT_EMAIL_UNVERIFIED");
    assert.equal((await call("/me", undefined, access, "GET")).status, 200);
    assert.equal((await call("/login", input)).status, 200);
    assert.equal((await call("/refresh-token", undefined, undefined, "POST", registered.cookie)).status, 200);
    await assert.rejects(() => resolveAdminSellerScope(id), /verify your email/);
    const [group] = await db.insert(schema.accountGroupTable).values({ parentId: id }).returning();
    const [employee] = await db.insert(schema.accountTable).values({ ...credentials(), role: "employee", accountGroupId: group.id }).returning();
    const employeeAccess = await fixtureToken(employee);
    assert.equal((await request("/api/admin/product/list", undefined, employeeAccess, "GET")).body.code, "ACCOUNT_EMAIL_UNVERIFIED");
    assert.equal((await call("/verify-email", { token: initial })).status, 401);
    const other = await call("/register", credentials());
    assert.equal((await call("/verify-email", { token: initial }, other.body.data.token)).body.code, "EMAIL_VERIFICATION_TOKEN_INVALID");
    const noGet = await fetch(base + "/api/admin/account/verify-email", { headers: { Authorization: `Bearer ${access}` } });
    assert.notEqual(noGet.status, 200); assert.equal((await readAccount(id)).emailVerifiedAt, null);
    assert.equal((await call("/resend-verification-email", {}, access)).status, 429);
    for (const callbackUrl of ["https://evil.test/verify-email", "https://seller.example.test/verify-email?x=1", "https://seller.example.test/verify-email#x", "https://user@seller.example.test/verify-email"]) {
      assert.equal((await call("/resend-verification-email", { callbackUrl }, access)).status, 400);
    }
    await clearRates();
    assert.equal((await call("/resend-verification-email", { callbackUrl: "http://localhost:3000/verify-email" }, access)).status, 200);
    const resent = tokenIn(mails[mails.length - 1]); assert.match(mails[mails.length - 1].html, /localhost:3000/);
    assert.equal((await call("/verify-email", { token: initial }, access)).status, 400);
    assert.equal((await call("/verify-email", { token: resent, emailVerifiedAt: new Date() }, access)).status, 400);
    const race = await Promise.all([1,2].map(() => call("/verify-email", { token: resent }, access)));
    assert.deepEqual(race.map(r => r.status).sort(), [200,400]);
    const success = race.find(r => r.status === 200)!;
    assert.equal(success.body.data.isEmailVerified, true); assert.equal(success.body.data.password, undefined);
    assert.equal(success.body.data.credentialVersion, undefined);
    assert.equal((await request("/api/admin/product/list", undefined, access, "GET")).status, 200);
    const verifiedAt = (await readAccount(id)).emailVerifiedAt!.toISOString();
    await clearRates(); const mailCount = mails.length;
    assert.equal((await call("/resend-verification-email", {}, access)).status, 200);
    assert.equal(mails.length, mailCount); assert.equal((await readAccount(id)).emailVerifiedAt!.toISOString(), verifiedAt);

    // Completing a profile does not verify email; verification does not complete a profile.
    const partial = await call("/register", credentials());
    assert.equal((await call("/complete-profile", profile, partial.body.data.token)).status, 200);
    assert.equal((await request("/api/admin/product/list", undefined, partial.body.data.token, "GET")).body.code, "ACCOUNT_EMAIL_UNVERIFIED");
    assert.equal((await call("/verify-email", { token: tokenIn(mails[mails.length - 1]) }, other.body.data.token)).status, 400);
    const otherIssued = await issueEmailVerification(other.body.data.user.id, { actor: actor(other.body.data.token) });
    assert.equal((await call("/verify-email", { token: otherIssued!.token }, other.body.data.token)).status, 200);
    assert.equal((await request("/api/admin/product/list", undefined, other.body.data.token, "GET")).body.code, "ACCOUNT_PROFILE_INCOMPLETE");

    // Expiry, credential changes, suspension/reactivation and revoked sessions invalidate links.
    const expired = (await issueEmailVerification(partial.body.data.user.id))!;
    await db.update(schema.accountEmailVerificationTokenTable).set({ createdAt: new Date(Date.now()-3600_000), expiresAt: new Date(Date.now()-1000) }).where(eq(schema.accountEmailVerificationTokenTable.tokenHash, hashEmailVerificationToken(expired.token)));
    await assert.rejects(() => consumeEmailVerification(actor(partial.body.data.token), expired.token, "verify"), /Invalid or expired/);
    const resetLink = await issuePasswordReset((await readAccount(partial.body.data.user.id)).email);
    const beforeReset = (await issueEmailVerification(partial.body.data.user.id))!;
    await consumePasswordReset(resetLink!.token, "Another-password-456!");
    assert.equal((await readAccount(partial.body.data.user.id)).emailVerifiedAt, null);
    await assert.rejects(() => consumeEmailVerification(actor(partial.body.data.token), beforeReset.token, "verify"), /Session expired/);
    const suspend = await call("/register", credentials());
    const beforeSuspend = tokenIn(mails[mails.length - 1]);
    await updateAccount(suspend.body.data.user.id, { status: "inactive" });
    await updateAccount(suspend.body.data.user.id, { status: "active" });
    assert.equal((await call("/verify-email", { token: beforeSuspend }, suspend.body.data.token)).status, 400);
    const beforeLogout = (await issueEmailVerification(suspend.body.data.user.id))!;
    await revokeAccountSession(undefined, { accountId: suspend.body.data.user.id, sessionId: actor(suspend.body.data.token).sessionId });
    await assert.rejects(() => consumeEmailVerification(actor(suspend.body.data.token), beforeLogout.token, "verify"), /Session expired/);

    // Registration survives mail failure, configuration failure does not create accounts.
    failMail = true; const deliveryInput = credentials();
    const delivery = await call("/register", deliveryInput); assert.equal(delivery.status, 200);
    await clearRates(); assert.equal((await call("/resend-verification-email", {}, delivery.body.data.token)).body.code, "EMAIL_VERIFICATION_DELIVERY_FAILED");
    failMail = false; await clearRates(); assert.equal((await call("/resend-verification-email", {}, delivery.body.data.token)).status, 200);
    const savedUrl = process.env.ACCOUNT_EMAIL_VERIFICATION_URL; delete process.env.ACCOUNT_EMAIL_VERIFICATION_URL;
    const missingConfig = credentials(); assert.equal((await call("/register", missingConfig)).status, 503);
    assert.equal((await db.select().from(schema.accountTable).where(eq(schema.accountTable.email, missingConfig.email))).length, 0);
    process.env.ACCOUNT_EMAIL_VERIFICATION_URL = savedUrl;
    process.env.ACCOUNT_EMAIL_VERIFICATION_ALLOWED_URLS = "http://localhost:3000/verify-email";
    const oldEnv = process.env.NODE_ENV; process.env.NODE_ENV = "development";
    assert.throws(() => emailVerificationPage(), /configuration is invalid/); process.env.NODE_ENV = oldEnv;

    // New address remains pending; purpose separation and confirmation revoke sessions/reset links.
    const newEmail = credentials().email;
    assert.equal((await call("/update", { id, email: newEmail }, access, "PUT")).body.code, "ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION");
    await clearRates();
    assert.equal((await call("/request-email-change", { newEmail, password: "wrong" }, access)).body.code, "EMAIL_CHANGE_PASSWORD_INVALID");
    await clearRates();
    assert.equal((await call("/request-email-change", { newEmail, password }, access)).status, 200);
    const changeToken = tokenIn(mails[mails.length - 1]); assert.match(mails[mails.length - 1].html, /purpose=change/);
    assert.equal((await readAccount(id)).email, input.email);
    assert.equal((await call("/verify-email", { token: changeToken }, access)).status, 400);
    const pendingReset = (await issuePasswordReset(input.email))!;
    const loginB = await call("/login", input);
    const abort = new AbortController();
    const stream = await fetch(base + "/api/admin/chatroom/events", { headers: { Authorization: `Bearer ${access}` }, signal: abort.signal });
    assert.equal(stream.status, 200); const reader = stream.body!.getReader(); await reader.read();
    const changed = await call("/confirm-email-change", { token: changeToken }, access);
    assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.equal(changed.body.data.requiresLogin, true);
    assert.ok(changed.cookie?.endsWith("=")); assert.equal((await readAccount(id)).email, newEmail);
    assert.equal((await call("/me", undefined, loginB.body.data.token, "GET")).status, 401);
    await assert.rejects(() => consumePasswordReset(pendingReset.token, "Another-password-456!"), /Invalid or expired/);
    assert.equal((await call("/login", input)).status, 404);
    assert.equal((await call("/login", { email: newEmail, password })).status, 200);
    let frames = ""; const timer = setTimeout(() => abort.abort(), 6000);
    try { for (;;) { const chunk = await reader.read(); if(chunk.done) break; frames += new TextDecoder().decode(chunk.value); } }
    finally { clearTimeout(timer); abort.abort(); }
    assert.match(frames, /auth_expired/);
    assert.ok(mails.some(m => m.to === input.email && m.subject === "水滴｜電子郵件已變更"));

    // A target email claimed between request and confirmation must roll back all revocations.
    const contender = await call("/register", credentials()), targetEmail = credentials().email;
    await clearRates(); assert.equal((await call("/request-email-change", { newEmail: targetEmail, password }, contender.body.data.token)).status, 200);
    const contested = tokenIn(mails[mails.length - 1]); assert.equal((await call("/register", { email: targetEmail, password })).status, 200);
    assert.equal((await call("/confirm-email-change", { token: contested }, contender.body.data.token)).body.code, "ACCOUNT_EMAIL_UNAVAILABLE");
    assert.equal((await call("/me", undefined, contender.body.data.token, "GET")).status, 200);
    assert.equal((await readAccount(contender.body.data.user.id)).credentialVersion, 0);
    await db.update(schema.accountEmailVerificationTokenTable).set({ createdAt: new Date(Date.now()-10*86400_000), expiresAt: new Date(Date.now()-9*86400_000) }).where(eq(schema.accountEmailVerificationTokenTable.tokenHash, hashEmailVerificationToken(expired.token)));
    assert.equal((await cleanupEmailVerification()).deleted, 1);
    assert.ok((await db.select().from(schema.accountEmailVerificationTokenTable)).length > 0);
    for(const path of ["resend-verification-email", "verify-email", "request-email-change", "confirm-email-change"]) assert.ok((swaggerSpec as any).paths[`/api/admin/account/${path}`].post);
    assert.match((swaggerSpec as any).paths["/api/admin/account/update"].put.description, /ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION/);
    assert.ok((swaggerSpec as any).components.schemas.Account.properties.emailVerifiedAt);
    console.log("Email verification integration tests passed.");
  } finally { mail.mock.restore(); server.closeAllConnections(); server.close(); await client.end(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
