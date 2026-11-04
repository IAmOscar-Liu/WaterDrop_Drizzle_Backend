import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mock } from "node:test";
import axios from "axios";
import { eq } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { creditManualUserCoins, expireUserCoinLots } from "../repository/coinLedger";
import { createOrder, expirePaymentProcessingOrders } from "../repository/order";
import { preparePayment } from "../repository/payment";
import { reconcileRecordedPayments } from "../services/payment";
import ecpay from "../services/ecpay";

async function run() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const [buyer, stranger] = await db.insert(s.userTable).values([1, 2].map(() => ({ email: `${randomUUID()}@example.test`,
      oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID(), timezone: "Asia/Taipei" }))).returning();
    const [seller] = await db.insert(s.accountTable).values({ role: "seller", email: `${randomUUID()}@example.test`,
      password: "unused", profileCompletedAt: new Date(), emailVerifiedAt: new Date() }).returning();
    const [product] = await db.insert(s.productTable).values({ sellerId: seller.id, type: "virtual", name: "Payment safety", description: "Fixture" }).returning();
    const [variant] = await db.insert(s.productVariantTable).values({ productId: product.id, price: 100, stock: 100 }).returning();
    async function order(discount = 50, method: "Credit" | "ATM" = "Credit") {
      const key = randomUUID();
      const result = await createOrder({ orderData: { userId: buyer.id, subTotal: 100, totalAmount: 100 - discount / 10,
        discountCoin: discount, orderPayment: method }, items: [{ productId: product.id, productVariantId: variant.id,
        quantity: 1, unitPriceAtSale: 100, productNameAtSale: product.name }], idempotencyKey: key });
      assert.ok(result);
      return { order: result, key };
    }
    const token = await fixtureToken({ id: buyer.id });
    async function checkout(f: Awaited<ReturnType<typeof order>>, overrides: Record<string, string> = {}) {
      return fetch(base + "/api/ecpay/new?" + new URLSearchParams({ token, orderId: f.order.id, idempotencyKey: f.key,
        totalAmount: String(f.order.totalAmount), tradeDesc: "Payment test", itemName: "Test", ChoosePayment: f.order.orderPayment, ...overrides }));
    }
    async function callback(attempt: s.OrderPaymentAttempt, overrides: Record<string, string> = {}, path = "/api/ecpay/return") {
      const data = { MerchantID: process.env.MERCHANTID!, MerchantTradeNo: attempt.merchantTradeNo,
        RtnCode: "1", TradeAmt: String(attempt.amount), TradeNo: `T${attempt.merchantTradeNo}`, SimulatePaid: "0",
        CustomField1: attempt.orderId, CustomField2: attempt.idempotencyKey, ...overrides };
      const CheckMacValue = ecpay.generateCheckValue(data, process.env.HASHKEY!, process.env.HASHIV!);
      return fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...data, CheckMacValue }) });
    }
    const readOrder = async (id: string) => (await db.query.orderTable.findFirst({ where: eq(s.orderTable.id, id) }))!;
    const readAttempt = async (id: string) => (await db.query.orderPaymentAttemptTable.findFirst({ where: eq(s.orderPaymentAttemptTable.orderId, id) }))!;
    const staleCredit = await creditManualUserCoins({ userId: buyer.id, amount: 100, reason: "Expired fixture", idempotencyKey: randomUUID() });
    await db.update(s.userCoinLotTable).set({ expiresAt: new Date(Date.now() - 60000) }).where(eq(s.userCoinLotTable.id, staleCredit.lot.id));
    const f = await order();
    const insufficient = await checkout(f);
    assert.equal(insufficient.status, 409);
    assert.equal((await insufficient.json() as any).code, "INSUFFICIENT_SPENDABLE_COINS");
    assert.equal((await readOrder(f.order.id)).orderStatus, "pending");
    assert.equal(await readAttempt(f.order.id), undefined, "No payable form/attempt for expired coins");
    assert.equal((await db.select().from(s.userTable).where(eq(s.userTable.id, buyer.id)))[0].coins, 100, "Stale balance is not spendability");
    await creditManualUserCoins({ userId: buyer.id, amount: 300, reason: "Fresh fixture", idempotencyKey: randomUUID() });
    assert.equal((await checkout(f, { totalAmount: "1" })).status, 400);
    assert.equal((await checkout(f, { token: await fixtureToken({ id: stranger.id }) })).status, 404);
    const other = await order();
    assert.equal((await checkout(f, { idempotencyKey: other.key })).status, 403);
    await db.update(s.productVariantTable).set({ price: 101 }).where(eq(s.productVariantTable.id, variant.id));
    assert.equal((await checkout(f)).status, 409);
    await db.update(s.productVariantTable).set({ price: 100 }).where(eq(s.productVariantTable.id, variant.id));
    await db.update(s.productTable).set({ status: "inactive" }).where(eq(s.productTable.id, product.id));
    assert.equal((await checkout(f)).status, 409);
    await db.update(s.productTable).set({ status: "active" }).where(eq(s.productTable.id, product.id));
    const html = await checkout(f);
    assert.equal(html.status, 200);
    const attempt = await readAttempt(f.order.id);
    assert.ok((await html.text()).includes(attempt.merchantTradeNo));
    assert.equal((await readOrder(f.order.id)).orderStatus, "payment-processing");
    const allocations = await db.query.orderCoinAllocationTable.findMany({ where: eq(s.orderCoinAllocationTable.orderId, f.order.id) });
    assert.equal(allocations.reduce((sum, a) => sum + Number(a.reservedAmount), 0), 50);
    assert.equal((await checkout(f)).status, 200);
    assert.equal((await readAttempt(f.order.id)).id, attempt.id, "Reloading checkout cannot create another charge attempt");
    // Client APIs cannot manufacture success or cancel another buyer's order.
    const forged = await fetch(`${base}/api/order/${f.order.id}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ status: "paid" }) });
    assert.equal(forged.status, 400);
    const cancelInProgress = await fetch(`${base}/api/order/${f.order.id}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ status: "canceled" }) });
    assert.equal(cancelInProgress.status, 409);
    const cancellation = await fetch(`${base}/api/order/${other.order.id}`, { method: "PUT", headers: { authorization: `Bearer ${await fixtureToken({ id: stranger.id })}`, "content-type": "application/json" }, body: JSON.stringify({ status: "canceled" }) });
    assert.equal(cancellation.status, 404);
    await db.update(s.orderTable).set({ createdAt: new Date("2020-01-01") }).where(eq(s.orderTable.id, f.order.id));
    await expirePaymentProcessingOrders();
    assert.equal((await readOrder(f.order.id)).orderStatus, "payment-processing", "Uncertain provider payments must retain their reservations");
    // Coin expiry after checkout cannot invalidate reserved payment coins.
    const freshLotId = allocations[0].lotId;
    await db.update(s.userCoinLotTable).set({ expiresAt: new Date(Date.now() - 60000) }).where(eq(s.userCoinLotTable.id, freshLotId));
    await expireUserCoinLots();
    assert.equal((await callback(attempt, { TradeAmt: "1" })).status, 400);
    assert.equal((await callback(attempt, { MerchantID: "wrong" })).status, 400);
    assert.equal((await callback(attempt, { MerchantTradeNo: "wrong" })).status, 400);
    const invalidMac = await fetch(base + "/api/ecpay/return", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ CheckMacValue: "bad" }) });
    assert.equal(invalidMac.status, 400);
    const success = await callback(attempt);
    assert.equal(await success.text(), "1|OK");
    assert.equal((await readOrder(f.order.id)).orderStatus, "paid");
    const consumed = await db.query.orderCoinAllocationTable.findMany({ where: eq(s.orderCoinAllocationTable.orderId, f.order.id) });
    assert.equal(Number(consumed[0].consumedAmount), 50);
    const stock = (await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!.stock;
    await Promise.all([callback(attempt), callback(attempt)]);
    assert.equal((await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!.stock, stock);
    assert.equal((await callback(attempt, { RtnCode: "10100058" })).status, 200);
    assert.equal((await readOrder(f.order.id)).orderStatus, "paid", "Late failure cannot downgrade a paid order");

    await creditManualUserCoins({ userId: buyer.id, amount: 300, reason: "Settlement retry fixture", idempotencyKey: randomUUID() });
    const retry = await order();
    const retryAttempt = await preparePayment({ orderId: retry.order.id, userId: buyer.id, idempotencyKey: retry.key, amount: 95, method: "Credit" });
    await client.unsafe("CREATE FUNCTION fail_paid_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_status = 'paid' THEN RAISE EXCEPTION 'Simulated database failure'; END IF; RETURN NEW; END $$");
    await client.unsafe("CREATE TRIGGER fail_paid_commit BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fail_paid_commit()");
    try { assert.equal((await callback(retryAttempt)).status, 500); }
    finally { await client.unsafe("DROP TRIGGER fail_paid_commit ON orders"); await client.unsafe("DROP FUNCTION fail_paid_commit()"); }
    assert.equal((await readAttempt(retry.order.id)).state, "succeeded", "Provider success survives failed order settlement");
    assert.equal((await readOrder(retry.order.id)).orderStatus, "payment-processing");
    await reconcileRecordedPayments();
    assert.equal((await readOrder(retry.order.id)).orderStatus, "paid");
    assert.equal((await readAttempt(retry.order.id)).state, "settled");

    const atm = await order(50, "ATM");
    const atmAttempt = await preparePayment({ orderId: atm.order.id, userId: buyer.id, idempotencyKey: atm.key, amount: 95, method: "ATM" });
    assert.equal((await callback(atmAttempt, { RtnCode: "2", BankCode: "822", vAccount: "test" }, "/api/ecpay/paymentInfo")).status, 200);
    assert.equal((await readOrder(atm.order.id)).orderStatus, "payment-processing");
    assert.equal((await callback(atmAttempt)).status, 200);
    assert.equal((await readOrder(atm.order.id)).orderStatus, "paid");
    assert.equal((await callback(atmAttempt, { RtnCode: "2" }, "/api/ecpay/paymentInfo")).status, 200);
    assert.equal((await readOrder(atm.order.id)).orderStatus, "paid");
    const failed = await order();
    const failedAttempt = await preparePayment({ orderId: failed.order.id, userId: buyer.id, idempotencyKey: failed.key, amount: 95, method: "Credit" });
    assert.equal((await callback(failedAttempt, { RtnCode: "10100058" })).status, 200);
    assert.equal((await readOrder(failed.order.id)).orderStatus, "failed");
    assert.equal(Number((await db.query.orderCoinAllocationTable.findFirst({ where: eq(s.orderCoinAllocationTable.orderId, failed.order.id) }))!.reservedAmount), 0);
    // Credit availability is serialized across independent orders before either can charge.
    const currentBalance = (await db.query.userTable.findFirst({ where: eq(s.userTable.id, buyer.id) }))!.coins;
    const concurrencyCredit = await creditManualUserCoins({ userId: buyer.id, amount: 100, reason: "Concurrency", idempotencyKey: randomUUID() });
    // Isolate one fresh lot for this race; prior available coins are consumed by a prepared hold.
    const reserveExisting = await order(currentBalance);
    if (currentBalance > 0) await preparePayment({ orderId: reserveExisting.order.id, userId: buyer.id,
      idempotencyKey: reserveExisting.key, amount: reserveExisting.order.totalAmount, method: "Credit" });
    const racers = await Promise.all([order(80), order(80)]);
    const raceResults = await Promise.allSettled(racers.map(r => preparePayment({ orderId: r.order.id,
      userId: buyer.id, idempotencyKey: r.key, amount: 92, method: "Credit" })));
    assert.equal(raceResults.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(Number((await db.query.userCoinLotTable.findFirst({ where: eq(s.userCoinLotTable.id, concurrencyCredit.lot.id) }))!.availableAmount), 20);

    // Provider query responses must be signed and bound to the requested trade.
    const queryData = { MerchantID: process.env.MERCHANTID!, MerchantTradeNo: "VERIFYQUERY", TradeAmt: "100", TradeStatus: "1", TradeNo: "QUERYPROOF" };
    const queryMac = ecpay.generateCheckValue(queryData, process.env.HASHKEY!, process.env.HASHIV!);
    let queryPayload = new URLSearchParams({ ...queryData, CheckMacValue: queryMac }).toString();
    const postMock = mock.method(axios, "post", async () => ({ data: queryPayload }));
    try {
      assert.equal((await ecpay.queryPaymentTradeInfo("VERIFYQUERY")).TradeStatus, "1");
      queryPayload = new URLSearchParams({ ...queryData, TradeAmt: "1", CheckMacValue: queryMac }).toString();
      await assert.rejects(ecpay.queryPaymentTradeInfo("VERIFYQUERY"), /Untrusted/);
      queryPayload = new URLSearchParams({ ...queryData, CheckMacValue: queryMac }).toString();
      await assert.rejects(ecpay.queryPaymentTradeInfo("DIFFERENT"), /Untrusted/);
    } finally { postMock.mock.restore(); }
    const noCallback = await order(0);
    const missingAttempt = await preparePayment({ orderId: noCallback.order.id, userId: buyer.id,
      idempotencyKey: noCallback.key, amount: 100, method: "Credit" });
    await db.update(s.orderPaymentAttemptTable).set({ updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(s.orderPaymentAttemptTable.id, missingAttempt.id));
    const originalQuery = ecpay.queryPaymentTradeInfo;
    ecpay.queryPaymentTradeInfo = async merchantTradeNo => ({ MerchantID: process.env.MERCHANTID!, MerchantTradeNo: merchantTradeNo,
      TradeStatus: "1", TradeAmt: "100", TradeNo: "RECOVERED", SimulatePaid: "0" });
    try { await reconcileRecordedPayments(); } finally { ecpay.queryPaymentTradeInfo = originalQuery; }
    assert.equal((await readOrder(noCallback.order.id)).orderStatus, "paid", "A signed provider query recovers a missing callback");
    const simulated = await order(0);
    const simulatedAttempt = await preparePayment({ orderId: simulated.order.id, userId: buyer.id,
      idempotencyKey: simulated.key, amount: 100, method: "Credit" });
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "stg";
      assert.equal((await callback(simulatedAttempt, { SimulatePaid: "1" })).status, 400);
      assert.equal((await readOrder(simulated.order.id)).orderStatus, "payment-processing");
    } finally { process.env.NODE_ENV = originalEnv; }
    // An already-open pre-deployment checkout must never lose a verified charge.
    const legacy = await order(0);
    const legacyAttempt = { ...attempt, orderId: legacy.order.id, idempotencyKey: legacy.key, amount: 100,
      merchantTradeNo: `L${randomUUID().replace(/-/g, "").slice(0, 19)}` };
    assert.equal((await callback(legacyAttempt)).status, 200);
    assert.equal((await readOrder(legacy.order.id)).orderStatus, "paid");
    const legacyShort = await order(50);
    const legacyShortAttempt = { ...attempt, orderId: legacyShort.order.id, idempotencyKey: legacyShort.key, amount: 95,
      merchantTradeNo: `L${randomUUID().replace(/-/g, "").slice(0, 19)}` };
    assert.equal((await callback(legacyShortAttempt)).status, 409);
    assert.equal((await readOrder(legacyShort.order.id)).orderStatus, "payment-processing");
    assert.equal((await readAttempt(legacyShort.order.id)).state, "succeeded");
    console.log("Payment safety passed: pre-charge validation/reservations, owner/amount binding, expiry, verified callbacks, ATM, retries, late failure protection and durable recovery.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await client.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
