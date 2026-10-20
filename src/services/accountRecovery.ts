import { CustomError, handleServiceError } from "../lib/error";
import { sendEmail } from "../lib/sendGrid";
import { acceptRecoveryAttempt, consumePasswordReset, issuePasswordReset } from "../repository/accountRecovery";

export function resetPageUrl(callbackUrl?: string) {
  const configured = process.env.ACCOUNT_PASSWORD_RESET_URL;
  const allowed = [configured, ...(process.env.ACCOUNT_PASSWORD_RESET_ALLOWED_URLS ?? "").split(",")].filter((v): v is string => !!v);
  if (!configured) throw new CustomError("Account recovery is not configured", 503);
  function normalize(raw: string) {
    const url = new URL(raw);
    const local = ["local", "test"].includes(process.env.NODE_ENV ?? "local") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw new Error("Invalid reset URL");
    return url.href;
  }
  let trusted: string[];
  try { trusted = allowed.map(normalize); }
  catch { throw new CustomError("Account recovery URL configuration is invalid", 503); }
  try {
    const result = normalize(callbackUrl ?? configured);
    if (!trusted.includes(result)) throw new Error();
    return result;
  } catch { throw new CustomError("callbackUrl must be an approved reset-password page", 400); }
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Separate adapter allows tests to capture delivery without exposing tokens through HTTP.
export const recoveryMailer = {
  send: sendEmail,
};
export async function deliverPasswordReset(email: string, page: string) {
  const issued = await issuePasswordReset(email);
  if (!issued) return;
  const link = `${page}#token=${issued.token}`;
  const result = await recoveryMailer.send({ to: issued.email, fromName: "地平線", subject: "地平線｜重設密碼",
    disableTracking: true,
    html: `<p>請點選下方連結重設密碼，此連結於 30 分鐘後失效，且僅能使用一次。</p><p><a href="${escapeHtml(link)}">重設密碼</a></p><p>如果您未提出此申請，請忽略這封信。您可以重新申請重設連結。</p>` });
  if (!result.success) throw new Error("Reset email delivery failed");
}

export default {
  async forgotPassword(input: { email: string; callbackUrl?: string }, ip: string) {
    try {
      const page = resetPageUrl(input.callbackUrl);
      if (!await acceptRecoveryAttempt("forgot-ip", ip, 20)) throw new CustomError("Too many requests", 429);
      const allowed = await acceptRecoveryAttempt("forgot-email", input.email.trim().toLowerCase(), 5, 60);
      // Account lookup and delivery both happen after the generic response path.
      // This is best-effort delivery, not a durable mail queue.
      if (allowed) setImmediate(() => {
        void deliverPasswordReset(input.email, page).catch(() => console.error("[account-recovery] Reset email failed; user may request another link."));
      });
      return { success: true as const, data: { message: "If an eligible account exists, a password reset email will be sent." } };
    } catch (error) { return handleServiceError(error); }
  },
  async resetPassword(input: { token: string; newPassword: string }, ip: string) {
    try {
      if (!await acceptRecoveryAttempt("reset-ip", ip, 60)) throw new CustomError("Too many requests", 429);
      const account = await consumePasswordReset(input.token, input.newPassword);
      void recoveryMailer.send({ to: account.email, fromName: "地平線", subject: "地平線｜密碼已變更", disableTracking: true,
        html: "<p>您的地平線帳號密碼已變更，請使用新密碼重新登入。如果這不是您的操作，請立即聯絡地平線客服。</p>" })
        .then((result) => { if (!result.success) console.error("[account-recovery] Password confirmation email failed."); })
        .catch(() => console.error("[account-recovery] Password confirmation email failed."));
      return { success: true as const, data: { message: "Password reset successfully. Please log in." } };
    } catch (error) { return handleServiceError(error); }
  },
};
