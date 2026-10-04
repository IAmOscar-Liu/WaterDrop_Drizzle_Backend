import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import * as s from "../db/schema";
import db, { client } from "../lib/initDB";
import { generateToken } from "../lib/token";
import { spendAdBalanceWithTx, transferArchivedAdvertisementBalance } from "../repository/advertisement";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  try {
    const [seller, other, admin, employee] = await db.insert(s.accountTable).values(
      (["seller", "seller", "admin", "employee"] as const).map((role) => ({ role, email: `${randomUUID()}@example.test`, password: "unused", realName: "Withdrawal fixture", phone: "0900000000" })),
    ).returning();
    await db.insert(s.accountWalletTable).values({ accountId: seller.id, walletBalance: "200.00", totalRevenueCash: "123.00" });
    const [product] = await db.insert(s.productTable).values({ sellerId: seller.id, name: "Withdrawal fixture", description: "Test" }).returning();
    const [ad] = await db.insert(s.advertisementTable).values({ productId: product.id, title: "Closed fixture", video_url: "https://example.test/a", archivedAt: new Date("2026-01-01Z"), financiallyClosedAt: new Date("2026-01-03Z") }).returning();
    await db.insert(s.advertisementStatsTable).values({ advertisementId: ad.id, balance: 1000, status: "archived" });
    await db.insert(s.advertisementCoinFundingAccountTable).values({ advertisementId: ad.id, sourceSellerId: seller.id, status: "closed" });
    const path = `/advertisement/${ad.id}/budget-withdrawal`;
    async function request(route: string, actor = seller.id, method = "GET", body?: unknown) {
      const r = await fetch(base + route, { method, headers: { authorization: `Bearer ${generateToken({ id: actor })}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() as any };
    }
    function expect(r: Awaited<ReturnType<typeof request>>, status = 200, code?: string) {
      assert.equal(r.status, status, JSON.stringify(r.body));
      if (code) assert.equal(r.body.code, code);
      return r.body.data;
    }
    const preview = () => request(path + "-preview");
    const payload = (p: any, extra = {}) => ({ mode: "all", expectedBalance: p.balance, confirmationToken: p.confirmationToken, idempotencyKey: randomUUID(), ...extra });
    expect(await request(path + "-preview", other.id), 403);
    expect(await request(path + "-preview", employee.id), 403);
    let p = expect(await preview());
    assert.equal(p.balance, "1000.00"); assert.equal(p.eligible, true);
    expect(await request(path, seller.id, "POST", payload(p, { amount: "1.00" })), 400);
    expect(await request(path, seller.id, "POST", payload(p, { mode: "amount", amount: "1.001" })), 400);
    expect(await request(path, other.id, "POST", payload(p)), 403, "WITHDRAWAL_FORBIDDEN");
    expect(await request(path, seller.id, "POST", payload(p, { mode: "amount", amount: "1000.01" })), 409, "INSUFFICIENT_AD_BALANCE");
    const partial = payload(p, { mode: "amount", amount: "300.00" });
    const r = expect(await request(path, seller.id, "POST", partial));
    assert.equal(r.withdrawnAmount, "300.00"); assert.equal(r.advertisementBalanceAfter, "700.00"); assert.equal(r.walletBalanceAfter, "500.00");
    assert.deepEqual(expect(await request(path, seller.id, "POST", partial)), { ...r, idempotentReplay: true });
    expect(await request(path, seller.id, "POST", { ...partial, amount: "301.00" }), 409, "IDEMPOTENCY_CONFLICT");
    expect(await request(path, seller.id, "POST", payload(p)), 409, "BALANCE_CHANGED");
    expect(await request(path, admin.id, "POST", partial), 409, "IDEMPOTENCY_CONFLICT");
    const summary = expect(await request("/account-wallet/me/summary"));
    assert.equal(summary.advertisementBudgetReturns, "300.00");
    const transactions = expect(await request("/account-wallet/me/transactions?type=advertisement_budget_return"));
    assert.equal(transactions.transactions[0].id, r.walletTransactionId);
    const wallet = await db.query.accountWalletTable.findFirst({ where: eq(s.accountWalletTable.accountId, seller.id) });
    assert.equal(wallet!.totalRevenueCash, "123.00");
    const metrics = expect(await request(`/advertisement/metrics?productId=${product.id}`));
    assert.equal(metrics.advertisements[0].budgetWithdrawnAmount, "300.00");
    assert.equal(metrics.advertisements[0].grossViewSpend, 0);
    // A balance round trip invalidates confirmation even when the displayed balance matches.
    p = expect(await preview());
    await db.insert(s.advertisementTransactionTable).values([
      { advertisementId: ad.id, amount: -1, type: "manual_adjustment" },
      { advertisementId: ad.id, amount: 1, type: "manual_adjustment" },
    ]);
    expect(await request(path, seller.id, "POST", payload(p)), 409, "BALANCE_CHANGED");
    // Force failure after wallet and ad updates, during the second ledger write.
    await db.execute(sql`create function reject_test_withdrawal() returns trigger language plpgsql as $$ begin if NEW.type = 'budget_withdrawal' then raise exception 'forced withdrawal rollback'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger reject_test_withdrawal before insert on advertisement_transactions for each row execute function reject_test_withdrawal()`);
    p = expect(await preview()); const failed = payload(p);
    expect(await request(path, seller.id, "POST", failed), 500);
    assert.equal(expect(await preview()).balance, "700.00");
    assert.equal((await db.query.accountWalletTable.findFirst({ where: eq(s.accountWalletTable.accountId, seller.id) }))!.walletBalance, "500.00");
    await db.execute(sql`drop trigger reject_test_withdrawal on advertisement_transactions`);
    await db.execute(sql`drop function reject_test_withdrawal()`);
    // Same-key concurrent submissions credit once and replay the saved original response.
    const same = payload(p, { mode: "amount", amount: "0.01" });
    const sameResults = await Promise.all([request(path, seller.id, "POST", same), request(path, seller.id, "POST", same)]);
    sameResults.forEach((v) => expect(v));
    assert.equal(sameResults.filter((v) => v.body.data.idempotentReplay).length, 1);
    assert.equal(expect(await preview()).balance, "699.99");
    const adminPreview = expect(await request(path + "-preview", admin.id));
    const adminWithdrawal = expect(await request(path, admin.id, "POST", payload(adminPreview, { mode: "amount", amount: "0.01" })));
    assert.equal(adminWithdrawal.withdrawnAmount, "0.01");
    // New return constraints reject a wrong sign and missing ad/actor references.
    for (const invalid of [
      { amount: "-1.00", balanceAfter: "9.00" },
      { advertisementId: null },
      { actorAccountId: null },
    ]) {
      await assert.rejects(db.insert(s.accountWalletTransactionTable).values({
        walletId: wallet!.id, accountId: seller.id, actorAccountId: admin.id, advertisementId: ad.id,
        type: "advertisement_budget_return", amount: "1.00", balanceBefore: "10.00", balanceAfter: "11.00", idempotencyKey: randomUUID(), ...invalid,
      }), (error: any) => error.cause?.code === "23514");
    }
    // Two tabs using different keys cannot withdraw the same preview twice.
    p = expect(await preview());
    const concurrent = await Promise.all([request(path, seller.id, "POST", payload(p)), request(path, seller.id, "POST", payload(p))]);
    assert.deepEqual(concurrent.map((v) => v.status).sort(), [200, 409]);
    assert.equal(expect(await preview()).balance, "0.00");
    assert.equal(expect(await preview()).reasons[0].code, "ZERO_BALANCE");
    expect(await request(path, seller.id, "POST", payload(expect(await preview()))), 409, "ZERO_BALANCE");
    assert.deepEqual(expect(await request(path, seller.id, "POST", partial)), { ...r, idempotentReplay: true });
    // Late settlement return is withdrawable; retries of earlier withdrawals stay unchanged.
    await db.transaction(async (tx) => {
      await tx.update(s.advertisementStatsTable).set({ balance: 100 }).where(eq(s.advertisementStatsTable.advertisementId, ad.id));
      await tx.insert(s.advertisementTransactionTable).values({ advertisementId: ad.id, amount: 100, type: "seller_return_credit" });
    });
    const [replacement] = await db.insert(s.advertisementTable).values({ productId: product.id, title: "Replacement", video_url: "https://example.test/b", replacementOfAdvertisementId: ad.id }).returning();
    await db.insert(s.advertisementStatsTable).values({ advertisementId: replacement.id, status: "paused" });
    p = expect(await preview());
    const raced = await Promise.allSettled([
      request(path, seller.id, "POST", payload(p)),
      transferArchivedAdvertisementBalance({ sourceAdvertisementId: ad.id, destinationAdvertisementId: replacement.id, requesterId: seller.id, amount: 100, idempotencyKey: randomUUID() }),
    ]);
    const [sourceStats] = await db.select().from(s.advertisementStatsTable).where(eq(s.advertisementStatsTable.advertisementId, ad.id));
    assert.equal(sourceStats.balance, 0);
    const replacementStats = await db.query.advertisementStatsTable.findFirst({ where: eq(s.advertisementStatsTable.advertisementId, replacement.id) });
    const finalWallet = await db.query.accountWalletTable.findFirst({ where: eq(s.accountWalletTable.accountId, seller.id) });
    assert.equal(Number(finalWallet!.walletBalance) + replacementStats!.balance, 1300);
    assert.equal(raced.length, 2);
    await assert.rejects(db.transaction((tx) => spendAdBalanceWithTx(tx, { advertisementId: ad.id, amount: 1, allowInactive: true })), /closed/);
    // Closure and funding obligations are checked independently of a valid preview token.
    await db.update(s.advertisementTable).set({ financiallyClosedAt: null }).where(eq(s.advertisementTable.id, ad.id));
    p = expect(await preview());
    expect(await request(path, seller.id, "POST", payload(p)), 409, "ADVERTISEMENT_NOT_FINANCIALLY_CLOSED");
    await db.update(s.advertisementTable).set({ financiallyClosedAt: new Date() }).where(eq(s.advertisementTable.id, ad.id));
    await db.update(s.advertisementCoinFundingAccountTable).set({ status: "closing" }).where(eq(s.advertisementCoinFundingAccountTable.advertisementId, ad.id));
    p = expect(await preview());
    expect(await request(path, seller.id, "POST", payload(p)), 409, "WITHDRAWAL_BLOCKED");
    // Internal reports: Taipei midnight boundary and exact recorded decimals.
    const users = await db.insert(s.userTable).values(["2025-01-01T15:59:59.999Z", "2025-01-01T16:00:00Z", "2025-01-02T16:00:00Z"].map((createdAt) => ({ email: `${randomUUID()}@example.test`, oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID(), createdAt: new Date(createdAt) }))).returning();
    await db.insert(s.advertisementTransactionTable).values([
      { advertisementId: ad.id, type: "wallet_funding", amount: 10.01, createdAt: new Date("2025-01-01T16:00:00Z") },
      { advertisementId: ad.id, type: "balance_transfer_in", amount: 500, createdAt: new Date("2025-01-01T16:00:00Z") },
      { advertisementId: ad.id, type: "deposit", amount: 99, createdAt: new Date("2025-01-01T16:00:00Z") },
      { advertisementId: ad.id, type: "wallet_funding", amount: 20, createdAt: new Date("2025-01-02T16:00:00Z") },
    ]);
    const query = "startDate=2025-01-02&endDate=2025-01-02";
    // Separate contracts: no report selector, no silent fallback to operational totals.
    expect(await request(`/dashboard/kpi?report=internal&${query}`, admin.id), 400);
    expect(await request(`/dashboard/time-series?report=internal&${query}&dataset=users`, admin.id), 400);
    expect(await request(`/dashboard/kpi?${query}`, admin.id), 400);
    expect(await request(`/dashboard/time-series?metric=orders&${query}`, admin.id), 400);
    expect(await request(`/dashboard/kpi/internal?report=internal&${query}`, admin.id), 400);
    expect(await request(`/dashboard/kpi/internal?${query}&startAt=2025-01-01T00:00:00Z`, admin.id), 400);
    expect(await request(`/dashboard/kpi/internal?${query}&endAt=2025-01-03T00:00:00Z`, admin.id), 400);
    expect(await request("/dashboard/kpi/internal?startDate=2025-01-02", admin.id), 400);
    expect(await request(`/dashboard/time-series/internal?${query}`, admin.id), 400);
    expect(await request(`/dashboard/time-series/internal?${query}&dataset=users&metric=orders`, admin.id), 400);
    const operational = expect(await request("/dashboard/kpi", seller.id));
    assert.equal(operational.ratio, undefined);

    expect(await request(`/dashboard/kpi/internal?${query}`, seller.id), 403);
    expect(await request(`/dashboard/time-series/internal?${query}&dataset=users`, employee.id), 403);
    expect(await request(`/dashboard/kpi/internal?${query}&sellerId=${seller.id}`, admin.id), 400);
    expect(await request("/dashboard/kpi/internal?startDate=2025-02-30&endDate=2025-03-01", admin.id), 400);
    expect(await request("/dashboard/kpi/internal?startDate=2024-01-01&endDate=2025-01-02", admin.id), 400);
    const kpi = expect(await request(`/dashboard/kpi/internal?${query}`, admin.id));
    assert.equal(kpi.users.periodRegistrations.value, "1");
    assert.equal(kpi.advertisements.period.fundingInflows.value, "10.01");
    assert.equal(kpi.advertisements.period.legacyDeposits.value, "99.00");
    assert.equal(kpi.advertisements.period.transfersIn.value, "500.00");
    const daily = expect(await request(`/dashboard/time-series/internal?${query}&dataset=users`, admin.id));
    assert.equal(daily.points[0].metrics.registrations.value, "1");
    const empty = expect(await request("/dashboard/time-series/internal?dataset=ad-finance&startDate=2020-01-01&endDate=2020-01-02", admin.id));
    assert.equal(empty.points[0].metrics.fundingInflows.value, null);
    assert.equal(empty.historicalStocks.value, null);
    await db.insert(s.userCoinTransactionTable).values([
      { userId: users[0].id, type: "acquire", direction: "credit", amount: "1.23", idempotencyKey: randomUUID(), createdAt: new Date("2025-01-01T16:00:00Z") },
      { userId: users[0].id, type: "acquire", direction: "credit", amount: "99.00", idempotencyKey: "legacy_unattributed_user_balances_v1:" + randomUUID(), createdAt: new Date("2025-01-01T16:00:00Z") },
      { userId: users[0].id, type: "manual", direction: "credit", amount: "88.00", idempotencyKey: randomUUID(), metadata: { source: "legacy_balance_backfill" }, createdAt: new Date("2025-01-01T16:00:00Z") },
      { userId: users[0].id, type: "refund", direction: "credit", amount: "4.00", idempotencyKey: randomUUID(), metadata: { creditedToUser: false }, createdAt: new Date("2025-01-01T16:00:00Z") },
      { userId: users[0].id, type: "refund", direction: "credit", amount: "5.00", idempotencyKey: randomUUID(), metadata: { creditedToUser: true }, createdAt: new Date("2025-01-01T16:00:00Z") },
    ]);
    const coinSeries = expect(await request(`/dashboard/time-series/internal?${query}&dataset=coin-flows`, admin.id));
    const flow = coinSeries.points[0].metrics;
    assert.equal(flow.acquiredCoins.value, "1.23");
    assert.equal(flow.manualNetCoins.value, "0.00");
    assert.equal(flow.refundedCoins.value, "5.00");
    assert.equal(flow.expiredRefundCoins.value, "4.00");
    assert.equal(flow.spentCoins.value, null);
    // Batch volume and leap-year date filling; no per-user or per-day requests.
    await db.execute(sql`insert into users (email, oauth_provider, oauth_id, referral_code, created_at)
      select 'bulk-' || n || '@example.test', 'other', 'bulk-' || n, 'bulk-' || n, '2024-01-01T00:00:00Z'::timestamptz from generate_series(1,10000) n`);
    const batch = expect(await request("/dashboard/time-series/internal?dataset=users&startDate=2024-01-01&endDate=2024-12-31", admin.id));
    assert.equal(batch.points.length, 366);
    assert.equal(batch.points[0].metrics.registrations.value, "10000");
    assert.equal(batch.points[365].metrics.registrations.value, "0");
    // Expired-but-not-processed coins and boxes are excluded from the economic pool.
    await db.update(s.userTable).set({ coins: 30 }).where(eq(s.userTable.id, users[0].id));
    await db.insert(s.userCoinLotTable).values([
      { userId: users[0].id, currentFunderType: "platform", originalAmount: "25", availableAmount: "20", reservedAmount: "5", timezoneSnapshot: "Asia/Taipei", earningLocalMonth: "2026-10", expiresAt: new Date(Date.now()+86400000) },
      { userId: users[0].id, currentFunderType: "platform", originalAmount: "10", availableAmount: "10", timezoneSnapshot: "Asia/Taipei", earningLocalMonth: "2026-09", expiresAt: new Date(Date.now()-86400000) },
    ]);
    await db.insert(s.treasureBoxTable).values([
      { userId: users[0].id, coinsAwarded: 10, accountingStatus: "claimable", claimDeadlineAt: new Date(Date.now()+86400000) },
      { userId: users[0].id, coinsAwarded: 90, accountingStatus: "claimable", claimDeadlineAt: new Date(Date.now()-86400000) },
    ]);
    await db.update(s.advertisementStatsTable).set({ balance: 100 }).where(eq(s.advertisementStatsTable.advertisementId, replacement.id));
    const pool = expect(await request(`/dashboard/kpi/internal?${query}`, admin.id));
    assert.equal(pool.coins.outstandingPool.value, "35.00");
    assert.equal(pool.coins.pendingExpiry.value, "10.00");
    assert.equal(pool.ratio.value, "0.03500000");
    await db.update(s.advertisementStatsTable).set({ balance: 0 });
    const zero = expect(await request(`/dashboard/kpi/internal?${query}`, admin.id));
    assert.equal(zero.ratio.value, null); assert.equal(zero.ratio.coverage.reason, "NON_POSITIVE_DENOMINATOR");
    await db.update(s.userTable).set({ coins: 31 }).where(eq(s.userTable.id, users[0].id));
    const mismatch = expect(await request(`/dashboard/kpi/internal?${query}`, admin.id));
    assert.equal(mismatch.coins.outstandingPool.value, null);
    assert.equal(mismatch.ratio.coverage.reason, "INCOMPLETE_COVERAGE");
    await db.update(s.accountTable).set({ status: "inactive" }).where(eq(s.accountTable.id, admin.id));
    expect(await request(`/dashboard/kpi/internal?${query}`, admin.id), 403);
    expect(await request(path + "-preview", admin.id), 403);
    console.log("BE1001 withdrawal and internal statistics integration passed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await client.end();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
