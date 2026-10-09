import "../lib/env";

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { generateOrderCompletedEmailHtml } from "../lib/mailTemplate";

async function main() {
  const { values } = parseArgs({
    options: { to: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  if (!values.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.to)) {
    throw new Error("Provide a recipient using --to email@example.com.");
  }
  if (process.env.NODE_ENV === "test") {
    throw new Error("NODE_ENV=test disables email delivery; use development or local.");
  }
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    throw new Error("SENDGRID_API_KEY and SENDGRID_FROM_EMAIL must be configured.");
  }

  // Load the client only after environment configuration has been validated.
  const { sendEmail } = await import("../lib/sendGrid");
  const reference = `EMAIL-TEST-${Date.now()}`;
  const html = generateOrderCompletedEmailHtml({
    userName: "測試收件者（此信為寄信測試，非真實訂單）",
    merchantTradeNo: reference,
    // Synthetic data only: no order is created or queried by this script.
    orderId: randomUUID(),
    details: {
      subTotal: 1200,
      discountCoin: 100,
      shippingCost: 120,
      shippingCostDeduction: 60,
      transactionFee: 15,
      totalAmount: 1265,
      items: [
        { productNameAtSale: "測試商品 A", variantNameAtSale: "藍色／L", unitPriceAtSale: 500, quantity: 2, lineTotal: 1000 },
        { productNameAtSale: "測試商品 B", variantNameAtSale: null, unitPriceAtSale: 200, quantity: 1, lineTotal: 200 },
      ],
    },
  });

  console.log(`Sending sample order email with inline logo to ${values.to} (${reference}).`);
  console.log("Sample data only; the order link does not refer to a real order.");
  const result = await sendEmail({
    to: values.to,
    subject: `[水滴寄信測試] 訂單明細與 Logo — ${reference}`,
    html,
  });
  if (!result.success) {
    // Do not log the full SDK error: it can contain authorization headers.
    const error = result.error;
    console.error("Email send failed:", {
      code: error?.code,
      statusCode: error?.response?.statusCode,
      message: error instanceof Error ? error.message : "Unknown error",
      errors: error?.response?.body?.errors?.map((entry: { message?: string; field?: string }) => ({
        message: entry.message,
        field: entry.field,
      })),
    });
    process.exitCode = 1;
    return;
  }
  console.log("SendGrid accepted the email. Inbox delivery is not yet confirmed; check inbox/spam and SendGrid Email Activity if it does not arrive.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Email script failed.");
  process.exitCode = 1;
});
