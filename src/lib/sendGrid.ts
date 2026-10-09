import sgMail from "@sendgrid/mail";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLATFORM_LOGO_CONTENT_ID } from "./mailTemplate";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendEmail({
  from,
  to,
  subject,
  html,
  includePlatformLogo = false,
}: {
  from?: string;
  to: string;
  subject: string;
  html: string;
  includePlatformLogo?: boolean;
}): Promise<{ success: true } | { success: false; error: any }> {
  if (process.env.NODE_ENV === "test") {
    return { success: true };
  }
  const msg = {
    to,
    from: from || process.env.SENDGRID_FROM_EMAIL!,
    subject,
    html,
  };
  try {
    // Source assets remain under src for both tsx and compiled dist execution.
    const attachments = includePlatformLogo
      ? [{
          content: (await readFile(resolve(__dirname, "../../src/assets/images/appstore.png"))).toString("base64"),
          filename: "appstore.png",
          type: "image/png",
          disposition: "inline",
          // SendGrid passes plain attachment objects through without renaming keys.
          content_id: PLATFORM_LOGO_CONTENT_ID,
        }]
      : undefined;
    await sgMail.send({ ...msg, attachments });
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}
