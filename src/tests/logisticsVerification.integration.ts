import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { sql } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import ecpay from "../services/ecpay";
import { logisticsVerificationClient } from "../services/logisticsVerification";
import { createLogisticsVerificationLimit } from "../lib/logisticsVerificationLimit";
import { fixtureToken } from "./accountSessionFixture";
import { swaggerSpec } from "../lib/swagger";

async function run() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const originalAdapter = logisticsVerificationClient.defaults.adapter;
  const originalHost = process.env.HOST;
  process.env.HOST = "https://api.example.test";
  const payload = { type: "C2C", ReceiverName: "王小明", ReceiverCellPhone: "0912345678", ReceiverEmail: "buyer@example.test" };
  let providerCalls = 0;
  const trades: string[] = [];
  let respond: (config: InternalAxiosRequestConfig) => Promise<string> | string = (config) => successResponse(config);

  function successResponse(config: InternalAxiosRequestConfig, overrides: Record<string, string> = {}, missing?: string) {
    const input = Object.fromEntries(new URLSearchParams(config.data));
    const fields: Record<string, string> = {
      MerchantID: input.MerchantID, MerchantTradeNo: input.MerchantTradeNo,
      RtnCode: "300", RtnMsg: "訂單處理中(綠界已收到訂單資料)", AllPayLogisticsID: "12345678",
      LogisticsType: input.LogisticsType, LogisticsSubType: input.LogisticsSubType,
      GoodsAmount: input.GoodsAmount, ReceiverName: input.ReceiverName,
      ReceiverCellPhone: input.ReceiverCellPhone, ReceiverEmail: input.ReceiverEmail,
      ...overrides,
    };
    if (missing) delete fields[missing];
    const b2c = input.LogisticsSubType === "UNIMART";
    const mac = ecpay.generateCheckValue(fields, ecpay.getTestLogisticHashKey(false, b2c), ecpay.getTestLogisticHashIV(false, b2c), "md5");
    return `1|${new URLSearchParams({ ...fields, CheckMacValue: mac })}`;
  }
  logisticsVerificationClient.defaults.adapter = async (config) => {
    providerCalls++;
    assert.equal(config.url, "https://logistics-stage.ecpay.com.tw/Express/Create");
    assert.equal(config.timeout, 20_000);
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.httpsAgent.options.rejectUnauthorized, true);
    assert.ok(config.signal);
    assert.equal(config.maxContentLength, 32768);
    const fields = Object.fromEntries(new URLSearchParams(config.data));
    trades.push(fields.MerchantTradeNo);
    assert.ok(/^[a-z0-9]{19}$/i.test(fields.MerchantTradeNo));
    assert.ok(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(fields.MerchantTradeDate));
    assert.equal(fields.ReceiverStoreID, "131386");
    assert.equal(fields.GoodsAmount, "300");
    assert.equal(fields.IsCollection, "N");
    assert.equal(fields.ServerReplyURL, "https://api.example.test/api/ecpay/express/test/validation/server-reply");
    assert.equal(fields.ClientReplyURL, undefined);
    assert.equal(fields.MerchantID, fields.LogisticsSubType === "UNIMART" ? "2000132" : "2000933");
    assert.ok(ecpay.validateCheckMacValue(fields, {
      hashKey: ecpay.getTestLogisticHashKey(false, fields.LogisticsSubType === "UNIMART"),
      hashIV: ecpay.getTestLogisticHashIV(false, fields.LogisticsSubType === "UNIMART"), algorithm: "md5",
    }));
    return { config, status: 200, statusText: "OK", headers: {}, data: await respond(config) };
  };
  async function newBuyer() {
    const [user] = await db.insert(s.userTable).values({
      email: `${randomUUID()}@example.test`, oauthProvider: "other", oauthId: randomUUID(), referralCode: randomUUID(),
    }).returning();
    return user.id;
  }
  async function request(body: unknown = payload, id?: string | null, suffix = "") {
    const userId = id === undefined ? await newBuyer() : id;
    const r = await fetch(base + "/api/ecpay/express/test/validate" + suffix, {
      method: "POST", headers: { "content-type": "application/json",
        ...(userId ? { authorization: `Bearer ${await fixtureToken({ id: userId })}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() as any, retryAfter: r.headers.get("retry-after") };
  }
  try {
    // Official ECPay MD5 example, independent of the mock response builder.
    assert.equal(ecpay.generateCheckValue({
      MerchantID: "2000933", MerchantTradeNo: "A20130312153023", MerchantTradeDate: "2013/03/12 15:30:23",
      LogisticsType: "CVS", LogisticsSubType: "FAMIC2C", GoodsAmount: "1000", IsCollection: "N",
      ServerReplyURL: "https://www.ecpay.com.tw/ServerReplyURL", SenderName: "寄件者姓名",
      ReceiverName: "收件者姓名", ReceiverStoreID: "001779",
    }, ecpay.getTestLogisticHashKey(false, false), ecpay.getTestLogisticHashIV(false, false), "md5"),
    "692FD6E2CDB539CCDB7206C76DC239AD");
    for (const type of ["C2C", "B2C", undefined]) {
      const result = await request({ ...payload, type });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.success, true);
      assert.equal(result.body.data.success, true);
      assert.equal(result.body.data.code, "VALIDATED");
      assert.equal(result.body.data.providerCode, "300");
      assert.match(result.body.data.verificationId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(Object.keys(result.body.data).sort(), ["verificationId", "success", "code", "message", "providerCode"].sort());
    }
    const initialCalls = providerCalls;
    assert.equal((await request(payload, null)).status, 401);
    assert.equal((await request(payload, randomUUID())).status, 401);
    const [seller] = await db.insert(s.accountTable).values({
      role: "seller", email: `${randomUUID()}@example.test`, password: "unused", profileCompletedAt: new Date(), emailVerifiedAt: new Date(),
    }).returning();
    assert.equal((await request(payload, seller.id)).status, 403);
    for (const body of [
      {}, { ...payload, type: "HOME" }, { ...payload, realAccount: true },
      { ...payload, ReceiverStoreID: "123456" }, { ...payload, userId: randomUUID() },
      { ...payload, callbackUrl: "https://attacker.example" },
      { ...payload, ReceiverName: "    " }, { ...payload, ReceiverName: "王" },
      { ...payload, ReceiverName: "王小明1" }, { ...payload, ReceiverName: "王😀" },
      { ...payload, ReceiverName: "<script>" }, { ...payload, ReceiverName: "王\n小明" },
      { ...payload, ReceiverCellPhone: "123" }, { ...payload, ReceiverEmail: "bad" },
      { ...payload, ReceiverEmail: "a".repeat(45) + "@example.test" },
    ]) assert.equal((await request(body)).status, 400);
    assert.equal((await request(payload, undefined, "?realAccount=true")).status, 400);
    assert.equal(providerCalls, initialCalls);

    respond = () => "0|Error containing secret receiver@example.test";
    const rejected = await request();
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.success, false);
    assert.equal(rejected.body.data.code, "PROVIDER_REJECTED");
    assert.equal(rejected.body.data.providerCode, null);
    assert.ok(!JSON.stringify(rejected).includes("secret"));
    for (const raw of ["", "0|", "1|OK", "<html>Success</html>", "{\"success\":true}", "x".repeat(32769)]) {
      respond = () => raw;
      const result = await request();
      assert.equal(result.status, 502, raw.slice(0, 30));
      assert.equal(result.body.code, "LOGISTICS_VERIFICATION_INVALID_RESPONSE");
    }
    const mismatches: Record<string, string>[] = [
      { MerchantTradeNo: "another" }, { MerchantID: "999" }, { LogisticsSubType: "FAMIC2C" },
      { LogisticsType: "HOME" }, { GoodsAmount: "999" }, { ReceiverName: "另一個人" },
      { ReceiverEmail: "someone@example.test" }, { ReceiverCellPhone: "0999999999" },
      { AllPayLogisticsID: "" }, { RtnCode: "1" }, { RtnCode: "99999" },
    ];
    for (const overrides of mismatches) {
      respond = (config) => successResponse(config, overrides);
      assert.equal((await request()).status, 502);
    }
    for (const field of ["CheckMacValue", "MerchantTradeNo", "ReceiverEmail", "RtnCode", "AllPayLogisticsID"]) {
      respond = (config) => field === "CheckMacValue"
        ? successResponse(config).replace(/&CheckMacValue=[^&]+/, "") : successResponse(config, {}, field);
      assert.equal((await request()).status, 502);
    }
    for (const change of [
      (raw: string) => raw.replace(/CheckMacValue=[^&]+/, "CheckMacValue=" + "0".repeat(32)),
      (raw: string) => raw + "&RtnCode=300",
      (raw: string) => raw + "&bad=%ZZ",
    ]) {
      respond = (config) => change(successResponse(config));
      assert.equal((await request()).status, 502);
    }
    for (const code of ["ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED", "ECONNRESET", "ERR_BAD_RESPONSE"]) {
      respond = (config) => { throw new AxiosError("secret provider diagnostics", code, config); };
      const result = await request();
      assert.equal(result.status, ["ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED"].includes(code) ? 504 : 502);
      assert.ok(!JSON.stringify(result).includes("secret"));
      assert.equal(result.body.success, false);
    }
    const beforeMisconfigured = providerCalls;
    process.env.HOST = "invalid";
    assert.equal((await request()).status, 503);
    assert.equal(providerCalls, beforeMisconfigured);
    process.env.HOST = "https://api.example.test";

    // Single-flight per user; no callback can unblock a pending direct request.
    let unblock!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    respond = async (config) => { entered(); await new Promise<string>((resolve) => { unblock = resolve; }); return successResponse(config); };
    const buyer = await newBuyer();
    const pending = request(payload, buyer);
    await started;
    const limited = await request(payload, buyer);
    assert.equal(limited.status, 429);
    assert.equal(limited.retryAfter, "60");
    const callback = await fetch(base + "/api/ecpay/express/test/validation/server-reply", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ success: true, RtnCode: "300" }),
    });
    assert.equal(await callback.text(), "1|OK");
    unblock("");
    assert.equal((await pending).status, 200);
    respond = (config) => successResponse(config);
    for (let i = 0; i < 4; i++) assert.equal((await request(payload, buyer)).status, 200);
    assert.equal((await request(payload, buyer)).status, 429);
    assert.equal(new Set(trades).size, trades.length); // No silent retries/reused provider trade IDs.

    // Limits are bounded, release on failure/finish, and expire without background jobs.
    let time = 0;
    const acquire = createLogisticsVerificationLimit(() => time);
    for (let i = 0; i < 5; i++) acquire("buyer")();
    assert.throws(() => acquire("buyer"), /頻繁/);
    time = 60001;
    acquire("buyer")();
    const releases = Array.from({ length: 20 }, (_, i) => acquire(`user${i}`));
    assert.throws(() => acquire("overflow"), /頻繁/);
    releases.forEach((release) => { release(); release(); });
    acquire("after")();
    for (const table of [s.orderTable, s.deliveryTable, s.merchantTradeTable, s.idempotencyKeyTable]) {
      assert.equal((await db.select({ total: sql<number>`count(*)::int` }).from(table))[0].total, 0);
    }
    assert.equal((swaggerSpec as any).paths["/api/ecpay/express/test/validate"], undefined);
    console.log("Logistics verification: sandbox request, signed correlation, fail-closed errors, auth, limits and no business writes passed. No live ECPay requests sent.");
  } finally {
    logisticsVerificationClient.defaults.adapter = originalAdapter;
    if (originalHost === undefined) delete process.env.HOST; else process.env.HOST = originalHost;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await client.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
