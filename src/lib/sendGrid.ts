import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendEmail({
  from,
  to,
  subject,
  html,
}: {
  from?: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: true } | { success: false; error: any }> {
  const msg = {
    to,
    from: from || process.env.SENDGRID_FROM_EMAIL!,
    subject,
    html,
  };
  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}
