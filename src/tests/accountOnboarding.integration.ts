import "../lib/env";
import { fixtureToken } from "./accountSessionFixture";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mock } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { generateToken } from "../lib/token";
import { recoveryMailer } from "../services/accountRecovery";
import { acceptRecoveryAttempt, issuePasswordReset, consumePasswordReset, hashResetToken, cleanupAccountRecovery } from "../repository/accountRecovery";
import { backfillSellerProfiles } from "../repository/accountProfileBackfill";
import { resolveAdminSellerScope } from "../repository/adminScope";
import { swaggerSpec } from "../lib/swagger";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  process.env.ACCOUNT_PASSWORD_RESET_URL = "https://seller.example.test/reset-password";
  process.env.ACCOUNT_PASSWORD_RESET_ALLOWED_URLS = "http://localhost:3000/reset-password";
  const sent: Parameters<typeof recoveryMailer.send>[0][] = [];
  const mail = mock.method(recoveryMailer, "send", async (message: Parameters<typeof recoveryMailer.send>[0]) => {
    sent.push(message); return { success: true as const };
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, method = "GET", body?: unknown, token?: string, cookie?: string) => {
    const res = await fetch(url + path, { method, headers: { "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any, cookie: res.headers.get("set-cookie")?.split(";")[0], headers: res.headers };
  };
  const register = (body: unknown) => request("/api/admin/account/register", "POST", body);
  const credentials = () => ({ email: `${randomUUID()}@example.test`, password: "Valid-password-123!" });
  const profile = { name: "測試商店", realName: "王小明", phone: "0912345678", address: "台北市" };
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error("Timed out waiting for mail");
  };
  try {
    const old = credentials();
    const full = await register({ ...old, ...profile });
    assert.equal(full.status, 200, JSON.stringify(full.body));
    assert.equal(full.body.data.user.isProfileComplete, true);
    assert.deepEqual(full.body.data.user.missingProfileFields, []);
    assert.equal(full.body.data.user.password, undefined);
    assert.equal(full.body.data.user.credentialVersion, undefined);
    const fullId = full.body.data.user.id;
    const fullToken = full.body.data.token;
    const input = credentials();
    const partial = await register({ ...input, name: "Only name" });
    assert.equal(partial.status, 400);
    assert.equal((await register({ ...input, address: "Only address" })).status, 400);
    const fresh = await register({ ...input, role: "admin", profileCompletedAt: new Date(), isProfileComplete: true });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    const id = fresh.body.data.user.id, token = fresh.body.data.token;
    assert.equal(fresh.body.data.user.role, "seller");
    assert.equal(fresh.body.data.user.isProfileComplete, false);
    assert.deepEqual(fresh.body.data.user.missingProfileFields, ["name", "realName", "phone"]);
    assert.equal(fresh.body.data.user.realName, null);
    assert.equal((await db.select().from(schema.accountWalletTable).where(eq(schema.accountWalletTable.accountId, id))).length, 1);
    const duplicate = await Promise.all([register(input), register(input)]);
    assert.deepEqual(duplicate.map((r) => r.status), [409, 409]);
    assert.equal((await request("/api/admin/account/me", "GET", undefined, token)).status, 200);
    assert.equal((await request("/api/admin/account/login", "POST", input)).status, 200);
    assert.equal((await request("/api/admin/account/refresh-token", "POST", {}, undefined, fresh.cookie)).status, 200);

    for (const [path, method] of [
      ["/api/admin/product/list", "GET"], ["/api/admin/advertisement/list", "GET"],
      ["/api/admin/account-wallet/me", "GET"], ["/api/admin/order/list", "GET"],
      ["/api/admin/refund/list", "GET"], ["/api/admin/delivery/list", "GET"],
      ["/api/admin/chatroom/list", "GET"], ["/api/admin/chatroom/events", "GET"],
      ["/api/admin/chatroom/sync/list", "GET"], ["/api/admin/dashboard/kpi", "GET"],
      ["/api/admin/sidebar-notifications/summary", "GET"], ["/api/admin/account/list", "GET"],
      ["/api/admin/account/update", "PUT"], ["/api/admin/account/sub-account", "POST"],
      ["/api/file/image/upload", "POST"],
    ]) {
      const result = await request(path, method, method === "GET" ? undefined : {}, token);
      assert.equal(result.status, 403, `${method} ${path}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.code, "ACCOUNT_PROFILE_INCOMPLETE", path);
    }
    await assert.rejects(() => resolveAdminSellerScope(id), /complete your seller profile/);
    const [group] = await db.insert(schema.accountGroupTable).values({ parentId: id }).returning();
    const [employee] = await db.insert(schema.accountTable).values({ email: `${randomUUID()}@example.test`, password: "unused", role: "employee", accountGroupId: group.id }).returning();
    assert.equal((await request("/api/admin/product/list", "GET", undefined, await fixtureToken(employee))).body.code, "ACCOUNT_PROFILE_INCOMPLETE");

    assert.equal((await request("/api/admin/account/complete-profile", "POST", { ...profile, phone: "bad" }, token)).status, 400);
    assert.equal((await request("/api/admin/account/complete-profile", "POST", { ...profile, id: fullId }, token)).status, 400);
    const completed = await Promise.all([request("/api/admin/account/complete-profile", "POST", profile, token), request("/api/admin/account/complete-profile", "POST", profile, token)]);
    assert.deepEqual(completed.map((r) => r.status), [200, 200]);
    assert.equal(completed[0].body.data.profileCompletedAt, completed[1].body.data.profileCompletedAt);
    assert.equal((await request("/api/admin/product/list", "GET", undefined, token)).status, 200);
    assert.equal((await request("/api/admin/account/complete-profile", "POST", { ...profile, name: "Changed" }, token)).status, 409);
    assert.equal((await request("/api/admin/account/update", "PUT", { id, role: "employee" }, token)).status, 403);
    assert.equal((await request("/api/admin/account/update", "PUT", { id, phone: null }, token)).status, 400);

    for (const callbackUrl of ["https://evil.example/reset-password", "https://seller.example.test/reset-password?next=evil", "https://seller.example.test/reset-password#bad", "https://user@seller.example.test/reset-password"]) {
      assert.equal((await request("/api/admin/account/forgot-password", "POST", { email: input.email, callbackUrl })).status, 400);
    }
    const forgot = await request("/api/admin/account/forgot-password", "POST", { email: input.email });
    const unknown = await request("/api/admin/account/forgot-password", "POST", { email: credentials().email });
    assert.equal(forgot.status, 200);
    assert.deepEqual(forgot.body, unknown.body);
    await waitFor(() => sent.length === 1);
    assert.equal(sent[0].disableTracking, true);
    assert.equal(sent[0].to, input.email);
    const resetToken = sent[0].html.match(/#token=([A-Za-z0-9_-]{43})/)![1];
    const [stored] = await db.select().from(schema.accountPasswordResetTokenTable).where(eq(schema.accountPasswordResetTokenTable.tokenHash, hashResetToken(resetToken)));
    assert.ok(stored);
    assert.ok(!JSON.stringify(stored).includes(resetToken));
    assert.ok(Math.abs(stored.expiresAt.getTime() - stored.createdAt.getTime() - 1800_000) < 1000);
    assert.equal((await request("/api/admin/account/reset-password", "POST", { token: resetToken, newPassword: "weak" })).status, 400);
    const resend = await request("/api/admin/account/forgot-password", "POST", { email: input.email });
    assert.deepEqual(resend.body, forgot.body);

    // Observe an established stream revoking after reset, including an idle feed.
    const abort = new AbortController();
    const stream = await fetch(url + "/api/admin/chatroom/events", { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /stream.ready/);
    const secondLink = (await issuePasswordReset(input.email))!;
    const newPassword = "New-password-456!";
    const resets = await Promise.all([resetToken, secondLink.token].map((value) => request("/api/admin/account/reset-password", "POST", { token: value, newPassword })));
    assert.deepEqual(resets.map((r) => r.status).sort(), [200, 400]);
    assert.equal(resets.find((r) => r.status === 400)!.body.code, "PASSWORD_RESET_TOKEN_INVALID");
    let rest = "";
    const timer = setTimeout(() => abort.abort(), 5000);
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); } }
    finally { clearTimeout(timer); abort.abort(); }
    assert.match(rest, /auth_expired/);
    assert.equal((await request("/api/admin/account/me", "GET", undefined, token)).status, 401);
    assert.equal((await request("/api/admin/account/me", "GET", undefined, generateToken({ id }))).status, 401);
    assert.equal((await request("/api/admin/account/refresh-token", "POST", {}, undefined, fresh.cookie)).status, 403);
    assert.equal((await request("/api/admin/account/login", "POST", input)).status, 404);
    const newLogin = await request("/api/admin/account/login", "POST", { email: input.email, password: newPassword });
    assert.equal(newLogin.status, 200);
    assert.equal((await request("/api/admin/account/me", "GET", undefined, newLogin.body.data.token)).status, 200);
    assert.equal((await request("/api/admin/account/reset-password", "POST", { token: resetToken, newPassword })).status, 400);
    assert.equal((await request("/api/admin/account/me", "GET", undefined, fullToken)).status, 200);

    const expired = (await issuePasswordReset(old.email))!;
    await db.update(schema.accountPasswordResetTokenTable).set({ createdAt: new Date(Date.now() - 3600_000), expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.accountPasswordResetTokenTable.tokenHash, hashResetToken(expired.token)));
    await assert.rejects(() => consumePasswordReset(expired.token, newPassword), /Invalid or expired/);
    const emailChanged = (await issuePasswordReset(old.email))!;
    assert.equal((await request("/api/admin/account/update", "PUT", { id: fullId, email: credentials().email }, fullToken)).status, 200);
    await assert.rejects(() => consumePasswordReset(emailChanged.token, newPassword), /Invalid or expired/);

    // Incomplete sellers can change passwords without gaining business access.
    const incomplete = await register(credentials());
    const incompleteId = incomplete.body.data.user.id;
    const change = await request("/api/admin/account/change-password", "PUT", { id: incompleteId, oldPassword: "Valid-password-123!", newPassword }, incomplete.body.data.token);
    assert.equal(change.status, 200);
    assert.equal(change.body.data.isProfileComplete, false);
    assert.equal((await request("/api/admin/account/me", "GET", undefined, incomplete.body.data.token)).status, 401);

    const [legacy] = await db.insert(schema.accountTable).values({ ...profile, ...credentials(), role: "seller" }).returning();
    const audit = await backfillSellerProfiles();
    assert.equal(audit.find((r) => r.accountId === legacy.id)!.action, "eligible");
    assert.equal((await db.select().from(schema.accountTable).where(eq(schema.accountTable.id, legacy.id)))[0].profileCompletedAt, null);
    const backfill = await backfillSellerProfiles(true);
    assert.equal(backfill.find((r) => r.accountId === legacy.id)!.action, "completed");
    assert.equal(backfill.find((r) => r.accountId === incompleteId)!.action, "needs-remediation");
    const limits = await Promise.all(Array.from({ length: 8 }, () => acceptRecoveryAttempt("test-race", "same-key", 5)));
    assert.equal(limits.filter(Boolean).length, 5);

    await db.update(schema.accountTable).set({ status: "inactive" }).where(eq(schema.accountTable.id, id));
    assert.equal((await request("/api/admin/account/me", "GET", undefined, newLogin.body.data.token)).status, 403);
    assert.equal(await issuePasswordReset(input.email), null);
    await db.update(schema.accountPasswordResetTokenTable).set({ createdAt: new Date(Date.now() - 10 * 86400_000), expiresAt: new Date(Date.now() - 9 * 86400_000) }).where(eq(schema.accountPasswordResetTokenTable.tokenHash, hashResetToken(expired.token)));
    assert.equal((await cleanupAccountRecovery()).deleted, 1);
    assert.ok((await db.select().from(schema.accountPasswordResetTokenTable)).length > 0);

    const spec = swaggerSpec as any;
    for (const path of ["complete-profile", "forgot-password", "reset-password"]) assert.ok(spec.paths[`/api/admin/account/${path}`].post);
    assert.deepEqual(spec.paths["/api/admin/account/register"].post.requestBody.content["application/json"].schema.required, ["email", "password"]);
    console.log("Account onboarding/recovery integration tests passed.");
  } finally {
    mail.mock.restore();
    server.closeAllConnections(); server.close();
    await client.end();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
