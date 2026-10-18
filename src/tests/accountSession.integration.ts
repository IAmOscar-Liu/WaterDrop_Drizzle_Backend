import { issueEmailVerification, consumeEmailVerification } from "../repository/accountEmailVerification";
import "../lib/env";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as schema from "../db/schema";
import { cleanupAccountSessions, createAccountSession } from "../repository/accountSession";
import { consumePasswordReset, issuePasswordReset } from "../repository/accountRecovery";
import { generateToken } from "../lib/token";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (process.argv.includes("--child")) {
    process.send?.({ base });
    process.once("message", async () => { server.closeAllConnections(); server.close(); await client.end(); process.exit(0); });
    return;
  }
  const child = fork(__filename, ["--child"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const other = await new Promise<string>((resolve, reject) => {
    child.once("message", (message: any) => resolve(message.base));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Child exited: ${code}`)));
  });
  const controllers: AbortController[] = [];
  const request = async (path: string, options: { method?: string; body?: unknown; cookie?: string; token?: string; host?: string } = {}) => {
    const res = await fetch((options.host ?? base) + "/api/admin/account" + path, {
      method: options.method ?? "POST", headers: { "Content-Type": "application/json",
        ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: res.status, body: await res.json() as any, cookie: res.headers.get("set-cookie")?.split(";")[0], headers: res.headers };
  };
  const email = `${randomUUID()}@example.test`, password = "Session-password-123!";
  const login = async () => {
    const r = await request("/login", { body: { email, password } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r;
  };
  const me = (token: string) => request("/me", { method: "GET", token });
  const refresh = (cookie?: string, host = base) => request("/refresh-token", { cookie, host });
  const claims = (token: string) => jwt.decode(token) as jwt.JwtPayload;
  try {
    const first = await request("/register", { body: { email, password, name: "Session shop", realName: "王小明", phone: "0912345678" } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const id = first.body.data.user.id;
    const accessA = first.body.data.token;
    const decoded = claims(accessA);
    const verification = await issueEmailVerification(id);
    await consumeEmailVerification({ accountId: id, sessionId: decoded.sid, credentialVersion: decoded.data.credentialVersion }, verification!.token, "verify");
    assert.equal(decoded.tokenUse, "admin_access");
    assert.equal(decoded.iss, "waterdrop"); assert.equal(decoded.aud, "waterdrop-admin");
    assert.equal(decoded.data.id, id);
    assert.equal(decoded.data.email, undefined);
    assert.match(first.cookie!, /=ar_[A-Za-z0-9_-]{43}$/);
    const sessionA = (await db.select().from(schema.accountSessionTable).where(eq(schema.accountSessionTable.id, decoded.sid)))[0];
    assert.ok(Math.abs(sessionA.expiresAt.getTime() - sessionA.createdAt.getTime() - 30 * 86400_000) < 1000);
    const history = await db.select().from(schema.accountRefreshTokenTable).where(eq(schema.accountRefreshTokenTable.sessionId, decoded.sid));
    assert.equal(history.length, 1);
    assert.ok(!JSON.stringify(history).includes(first.cookie!.split("=")[1]));
    assert.equal((await me(first.cookie!.split("=")[1])).status, 401);
    const legacy = generateToken({ id, credentialVersion: 0 })!;
    assert.equal((await me(legacy)).body.code, "ADMIN_ACCESS_TOKEN_REQUIRED");
    assert.equal((await refresh(`${process.env.REFRESH_TOKEN_NAME}=${legacy}`)).status, 403);
    assert.equal((await refresh(`${process.env.REFRESH_TOKEN_NAME}=${accessA}`)).status, 403);
    const wrongPurpose = jwt.sign({ ...decoded, tokenUse: "admin_refresh" }, process.env.JWT_SECRET!);
    assert.equal((await me(wrongPurpose)).status, 401);
    assert.equal((await refresh()).status, 401);
    const independent = await login();
    const rotated = await refresh(first.cookie, other);
    assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
    assert.notEqual(rotated.cookie, first.cookie);
    assert.equal((await me(accessA)).status, 200); // ordinary rotation does not revoke access tokens
    assert.equal((await db.select().from(schema.accountSessionTable).where(eq(schema.accountSessionTable.id, decoded.sid)))[0].expiresAt.toISOString(), sessionA.expiresAt.toISOString());
    const replay = await refresh(first.cookie);
    assert.equal(replay.status, 403);
    assert.equal(replay.body.code, "REFRESH_TOKEN_REUSED");
    assert.match(replay.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
    const revoked = (await db.select().from(schema.accountSessionTable).where(eq(schema.accountSessionTable.id, decoded.sid)))[0];
    assert.equal(revoked.revocationReason, "refresh_reuse");
    assert.equal((await refresh(rotated.cookie, other)).status, 403);
    assert.equal((await me(rotated.body.data.token)).status, 401);
    assert.equal((await me(independent.body.data.token)).status, 200);

    // Two processes racing the same token: one rotates, the second revokes that session.
    const race = await login();
    const outcomes = await Promise.all([refresh(race.cookie), refresh(race.cookie, other)]);
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 403]);
    assert.equal(outcomes.find((r) => r.status === 403)!.body.code, "REFRESH_TOKEN_REUSED");
    assert.equal((await me(outcomes.find((r) => r.status === 200)!.body.data.token)).status, 401);

    // Fail replacement insertion in this disposable database: consumption must roll back.
    const rollback = await login();
    const rollbackSid = claims(rollback.body.data.token).sid;
    await db.execute(sql.raw(`CREATE FUNCTION fail_test_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id = '${rollbackSid}'::uuid THEN RAISE EXCEPTION 'injected rotation failure'; END IF; RETURN NEW; END $$`));
    await db.execute(sql.raw("CREATE TRIGGER fail_test_rotation BEFORE INSERT ON account_refresh_tokens FOR EACH ROW EXECUTE FUNCTION fail_test_rotation()"));
    assert.equal((await refresh(rollback.cookie)).status, 500);
    assert.equal((await db.select().from(schema.accountRefreshTokenTable).where(eq(schema.accountRefreshTokenTable.sessionId, rollbackSid)))[0].usedAt, null);
    await db.execute(sql.raw("DROP TRIGGER fail_test_rotation ON account_refresh_tokens"));
    await db.execute(sql.raw("DROP FUNCTION fail_test_rotation()"));
    assert.equal((await refresh(rollback.cookie)).status, 200);

    // Idle admin SSE must close after cross-process logout, without any new chat writes.
    const logged = await login();
    const abort = new AbortController(); controllers.push(abort);
    const stream = await fetch(base + "/api/admin/chatroom/events", { signal: abort.signal, headers: { Authorization: `Bearer ${logged.body.data.token}` } });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /stream.ready/);
    assert.equal((await request("/logout", { cookie: logged.cookie, host: other })).status, 200);
    const timer = setTimeout(() => abort.abort(), 5000);
    let frames = "";
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; frames += new TextDecoder().decode(chunk.value); } }
    finally { clearTimeout(timer); abort.abort(); }
    assert.match(frames, /auth_expired/);
    assert.equal((await me(logged.body.data.token)).status, 401);
    assert.equal((await refresh(logged.cookie)).status, 403);
    assert.equal((await request("/logout", { cookie: logged.cookie })).status, 200);
    assert.equal((await request("/logout")).status, 200);
    const bearerLogout = await login();
    assert.equal((await request("/logout", { token: bearerLogout.body.data.token })).status, 200);
    assert.equal((await refresh(bearerLogout.cookie)).status, 403);

    // Session expiry caps access even if a JWT's own expiry is still in the future.
    const expiry = await login(), expirySid = claims(expiry.body.data.token).sid;
    await db.update(schema.accountSessionTable).set({ createdAt: new Date(Date.now() - 40 * 86400_000), expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.accountSessionTable.id, expirySid));
    assert.equal((await me(expiry.body.data.token)).status, 401);
    assert.equal((await refresh(expiry.cookie)).status, 403);
    assert.equal((await cleanupAccountSessions()).deleted, 0);
    await db.update(schema.accountSessionTable).set({ expiresAt: new Date(Date.now() - 8 * 86400_000) }).where(eq(schema.accountSessionTable.id, expirySid));
    assert.equal((await cleanupAccountSessions()).deleted, 1);
    assert.equal((await db.select().from(schema.accountRefreshTokenTable).where(eq(schema.accountRefreshTokenTable.sessionId, expirySid))).length, 0);
    assert.ok((await db.select().from(schema.accountRefreshTokenTable).where(eq(schema.accountRefreshTokenTable.sessionId, decoded.sid))).length > 0);

    // Password reset atomically invalidates every login, including independent devices.
    const pending = (await issuePasswordReset(email))!;
    await consumePasswordReset(pending.token, "Changed-password-456!");
    assert.equal((await me(independent.body.data.token)).status, 401);
    assert.equal((await refresh(independent.cookie, other)).status, 403);
    await assert.rejects(() => createAccountSession(id, 0), /Credentials changed/);
    const current = await request("/login", { body: { email, password: "Changed-password-456!" } });
    assert.equal(current.status, 200);
    assert.equal((await me(current.body.data.token)).status, 200);
    const change = await request("/change-password", { method: "PUT", token: current.body.data.token, body: { id, oldPassword: "Changed-password-456!", newPassword: "Next-password-789!" } });
    assert.equal(change.status, 200);
    assert.equal((await me(current.body.data.token)).status, 401);
    assert.equal((await refresh(current.cookie)).status, 403);
    console.log("Refresh rotation: cross-process replay/races, rollback, token separation, logout/SSE, session expiry/cleanup and password revocation passed.");
  } finally {
    controllers.forEach((controller) => controller.abort());
    const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.send("stop"); await stopped;
    server.closeAllConnections(); server.close(); await client.end();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
