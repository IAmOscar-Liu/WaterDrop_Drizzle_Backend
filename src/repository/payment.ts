import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { getEcpayLength, hasEmoji, hasSpecialChars } from "../lib/ecpayValidation";
import { isCoinLedgerEnabled, toCoinUnits } from "../lib/coinAccounting";
import { updateOrderStatusWithTx } from "./order";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockOrder(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(schema.orderTable).where(eq(schema.orderTable.id, orderId)).for("update");
  if (!order) throw new CustomError("Order not found", 404);
  return order;
}

export async function preparePayment(input: {
  orderId: string; userId: string; idempotencyKey: string; amount: number; method: string;
}) {
  return db.transaction(async tx => {
    const order = await lockOrder(tx, input.orderId);
    if (order.userId !== input.userId) throw new CustomError("Order not found", 404);
    if (!["Credit", "ATM"].includes(input.method) || order.orderPayment !== input.method) {
      throw new CustomError("Payment method differs from the order", 400, "PAYMENT_METHOD_MISMATCH");
    }
    if (!Number.isSafeInteger(order.totalAmount) || order.totalAmount <= 0 || input.amount !== order.totalAmount) {
      throw new CustomError("Payment amount differs from the order", 400, "PAYMENT_AMOUNT_MISMATCH");
    }
    const existing = await tx.query.orderPaymentAttemptTable.findFirst({ where: eq(schema.orderPaymentAttemptTable.orderId, order.id) });
    if (existing) {
      if (existing.idempotencyKey !== input.idempotencyKey || existing.state !== "prepared" || order.orderStatus !== "payment-processing") {
        throw new CustomError("This order already has a payment attempt", 409, "PAYMENT_ALREADY_STARTED");
      }
      return existing;
    }
    if (order.orderStatus !== "pending" || Date.now() - order.createdAt.getTime() >= 30 * 60_000) {
      throw new CustomError("Order is no longer payable", 409, "ORDER_NOT_PAYABLE");
    }
    const key = await tx.query.idempotencyKeyTable.findFirst({ where: eq(schema.idempotencyKeyTable.key, input.idempotencyKey) });
    const request = key?.requestData as { orderId?: string; orderData?: { userId?: string } } | undefined;
    if (!key || request?.orderId !== order.id || request.orderData?.userId !== input.userId) {
      throw new CustomError("Invalid order payment key", 403, "PAYMENT_KEY_MISMATCH");
    }
    const items = await tx.select().from(schema.orderItemTable).where(eq(schema.orderItemTable.orderId, order.id)).orderBy(schema.orderItemTable.productVariantId);
    const products = items.length ? await tx.select().from(schema.productTable)
      .where(inArray(schema.productTable.id, items.map(i => i.productId))).orderBy(asc(schema.productTable.id)).for("update") : [];
    const variants = items.length ? await tx.select().from(schema.productVariantTable)
      .where(inArray(schema.productVariantTable.id, items.map(i => i.productVariantId))).orderBy(asc(schema.productVariantTable.id)).for("update") : [];
    if (!items.length) throw new CustomError("Order has no items", 400);
    let subtotal = 0;
    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      const variant = variants.find(v => v.id === item.productVariantId);
      if (!product || product.deletedAt || product.status !== "active" || !variant || variant.productId !== product.id || variant.status !== "active") {
        throw new CustomError("Product or variant is unavailable", 409, "PRODUCT_UNAVAILABLE");
      }
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.pendingQuantity !== item.quantity
        || variant.stock < item.quantity || variant.stock < variant.reserve || variant.reserve < item.quantity) {
        throw new CustomError("Order inventory reservation is invalid", 409, "ORDER_STOCK_UNAVAILABLE");
      }
      if (!Number.isFinite(item.unitPriceAtSale) || item.unitPriceAtSale < 0 || toCoinUnits(item.unitPriceAtSale) !== toCoinUnits(variant.price)) {
        throw new CustomError("Product price changed; create a new order", 409, "PRODUCT_PRICE_CHANGED");
      }
      const seller = await tx.query.accountTable.findFirst({ where: eq(schema.accountTable.id, product.sellerId) });
      if (!seller || seller.status !== "active" || seller.deletedAt) throw new CustomError("Seller is unavailable", 409);
      subtotal += toCoinUnits(item.unitPriceAtSale) * item.quantity;
    }
    const shippingInfo = order.shippingInfo as { cvsPickupGroup?: unknown; nonCvsPickupGroup?: unknown } | null;
    const assigned = new Set<string>();
    for (const [name, raw] of [["cvsPickupGroup", shippingInfo?.cvsPickupGroup], ["nonCvsPickupGroup", shippingInfo?.nonCvsPickupGroup]] as const) {
      if (raw !== undefined && !Array.isArray(raw)) throw new CustomError("Invalid delivery groups", 400, "INVALID_SHIPPING_INFO");
      for (const group of (raw ?? []) as Record<string, any>[]) {
        if (!group || !Array.isArray(group.products) || !group.products.length || !Number.isFinite(group.GoodsAmount) || group.GoodsAmount < 0) {
          throw new CustomError("Invalid delivery group", 400, "INVALID_SHIPPING_INFO");
        }
        const groupSellers = new Set<string>();
        for (const ref of group.products) {
          if (!ref || assigned.has(ref.variantId) || !items.some(i => i.productId === ref.productId && i.productVariantId === ref.variantId)) {
            throw new CustomError("Delivery items do not match the order", 400, "INVALID_SHIPPING_INFO");
          }
          const product = products.find(p => p.id === ref.productId)!;
          groupSellers.add(product.sellerId);
          if (name === "nonCvsPickupGroup" && ((group.LogisticsType === "home_delivery" && !product.allowHomeDelivery)
            || (group.LogisticsType === "virtual" && product.type !== "virtual"))) {
            throw new CustomError("Selected delivery is unavailable for this product", 400, "INVALID_SHIPPING_INFO");
          }
          assigned.add(ref.variantId);
        }
        if (groupSellers.size !== 1) throw new CustomError("Delivery groups must belong to one seller", 400, "INVALID_SHIPPING_INFO");
        if (name === "cvsPickupGroup") {
          if (!["FAMI", "UNIMART", "HILIFE", "FAMIC2C", "UNIMARTC2C", "HILIFEC2C", "OKMARTC2C"].includes(group.LogisticsSubType)
            || ["GoodsName", "ReceiverName", "ReceiverCellPhone", "ReceiverEmail", "ReceiverStoreID"].some(key => typeof group[key] !== "string" || !group[key].trim())) {
            throw new CustomError("CVS delivery information is incomplete", 400, "INVALID_SHIPPING_INFO");
          }
          const nameLength = getEcpayLength(group.ReceiverName);
          if (nameLength < 4 || nameLength > 10 || hasEmoji(group.ReceiverName)
            || !/^09\d{8}$/.test(group.ReceiverCellPhone) || !group.ReceiverEmail.includes("@") || group.ReceiverEmail.length > 100
            || getEcpayLength(group.GoodsName) > 50 || hasSpecialChars(group.GoodsName)
            || !Number.isInteger(group.GoodsAmount) || group.GoodsAmount < 1 || group.GoodsAmount > 20000) {
            throw new CustomError("CVS delivery fields are invalid", 400, "INVALID_SHIPPING_INFO");
          }
        } else if (!["home_delivery", "virtual"].includes(group.LogisticsType)) {
          throw new CustomError("Invalid delivery method", 400, "INVALID_SHIPPING_INFO");
        }
      }
    }
    if (items.some(i => products.find(p => p.id === i.productId)?.type !== "virtual" && !assigned.has(i.productVariantId))) {
      throw new CustomError("Choose delivery for each physical item", 400, "INVALID_SHIPPING_INFO");
    }
    const discount = order.discountCoin ?? 0;
    const shipping = order.shippingCost ?? 0;
    const deduction = order.shippingCostDeduction ?? 0;
    const fee = order.transactionFee ?? 0;
    if (![discount, shipping, deduction, fee].every(v => Number.isFinite(v) && v >= 0) || deduction > shipping
      || toCoinUnits(order.subTotal) !== subtotal || discount > subtotal / 10
      || toCoinUnits(order.totalAmount) !== subtotal - Math.round(discount * 10) + toCoinUnits(shipping - deduction + fee)) {
      throw new CustomError("Order totals are inconsistent", 409, "ORDER_TOTAL_MISMATCH");
    }
    if (discount > 0 && !isCoinLedgerEnabled()) {
      throw new CustomError("Coin ledger must be enabled before accepting discounted payments", 503, "COIN_LEDGER_REQUIRED");
    }
    await updateOrderStatusWithTx(tx, { orderId: order.id, status: "payment-processing" });
    const [attempt] = await tx.insert(schema.orderPaymentAttemptTable).values({
      orderId: order.id, merchantTradeNo: randomBytes(10).toString("hex"), idempotencyKey: input.idempotencyKey,
      amount: order.totalAmount, method: order.orderPayment,
    }).returning();
    return attempt;
  });
}

