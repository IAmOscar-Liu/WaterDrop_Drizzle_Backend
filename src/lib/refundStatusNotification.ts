import type { RefundItem } from "../db/schema";
import { getLocalDate, getZonedParts } from "./coinAccounting";

export function getRefundStatusBody(context: {
  status: RefundItem["status"];
  productName: string;
  variantName: string | null;
  merchantTradeNo: string | null;
  refundDeadlineAt: Date | null;
  refundWindowDaysAtSale: number | null;
  rejectionReason: string | null;
}) {
  const productName = context.variantName?.trim()
    ? `${context.productName}（${context.variantName.trim()}）` : context.productName;
  const statusText = {
    rejected: "已拒絕", pending: "等待處理", processing: "處理中",
    completed: "已完成", cancelled: "已取消",
  }[context.status];
  let body = `您的商品「${productName}」退貨申請狀態已更新為「${statusText}」。(訂單編號: ${context.merchantTradeNo ?? ""})`;
  if (context.status === "rejected") {
    if (context.rejectionReason) body += `\n拒絕原因：${context.rejectionReason}`;
    if (context.refundWindowDaysAtSale === null) {
      body += "\n此商品的退貨申請不限期；如仍有可申請數量，您可重新提出申請。";
    } else if (context.refundDeadlineAt && context.refundWindowDaysAtSale > 0) {
      const timezone = "Asia/Taipei";
      const { hour, minute } = getZonedParts(context.refundDeadlineAt, timezone);
      const deadline = `${getLocalDate(context.refundDeadlineAt, timezone)} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      body += `\n如仍有可申請數量，您可於 ${deadline}（台北時間）前重新提出退貨申請。`;
    } else {
      body += "\n請至訂單詳情確認目前是否可重新提出退貨申請。";
    }
  }
  return body;
}
