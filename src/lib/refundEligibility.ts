import { isLocalOrDevelopment } from "./env";
import type { Delivery, OrderItem, RefundItem } from "../db/schema";

export const REFUND_WINDOW_MS = 240 * 60 * 60 * 1000;
export const REFUND_EXTENSION_MS = 120 * 60 * 60 * 1000;
// Only explicit local/development environments use accelerated testing durations.
export function getRefundWindowMs() {
  return isLocalOrDevelopment() ? REFUND_WINDOW_MS / 10 : REFUND_WINDOW_MS;
}

export function getRefundExtensionMs() {
  return isLocalOrDevelopment() ? REFUND_EXTENSION_MS / 10 : REFUND_EXTENSION_MS;
}

export const consumingRefundStatuses = ["pending", "processing", "completed"] as const;

type ReceiptDelivery = Pick<Delivery, "status" | "LogisticsType" | "LogisticsSubType" | "RtnCode">;

export function consumesRefundQuantity(status: RefundItem["status"]) {
  return status === "pending" || status === "processing" || status === "completed";
}

// Match the supported CVS carrier codes in logisticsStatus.ts. Store arrival is not pickup.
export function isAwaitingPickup(delivery: Omit<ReceiptDelivery, "status">) {
  if (delivery.LogisticsType !== "CVS") return false;
  const codes: Record<string, string[]> = {
    UNIMARTC2C: ["2073"],
    FAMIC2C: ["3029"],
    HILIFEC2C: ["2063", "2073", "3018"],
    OKMARTC2C: ["2073"],
  };
  return (codes[delivery.LogisticsSubType?.replace(/^CVS_/, "") ?? ""] ?? [])
    .includes(delivery.RtnCode ?? "");
}

export function isConfirmedReceipt(delivery: ReceiptDelivery) {
  if (delivery.status !== "delivered") return false;
  if (delivery.LogisticsType === "home_delivery") return true;
  if (delivery.LogisticsType !== "CVS") return false;
  const codes: Record<string, string[]> = {
    UNIMARTC2C: ["2067"],
    FAMIC2C: ["3022"],
    HILIFEC2C: ["2067", "3022"],
    OKMARTC2C: ["3022"],
  };
  return (codes[delivery.LogisticsSubType?.replace(/^CVS_/, "") ?? ""] ?? [])
    .includes(delivery.RtnCode ?? "");
}

export type RefundWindowItem = Pick<OrderItem,
  "deliveryId" | "quantity" | "refundWindowStartsAt" | "originalRefundDeadlineAt" | "refundDeadlineAt"
>;

type RefundWindowDecision = Pick<RefundItem, "status"> & Partial<Pick<RefundItem, "rejectionDeadlineAfter">>;

export function resolveRefundWindow(
  item: RefundWindowItem,
  refunds: RefundWindowDecision[],
  paymentConfirmedAt?: Date | null,
) {
  if (item.refundWindowStartsAt && item.originalRefundDeadlineAt && item.refundDeadlineAt) {
    return {
      refundWindowSource: "receipt" as const,
      refundWindowStartsAt: item.refundWindowStartsAt,
      originalRefundDeadlineAt: item.originalRefundDeadlineAt,
      refundDeadlineAt: item.refundDeadlineAt,
    };
  }
  if (isLocalOrDevelopment() && paymentConfirmedAt) {
    const originalDeadline = new Date(paymentConfirmedAt.getTime() + getRefundWindowMs());
    // Test-only windows are derived, never written as real receipt evidence. Rejections
    // persist their extension on the existing decision rows, under the same order lock.
    const deadline = refunds.reduce((latest, refund) =>
      refund.status === "rejected" && refund.rejectionDeadlineAfter && refund.rejectionDeadlineAfter > latest
        ? refund.rejectionDeadlineAfter : latest, originalDeadline);
    return {
      refundWindowSource: "payment_for_testing" as const,
      refundWindowStartsAt: paymentConfirmedAt,
      originalRefundDeadlineAt: originalDeadline,
      refundDeadlineAt: deadline,
    };
  }
  return {
    refundWindowSource: null,
    refundWindowStartsAt: null,
    originalRefundDeadlineAt: null,
    refundDeadlineAt: null,
  };
}

export function refundEligibility(
  orderStatus: string,
  item: RefundWindowItem,
  refunds: (Pick<RefundItem, "status" | "quantity"> & RefundWindowDecision)[],
  now = new Date(),
  deliveryStatus?: string,
  paymentConfirmedAt?: Date | null,
) {
  const unreserved = Math.max(0, item.quantity - refunds.reduce(
    (sum, refund) => sum + (consumesRefundQuantity(refund.status) ? refund.quantity : 0), 0,
  ));
  const refundReceiptChecksBypassed = isLocalOrDevelopment();
  const window = resolveRefundWindow(item, refunds, paymentConfirmedAt);
  const hasWindow = !!(window.refundWindowStartsAt && window.refundDeadlineAt);
  const windowStatus = !hasWindow
    ? (refundReceiptChecksBypassed || deliveryStatus === "delivered" ? "unknown" : "not_started")
    : now < window.refundWindowStartsAt! ? "not_started"
      : now >= window.refundDeadlineAt! ? "expired" : "open";
  const receiptBlockReason = !refundReceiptChecksBypassed && !item.deliveryId ? "NOT_RECEIVED"
    : !hasWindow ? (refundReceiptChecksBypassed ? "PAYMENT_TIME_UNKNOWN"
      : deliveryStatus === "delivered" ? "RECEIPT_TIME_UNKNOWN" : "NOT_RECEIVED")
      : windowStatus === "not_started" ? "NOT_RECEIVED"
        : windowStatus === "expired" ? "REFUND_WINDOW_EXPIRED" : null;
  const reason = orderStatus !== "paid" ? "ORDER_NOT_PAID"
    : receiptBlockReason ?? (unreserved === 0 ? "NO_REFUNDABLE_QUANTITY" : null);

  return {
    refundReceiptChecksBypassed,
    ...window,
    refundWindowStatus: windowStatus,
    refundBlockReason: reason,
    canRefund: reason === null,
    remainingRefundQuantity: reason === null ? unreserved : 0,
    unreservedRefundQuantity: unreserved,
    refundServerTime: now.toISOString(),
  };
}