/** Called only after the service verifies the provider signature. Capture before settlement. */
export async function recordPaymentResult(data: Record<string, string>) {
  return db.transaction(async tx => {
    const order = await lockOrder(tx, data.CustomField1);
    let attempt = await tx.query.orderPaymentAttemptTable.findFirst({ where: eq(schema.orderPaymentAttemptTable.orderId, order.id) });
    if (!attempt) {
      // Preserve signed callbacks for checkouts already open when this change is deployed.
      // Legacy coin shortages remain processing for review; never acknowledge and lose a charge.
      const key = await tx.query.idempotencyKeyTable.findFirst({ where: eq(schema.idempotencyKeyTable.key, data.CustomField2) });
      const request = key?.requestData as { orderId?: string; orderData?: { userId?: string } } | undefined;
      if (!key || request?.orderData?.userId !== order.userId || (request.orderId && request.orderId !== order.id)
        || Number(data.TradeAmt) !== order.totalAmount) throw new CustomError("Unknown payment attempt", 400);
      if (order.orderStatus === "paid" && order.merchantTradeNo !== data.MerchantTradeNo) throw new CustomError("Conflicting payment", 409);
      [attempt] = await tx.insert(schema.orderPaymentAttemptTable).values({ orderId: order.id,
        merchantTradeNo: data.MerchantTradeNo, idempotencyKey: data.CustomField2, amount: order.totalAmount,
        method: order.orderPayment, state: order.orderStatus === "paid" ? "settled" : "prepared",
        providerData: order.orderStatus === "paid" ? data : null,
      }).returning();
      if (order.orderStatus !== "paid") {
        await tx.update(schema.orderTable).set({ orderStatus: "payment-processing" }).where(eq(schema.orderTable.id, order.id));
      }
    }
    if (!attempt || attempt.merchantTradeNo !== data.MerchantTradeNo || attempt.idempotencyKey !== data.CustomField2
      || Number(data.TradeAmt) !== attempt.amount || !Number.isSafeInteger(Number(data.TradeAmt))) {
      throw new CustomError("Payment callback does not match checkout", 400, "PAYMENT_CALLBACK_MISMATCH");
    }
    if (data.RtnCode === "1" && !data.TradeNo) throw new CustomError("Provider transaction number is missing", 400);
    if (attempt.state === "succeeded" || (attempt.state === "settled" && (attempt.providerData?.RtnCode === "1" || data.RtnCode !== "1"))) return attempt;
    if (data.RtnCode === "1" && order.orderStatus !== "paid" && order.orderStatus !== "payment-processing") {
      await tx.update(schema.orderTable).set({ orderStatus: "payment-processing" }).where(eq(schema.orderTable.id, order.id));
    }
    const [recorded] = await tx.update(schema.orderPaymentAttemptTable).set({
      state: data.RtnCode === "1" ? "succeeded" : "failed", providerData: data,
    }).where(eq(schema.orderPaymentAttemptTable.id, attempt.id)).returning();
    return recorded;
  });
}

