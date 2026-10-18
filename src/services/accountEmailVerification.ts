import { CustomError, handleServiceError } from "../lib/error";
import { publicAccount } from "../lib/accountProfile";
import { sendEmail } from "../lib/sendGrid";
import { acceptRecoveryAttempt } from "../repository/accountRecovery";
import { getAccountById } from "../repository/account";
import { consumeEmailVerification, issueEmailVerification, VerificationActor } from "../repository/accountEmailVerification";

export function emailVerificationPage(callbackUrl?: string) {
  const configured = process.env.ACCOUNT_EMAIL_VERIFICATION_URL;
  if (!configured) throw new CustomError("Email verification is not configured", 503);
  function normalize(raw: string) {
    const url = new URL(raw);
    const local = ["local", "test"].includes(process.env.NODE_ENV ?? "local") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href;
  }
  let allowed: string[];
  try { allowed = [configured, ...(process.env.ACCOUNT_EMAIL_VERIFICATION_ALLOWED_URLS ?? "").split(",").filter(Boolean)].map(normalize); }
  catch { throw new CustomError("Email verification URL configuration is invalid", 503); }
  try { const page = normalize(callbackUrl ?? configured); if (allowed.includes(page)) return page; }
  catch { /* Same public error for all unapproved URLs. */ }
  throw new CustomError("callbackUrl must be an approved email-verification page", 400);
}

export const verificationMailer = { send: sendEmail };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function verificationError(error: unknown) {
  if (error instanceof CustomError) return handleServiceError(error);
  console.error("[email-verification] Operation failed.");
  return handleServiceError(new CustomError("Email verification operation failed", 500));
}
const throttle = () => new CustomError("Too many attempts; please try again later", 429, "EMAIL_VERIFICATION_RATE_LIMIT");
async function rate(namespace: string, key: string, limit: number, cooldown = 0) {
  if (!await acceptRecoveryAttempt(namespace, key, limit, cooldown)) throw throttle();
}

export async function prepareSellerRegistration(ip: string) {
  // Fail before account creation if the configured link is unusable.
  const page = emailVerificationPage();
  await rate("registration-ip", ip, 20);
  return page;
}

async function deliver(issued: NonNullable<Awaited<ReturnType<typeof issueEmailVerification>>>, page: string) {
  const change = issued.purpose === "change";
  const link = `${page}#token=${issued.token}&purpose=${issued.purpose}`;
  const result = await verificationMailer.send({ to: issued.email, subject: change ? "水滴｜確認變更電子郵件" : "水滴｜驗證電子郵件",
    disableTracking: true,
    html: `<p>${change ? "請確認您要將水滴帳號的電子郵件變更為此地址。確認前，原地址仍可用於登入及密碼復原。" : "歡迎加入水滴！請驗證您的電子郵件，以繼續完成賣家註冊。"}</p><p>此連結於 30 分鐘後失效，且僅能使用一次。請登入提出申請的帳號，再按確認。</p><p><a href="${escapeHtml(link)}">${change ? "確認變更電子郵件" : "驗證電子郵件"}</a></p><p>如果您未提出此申請，請忽略這封信。連結失效時，請回到水滴重新申請。</p>` });
  if (!result.success) throw new CustomError("Verification email could not be sent; please request another link", 503, "EMAIL_VERIFICATION_DELIVERY_FAILED");
}

export async function sendRegistrationVerification(accountId: string, version: number, page: string) {
  try {
    await rate("verification-send-account", accountId, 5, 60);
    const issued = await issueEmailVerification(accountId, { expectedVersion: version });
    if (issued) await deliver(issued, page);
  } catch { console.error("[email-verification] Registration email failed; account retained for resend."); }
}

export default {
  async resend(actor: VerificationActor, input: { callbackUrl?: string }, ip: string) {
    try {
      const page = emailVerificationPage(input.callbackUrl);
      await rate("verification-send-ip", ip, 20);
      await rate("verification-send-account", actor.accountId, 5, 60);
      const issued = await issueEmailVerification(actor.accountId, { actor });
      if (issued) await deliver(issued, page);
      return { success: true as const, data: { message: issued ? "Verification email accepted for delivery." : "Email already verified." } };
    } catch (error) { return verificationError(error); }
  },
  async verify(actor: VerificationActor, token: string, ip: string) {
    try {
      await rate("verification-consume-ip", ip, 60);
      await rate("verification-consume-account", actor.accountId, 60);
      const result = await consumeEmailVerification(actor, token, "verify");
      return { success: true as const, data: publicAccount(await getAccountById(result.accountId)) };
    } catch (error) { return verificationError(error); }
  },
  async requestChange(actor: VerificationActor, input: { newEmail: string; password: string; callbackUrl?: string }, ip: string) {
    try {
      const page = emailVerificationPage(input.callbackUrl);
      await rate("email-change-ip", ip, 20);
      await rate("email-change-account", actor.accountId, 5, 60);
      // Limit sends to a destination across accounts as well.
      await rate("email-change-target", input.newEmail.toLowerCase(), 5, 60);
      const issued = await issueEmailVerification(actor.accountId, { actor, newEmail: input.newEmail, password: input.password });
      if (issued) await deliver(issued, page);
      return { success: true as const, data: { message: "Check the new email address to confirm the change. Your current email remains active." } };
    } catch (error) { return verificationError(error); }
  },
  async confirmChange(actor: VerificationActor, token: string, ip: string) {
    try {
      await rate("verification-consume-ip", ip, 60);
      await rate("verification-consume-account", actor.accountId, 60);
      const result = await consumeEmailVerification(actor, token, "change");
      void verificationMailer.send({ to: result.oldEmail, subject: "水滴｜電子郵件已變更", disableTracking: true,
        html: "<p>您的水滴帳號電子郵件已變更，原地址已無法用於登入或密碼復原。如果這不是您的操作，請立即聯絡水滴客服。</p>" })
        .then(r => { if (!r.success) console.error("[email-verification] Old-address notification failed."); })
        .catch(() => console.error("[email-verification] Old-address notification failed."));
      return { success: true as const, data: { requiresLogin: true, message: "Email changed. Please log in with your new email address." } };
    } catch (error) { return verificationError(error); }
  },
};
