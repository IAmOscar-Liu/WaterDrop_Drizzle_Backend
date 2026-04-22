export function generateOrderCompletedEmailHtml({
  userName,
  merchantTradeNo,
  orderId,
}: {
  userName: string;
  merchantTradeNo: string;
  orderId: string;
}): string {
  const getAppScheme = () => {
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
  };

  const HOST =
    process.env.NODE_ENV === "local"
      ? "https://api.waterdropping.com"
      : process.env.HOST;

  const deepLink = `${getAppScheme()}:///order/${orderId}`;
  const orderLink = `${HOST}/?link=${encodeURIComponent(deepLink)}`;

  return `
    <div style="margin:0;padding:32px 16px;background-color:#f4f7fb;font-family:Arial,'Noto Sans TC',sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="padding:32px 32px 24px;background:linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%);color:#ffffff;">
          <div style="font-size:14px;letter-spacing:1px;opacity:0.9;">WaterDrop</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.3;">訂單建立成功</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.8;opacity:0.95;">
            您的訂單已成功建立，我們會持續更新後續處理進度。
          </p>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.8;">您好，${userName}：</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#4b5563;">
            感謝您的訂購，您的訂單已成功建立。如有任何問題，請隨時聯繫客服人員。
          </p>
          <div style="margin-bottom:24px;padding:20px;border-radius:16px;background-color:#f8fafc;border:1px solid #e5e7eb;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">訂單編號</div>
            <div style="font-size:24px;font-weight:700;color:#111827;letter-spacing:0.5px;">${merchantTradeNo}</div>
          </div>
          <div style="margin-bottom:28px;">
          <p>${orderLink}</p>  
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
