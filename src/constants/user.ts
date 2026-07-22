export const BANK_ACCOUNT_UPDATE_MIN_MS = 10 * 60 * 1000;
export const BANK_ACCOUNT_UPDATE_MAX_MS = 120 * 24 * 60 * 60 * 1000;

export const BANK_ACCOUNT_UPDATE_REMINDER =
  "請再次確認銀行帳戶資料是否正確。送出後 10 分鐘內仍可修改；超過 10 分鐘後，120 天內將無法再次變更。";

export const BANK_ACCOUNT_UPDATE_TIMEOUT_ERROR_MESSAGE =
  "銀行帳戶資訊只能在上次更新後的 10 分鐘內或 120 天後更新。";
