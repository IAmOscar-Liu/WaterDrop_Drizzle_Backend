import { logDiagnosticError } from "../lib/requestContext";
import { and, eq, inArray, asc, lte } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { getBankNameFromCode } from "../lib/general";
import { createDelivery } from "../repository/delivery";
import { recordPaymentResult, settlePayment } from "../repository/payment";
import ecpayService from "./ecpay";
import orderService from "./order";

async function completePayment(attemptId: string) {
  const result = await settlePayment(attemptId);
  if (result.replayed || !result.order || result.order.orderStatus !== "paid") return result;
  const order = result.order;
  const shipping = order.shippingInfo as { cvsPickupGroup?: Record<string, unknown>[]; nonCvsPickupGroup?: Record<string, unknown>[] } | null;
  // Payment is committed before logistics/email. Their failure must never undo payment.
  const tasks: Promise<unknown>[] = [];
  if (Array.isArray(shipping?.cvsPickupGroup)) {
    for (const info of shipping.cvsPickupGroup) tasks.push(ecpayService.createExpressServerReturn({ ...info, products: info.products as { productId: string; variantId: string }[], orderId: order.id }));
  }
  if (Array.isArray(shipping?.nonCvsPickupGroup)) {
    for (const info of shipping.nonCvsPickupGroup) {
      const { merchantTradeNo, products, ...rest } = info;
      tasks.push(createDelivery({ ...rest, orderId: order.id,
        merchantTradeNo: typeof merchantTradeNo === "string" ? merchantTradeNo : ecpayService.generateTradeNo(),
      } as schema.NewDelivery, products as { productId: string; variantId: string }[]));
    }
  }
  tasks.push(orderService.sendOrderCompletedNotification({ userId: order.userId, orderId: order.id }).then(result => {
    if (!result.success) throw new Error(String(result.message));
  }));
  void Promise.allSettled(tasks).then(results => {
    for (const result of results) if (result.status === "rejected") logDiagnosticError("Post-payment fulfillment/notification failed", result.reason);
  });
  return result;
}

export async function handlePaymentCallback(data: Record<string, string>, paymentInfo = false) {
  if (!ecpayService.validateCheckMacValue(data, { hashKey: process.env.HASHKEY!, hashIV: process.env.HASHIV! })) {
    throw new CustomError("Invalid CheckMacValue", 400);
  }
  if (!data.CustomField1 || !/^[0-9a-f-]{36}$/i.test(data.CustomField1) || !data.CustomField2
    || !data.MerchantTradeNo || !/^\d+$/.test(data.TradeAmt ?? "") || !/^\d+$/.test(data.RtnCode ?? "")) {
    throw new CustomError("Invalid payment callback fields", 400);
  }
  if (!process.env.MERCHANTID || data.MerchantID !== process.env.MERCHANTID) throw new CustomError("Invalid MerchantID", 400);
  if ((process.env.NODE_ENV === "stg" || process.env.NODE_ENV === "production") && data.SimulatePaid === "1") {
    throw new CustomError("Simulated payment is not a real successful payment", 400, "SIMULATED_PAYMENT");
  }
  if (paymentInfo) {
    // ATM account issuance is not payment success and cannot change a terminal order.
    const attempt = await db.query.orderPaymentAttemptTable.findFirst({ where: eq(schema.orderPaymentAttemptTable.orderId, data.CustomField1) });
    if (!attempt || attempt.merchantTradeNo !== data.MerchantTradeNo || attempt.idempotencyKey !== data.CustomField2 || Number(data.TradeAmt) !== attempt.amount) {
      throw new CustomError("Payment callback does not match checkout", 400, "PAYMENT_CALLBACK_MISMATCH");
    }
    if (attempt.method !== "ATM" || data.RtnCode !== "2") throw new CustomError("Invalid ATM account issuance notification", 400);
    if (attempt.state !== "prepared") return;
    const bankName = data.BankCode ? getBankNameFromCode(data.BankCode) : undefined;
    await db.transaction(async tx => {
      await tx.select({ id: schema.orderTable.id }).from(schema.orderTable).where(eq(schema.orderTable.id, attempt.orderId)).for("update");
      await tx.update(schema.orderTable).set({ paymentInfo: { ...data, ...(bankName ? { BankName: bankName } : {}) } })
        .where(and(eq(schema.orderTable.id, attempt.orderId), eq(schema.orderTable.orderStatus, "payment-processing")));
    });
    return;
  }
  const attempt = await recordPaymentResult(data);
  return completePayment(attempt.id);
}

/** Retry signed results already persisted, including after provider retries are exhausted. */
export async function reconcileRecordedPayments() {
  const pending = await db.select({ id: schema.orderPaymentAttemptTable.id }).from(schema.orderPaymentAttemptTable)
    .where(inArray(schema.orderPaymentAttemptTable.state, ["succeeded", "failed"]))
    .orderBy(asc(schema.orderPaymentAttemptTable.updatedAt)).limit(100);
  let settled = 0;
  let checked = pending.length;
  for (const attempt of pending) {
    try { await completePayment(attempt.id); settled++; }
    catch (error) { logDiagnosticError("Payment reconciliation required", error, { paymentAttemptId: attempt.id }); }
  }
  // A missing webhook must not strand a charged order. Query only the provider's
  // signed state; "unpaid" is not proof that an open payment form cannot still charge.
  const awaiting = await db.select().from(schema.orderPaymentAttemptTable).where(and(
    eq(schema.orderPaymentAttemptTable.state, "prepared"),
    lte(schema.orderPaymentAttemptTable.updatedAt, new Date(Date.now() - 10 * 60_000)),
  )).orderBy(asc(schema.orderPaymentAttemptTable.updatedAt)).limit(20);
  for (const attempt of awaiting) {
    try {
      const data = await ecpayService.queryPaymentTradeInfo(attempt.merchantTradeNo);
      if (data.TradeStatus === "1") {
        if (Number(data.TradeAmt) !== attempt.amount || !data.TradeNo
          || ((process.env.NODE_ENV === "stg" || process.env.NODE_ENV === "production") && data.SimulatePaid === "1")) {
          throw new Error("Provider query payment details do not match checkout");
        }
        const recorded = await recordPaymentResult({ ...data, CustomField1: attempt.orderId,
          CustomField2: attempt.idempotencyKey, RtnCode: "1", reconciliationSource: "signed_provider_query" });
        checked++;
        await completePayment(recorded.id);
        settled++;
      }
    } catch (error) { logDiagnosticError("Payment status query requires retry", error, { paymentAttemptId: attempt.id }); }
    await db.update(schema.orderPaymentAttemptTable).set({ updatedAt: new Date() })
      .where(and(eq(schema.orderPaymentAttemptTable.id, attempt.id), eq(schema.orderPaymentAttemptTable.state, "prepared")));
  }
  return { checked, settled };
}