export async function settlePayment(attemptId: string) {
  return db.transaction(async tx => {
    const ref = await tx.query.orderPaymentAttemptTable.findFirst({ where: eq(schema.orderPaymentAttemptTable.id, attemptId) });
    if (!ref) throw new CustomError("Payment attempt not found", 404);
    const order = await lockOrder(tx, ref.orderId);
    const attempt = (await tx.select().from(schema.orderPaymentAttemptTable).where(eq(schema.orderPaymentAttemptTable.id, attemptId)).for("update"))[0];
    if (attempt.state === "settled") return { order: undefined, replayed: true };
    if (attempt.state !== "succeeded" && attempt.state !== "failed") throw new CustomError("Provider payment has not finished", 409);
    const status = attempt.state === "succeeded" ? "paid" : "failed";
    if (order.orderStatus !== "payment-processing" || order.totalAmount !== attempt.amount) {
      throw new CustomError("Payment requires reconciliation; resources must not be reallocated after charging", 409, "PAYMENT_REVIEW_REQUIRED");
    }
    if (status === "paid") {
      const items = await tx.select().from(schema.orderItemTable).where(eq(schema.orderItemTable.orderId, order.id));
      if (!items.length || items.some(item => item.pendingQuantity !== item.quantity)) {
        throw new CustomError("Payment inventory requires reconciliation", 409, "PAYMENT_REVIEW_REQUIRED");
      }
    }
    if (status === "paid" && (order.discountCoin ?? 0) > 0) {
      if (!isCoinLedgerEnabled()) throw new CustomError("Coin ledger is required for settlement", 503);
      const allocations = await tx.select().from(schema.orderCoinAllocationTable).where(eq(schema.orderCoinAllocationTable.orderId, order.id));
      if (allocations.reduce((sum, a) => sum + toCoinUnits(a.reservedAmount), 0) !== toCoinUnits(order.discountCoin!)) {
        throw new CustomError("Reserved coins require reconciliation", 409, "PAYMENT_REVIEW_REQUIRED");
      }
    }
    const result = await updateOrderStatusWithTx(tx, { orderId: order.id, status, metadata: attempt.providerData }, undefined, attempt.id);
    await tx.update(schema.orderPaymentAttemptTable).set({ state: "settled" }).where(eq(schema.orderPaymentAttemptTable.id, attempt.id));
    await tx.update(schema.idempotencyKeyTable).set({ status: status === "paid" ? "completed" : "failed", responseData: result })
      .where(eq(schema.idempotencyKeyTable.key, attempt.idempotencyKey));
    return { order: result, replayed: false };
  });
}
