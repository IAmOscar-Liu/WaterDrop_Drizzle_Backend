import assert from "node:assert/strict";
import { getRefundStatusBody } from "../lib/refundStatusNotification";
import { generateRefundStatusChangedEmailHtml } from "../lib/mailTemplate";

const context = {
  status: "rejected" as const,
  productName: "Test product",
  variantName: "Blue",
  merchantTradeNo: "ORDER-123",
  refundDeadlineAt: new Date("2026-11-04T04:10:35.220Z"),
  refundWindowDaysAtSale: 8,
  rejectionReason: "Please provide more information <script>alert(1)</script>",
};
const body = getRefundStatusBody(context);
assert.ok(body.includes("2026-11-04 12:10（台北時間）前重新提出退貨申請"));
assert.ok(body.includes(context.rejectionReason));
assert.ok(body.includes("Test product（Blue）"));
// Midnight and year rollover are formatted in Taipei, independent of host timezone.
assert.ok(getRefundStatusBody({ ...context, refundDeadlineAt: new Date("2026-12-31T16:05:00Z") }).includes("2027-01-01 00:05"));
const unlimited = getRefundStatusBody({ ...context, refundWindowDaysAtSale: null, refundDeadlineAt: null });
assert.ok(unlimited.includes("不限期"));
assert.ok(!unlimited.includes("2026-11-04"));
const unknown = getRefundStatusBody({ ...context, refundDeadlineAt: null });
assert.ok(unknown.includes("訂單詳情確認"));
const completed = getRefundStatusBody({ ...context, status: "completed" });
assert.ok(completed.includes("已完成"));
assert.ok(!completed.includes("拒絕原因"));
assert.ok(!completed.includes("重新提出"));
const details = { ...context, reason: "Test <reason>", note: null, quantity: 1, originalQuantity: 1, cashRefundAmount: null, returnableCoins: null };
const html = generateRefundStatusChangedEmailHtml({ userName: "<b>Oscar</b>", orderId: "test-order", body, details });
assert.ok(html.includes("2026-11-04 12:10"));
assert.ok(html.includes("&lt;b&gt;Oscar&lt;/b&gt;"));
assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
assert.ok(!html.includes("<script>"));
assert.ok(html.includes("<br />"));
assert.ok(html.includes("border-radius:999px"));
assert.ok(html.includes(">查看訂單</a>"));
assert.ok(html.includes("<table"));
assert.ok(html.includes("&lt;reason&gt;"));
assert.ok(html.includes(encodeURIComponent("waterdrop-dev:///order/test-order")));
const partial = generateRefundStatusChangedEmailHtml({ userName: "Oscar", orderId: "test-order", body: completed,
  details: { ...details, status: "completed", originalQuantity: 2, cashRefundAmount: 195, returnableCoins: 50 } });
assert.ok(partial.includes("部分退款已完成"));
assert.ok(partial.includes("未退款數量"));
assert.ok(partial.includes("NT$ 195"));
assert.ok(partial.includes("50 金幣"));
console.log("Refund status notifications: deadline formatting, unlimited policies, status text and email escaping passed.");
