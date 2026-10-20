import { getEcpayLength, hasEmoji } from "./ecpayValidation";
import { CustomError } from "./error";

export type SellerProfile = { name?: string | null; realName?: string | null; phone?: string | null };
export function validatePassword(password: string) {
  return password.length >= 8 && Buffer.byteLength(password, "utf8") <= 72 &&
    /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*(),.?":{}|<>]/.test(password);
}
export function validateRealName(name: string) {
  const length = getEcpayLength(name);
  if (length < 4 || length > 10) return `姓名長度須介於 4 到 10 個字元之間 (目前長度: ${length})`;
  if (hasEmoji(name)) return "姓名不可包含表情符號";
  return null;
}
export function validateCellPhone(phone: string) {
  return /^09\d{8}$/.test(phone) ? null : "手機格式錯誤，須為 09 開頭的 10 碼數字";
}
export function missingProfileFields(profile: SellerProfile) {
  return [
    ...(!profile.name?.trim() ? ["name"] : []),
    ...(!profile.realName?.trim() || validateRealName(profile.realName) ? ["realName"] : []),
    ...(!profile.phone || validateCellPhone(profile.phone) ? ["phone"] : []),
  ];
}
export function requireValidProfile(profile: SellerProfile) {
  const missing = missingProfileFields(profile);
  if (missing.length) throw new CustomError(`Missing or invalid profile fields: ${missing.join(", ")}`, 400);
}
export function requireCompletedSeller(account: { role: string; profileCompletedAt: Date | null; emailVerifiedAt?: Date | null }) {
  if (account.role === "seller" && !account.emailVerifiedAt) {
    throw new CustomError("Please verify your email address.", 403, "ACCOUNT_EMAIL_UNVERIFIED");
  }
  if (account.role === "seller" && !account.profileCompletedAt) {
    throw new CustomError("Please complete your seller profile.", 403, "ACCOUNT_PROFILE_INCOMPLETE");
  }
}
export function profileState(account: SellerProfile & { role: string; profileCompletedAt: Date | null }) {
  return { isProfileComplete: account.role !== "seller" || !!account.profileCompletedAt,
    missingProfileFields: account.role === "seller" ? missingProfileFields(account) : [] };
}

// Internal credential revisions are used by token issuers, never editable profile data.
export function publicAccount<T extends { credentialVersion: number; parent?: unknown }>(account: T) {
  const { credentialVersion: _, ...fields } = account;
  const result = { ...fields, isEmailVerified: !!(fields as Record<string, unknown>).emailVerifiedAt };
  if (result.parent && typeof result.parent === "object") {
    const { credentialVersion: __, ...parent } = result.parent as Record<string, unknown>;
    result.parent = parent;
  }
  return result;
}
