import type { Order, OrderItem } from "../db/schema";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatAmount(value: number): string {
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

type OrderEmailDetails = Pick<
  Order,
  | "subTotal"
  | "discountCoin"
  | "shippingCost"
  | "shippingCostDeduction"
  | "transactionFee"
  | "totalAmount"
> & {
  items: Pick<
    OrderItem,
    | "productNameAtSale"
    | "variantNameAtSale"
    | "unitPriceAtSale"
    | "quantity"
    | "lineTotal"
  >[];
};

function getAppScheme() {
  switch (process.env.NODE_ENV!) {
    case "local":
    case "development":
      return "waterdrop-dev";
    case "stg":
      return "waterdrop-stg";
    case "production":
      return "waterdrop";
    default:
      return "waterdrop-dev";
  }
}

function getDeepLinkHost() {
  switch (process.env.NODE_ENV!) {
    case "local":
    case "development":
      return "https://deeplink-dev.waterdropping.com";
    case "stg":
      return "https://deeplink-stg.waterdropping.com";
    case "production":
      return "https://deeplink.waterdropping.com";
    default:
      return "https://deeplink-dev.waterdropping.com";
  }
}

function getOrderLink(orderId: string) {
  const deepLink = `${getAppScheme()}:///order/${orderId}`;
  const orderLink = `${getDeepLinkHost()}/?link=${encodeURIComponent(deepLink)}`;
  console.log(`[deeplink]: ${orderLink}`);
  return orderLink;
}

export function generateOrderCompletedEmailHtml({
  userName,
  merchantTradeNo,
  orderId,
  details,
}: {
  userName: string;
  merchantTradeNo: string;
  orderId: string;
  details: OrderEmailDetails;
}): string {
  const orderLink = getOrderLink(orderId);
  const itemRows = details.items.map((item) => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;word-break:break-word;">
        ${escapeHtml(item.productNameAtSale)}
        ${item.variantNameAtSale?.trim() ? `<div style="margin-top:4px;font-size:12px;color:#6b7280;">${escapeHtml(item.variantNameAtSale.trim())}</div>` : ""}
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">NT$ ${formatAmount(item.unitPriceAtSale)}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">NT$ ${formatAmount(item.lineTotal)}</td>
    </tr>
  `).join("");
  const summaryRow = (label: string, amount: number, deduction = false) => `
    <tr>
      <td style="padding:6px 0;color:#4b5563;">${label}</td>
      <td style="padding:6px 0;text-align:right;">${deduction && amount !== 0 ? "−" : ""}NT$ ${formatAmount(amount)}</td>
    </tr>
  `;
  const discountCoin = details.discountCoin ?? 0;
  const shippingCostDeduction = details.shippingCostDeduction ?? 0;
  const transactionFee = details.transactionFee ?? 0;

  return `
    <div style="margin:0;padding:32px 16px;background-color:#f4f7fb;font-family:Arial,'Noto Sans TC',sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="padding:32px 32px 24px;background:linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%);color:#ffffff;">
          <div style="font-size:14px;letter-spacing:1px;opacity:0.9;">水滴</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.3;">訂單建立成功</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.8;opacity:0.95;">
            您的訂單已成功建立，我們會持續更新後續處理進度。
          </p>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.8;">您好，${escapeHtml(userName)}：</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#4b5563;">
            感謝您的訂購，您的訂單已成功建立。如有任何問題，請隨時聯繫客服人員。
          </p>
          <div style="margin-bottom:24px;padding:20px;border-radius:16px;background-color:#f8fafc;border:1px solid #e5e7eb;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">訂單編號</div>
            <div style="font-size:24px;font-weight:700;color:#111827;letter-spacing:0.5px;">${escapeHtml(merchantTradeNo)}</div>
          </div>
          <h2 style="margin:0 0 12px;font-size:18px;">商品明細</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;line-height:1.6;">
            <thead>
              <tr style="background-color:#f8fafc;">
                <th scope="col" style="padding:10px 8px;text-align:left;">商品</th>
                <th scope="col" style="padding:10px 8px;text-align:right;">單價</th>
                <th scope="col" style="padding:10px 8px;text-align:center;">數量</th>
                <th scope="col" style="padding:10px 8px;text-align:right;">小計</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:28px;font-size:14px;line-height:1.8;">
            ${summaryRow("商品總金額", details.subTotal)}
            ${summaryRow(`金幣折抵（${formatAmount(discountCoin)} 金幣）`, discountCoin / 10, true)}
            ${summaryRow("總運費", details.shippingCost ?? 0)}
            ${shippingCostDeduction !== 0 ? summaryRow("運費減免", shippingCostDeduction, true) : ""}
            ${transactionFee !== 0 ? summaryRow("手續費", transactionFee) : ""}
            <tr>
              <td style="padding:14px 0 0;border-top:1px solid #e5e7eb;font-weight:700;">最終需支付現金</td>
              <td style="padding:14px 0 0;border-top:1px solid #e5e7eb;text-align:right;font-size:18px;font-weight:700;color:#2563eb;">NT$ ${formatAmount(details.totalAmount)}</td>
            </tr>
          </table>
          <div style="margin-bottom:28px;">
          <a
              href="${orderLink}"
              style="display:inline-block;padding:14px 24px;border-radius:999px;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;"
            >
              查看訂單
            </a>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.8;color:#6b7280;">
            水滴團隊 敬上
          </p>
        </div>
      </div>
    </div>
  `;
}

export function generateRefundCreatedEmailHtml({
  userName,
  merchantTradeNo,
  orderId,
  productName,
  variantName,
}: {
  userName: string;
  merchantTradeNo: string;
  orderId: string;
  productName: string;
  variantName?: string | null;
}): string {
  const orderLink = getOrderLink(orderId);
  const productDisplayName = variantName?.trim()
    ? `${productName}（${variantName.trim()}）`
    : productName;

  return `
    <div style="margin:0;padding:32px 16px;background-color:#f4f7fb;font-family:Arial,'Noto Sans TC',sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="padding:32px 32px 24px;background:linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%);color:#ffffff;">
          <div style="font-size:14px;letter-spacing:1px;opacity:0.9;">水滴</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.3;">退貨申請已送出</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.8;opacity:0.95;">
            我們已收到您的退貨申請，後續狀態更新將透過通知告知您。
          </p>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.8;">您好，${userName}：</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#4b5563;">
            您已針對以下商品提出退貨申請。如有任何問題，請隨時聯繫客服人員。
          </p>
          <div style="margin-bottom:24px;padding:20px;border-radius:16px;background-color:#f8fafc;border:1px solid #e5e7eb;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">退貨商品</div>
            <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:16px;">${productDisplayName}</div>
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">訂單編號</div>
            <div style="font-size:20px;font-weight:700;color:#111827;letter-spacing:0.5px;">${merchantTradeNo}</div>
          </div>
          <div style="margin-bottom:28px;">
            <a
              href="${orderLink}"
              style="display:inline-block;padding:14px 24px;border-radius:999px;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;"
            >
              查看訂單
            </a>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.8;color:#6b7280;">
            水滴團隊 敬上
          </p>
        </div>
      </div>
    </div>
  `;
}
