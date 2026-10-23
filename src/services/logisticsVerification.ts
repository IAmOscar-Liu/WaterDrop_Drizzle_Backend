import axios from "axios";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Agent } from "node:https";
import { CustomError, handleServiceError } from "../lib/error";
import { createLogisticsVerificationLimit } from "../lib/logisticsVerificationLimit";
import type { LogisticsVerificationInput } from "../middleware/logisticsVerification";
import { requireLogisticsVerificationUser } from "../repository/logisticsVerification";
import type { ServiceResponse } from "../type/general";
import ecpay from "./ecpay";

const TEST_URL = "https://logistics-stage.ecpay.com.tw/Express/Create";
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 32 * 1024;
// Dedicated transport: fixed provider host, normal TLS verification, no redirects or auto retries.
export const logisticsVerificationClient = axios.create({
  timeout: TIMEOUT_MS,
  responseType: "text",
  transformResponse: [(data) => data],
  maxRedirects: 0,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
  httpsAgent: new Agent({ rejectUnauthorized: true }),
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
});
const acquire = createLogisticsVerificationLimit();

type VerificationResult = {
  verificationId: string;
  success: boolean;
  code: "VALIDATED" | "PROVIDER_REJECTED";
  message: string;
  providerCode: string | null;
};

function invalidResponse(): never {
  throw new CustomError("物流驗證回應無法確認，請稍後重試", 502, "LOGISTICS_VERIFICATION_INVALID_RESPONSE");
}

/** Accept only a correlated, signed synchronous creation response, never browser callbacks. */
export function parseLogisticsVerificationResponse(
  raw: unknown,
  expected: Record<string, string>,
  hashKey: string,
  hashIV: string,
) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) invalidResponse();
  const text = raw.trim();
  if (text.startsWith("0|") && text.slice(2).trim()) {
    // The documented rejection body is unstructured and may contain submitted personal data.
    return { success: false, providerCode: null };
  }
  if (!text.startsWith("1|")) invalidResponse();
  const encoded = text.slice(2);
  if (/%(?![0-9a-f]{2})/i.test(encoded)) invalidResponse();
  const params = new URLSearchParams(encoded);
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) invalidResponse();
    fields[key] = value;
  }
  const { CheckMacValue, ...signedFields } = fields;
  if (!CheckMacValue || !/^[A-Fa-f0-9]{32}$/.test(CheckMacValue)) invalidResponse();
  const calculated = ecpay.generateCheckValue(signedFields, hashKey, hashIV, "md5");
  if (!timingSafeEqual(Buffer.from(calculated, "hex"), Buffer.from(CheckMacValue, "hex"))) invalidResponse();
  for (const key of ["MerchantID", "MerchantTradeNo", "LogisticsType", "LogisticsSubType", "GoodsAmount", "ReceiverName", "ReceiverCellPhone", "ReceiverEmail"]) {
    if (fields[key] !== expected[key]) invalidResponse();
  }
  if (!/^\d{1,20}$/.test(fields.AllPayLogisticsID ?? "") || !/^[1-9]\d{0,9}$/.test(fields.RtnCode ?? "")) invalidResponse();
  // 300 = ECPay accepted the new logistics order. Not delivered, paid or shipped.
  // Unknown/new status codes must not silently unlock checkout.
  if (fields.RtnCode !== "300") invalidResponse();
  return { success: true, providerCode: fields.RtnCode };
}

function callbackUrl() {
  try {
    const url = new URL("/api/ecpay/express/test/validation/server-reply", process.env.HOST);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.toString().length > 200) throw new Error();
    return url.toString();
  } catch {
    throw new CustomError("物流驗證服務尚未設定", 503, "LOGISTICS_VERIFICATION_UNAVAILABLE");
  }
}

function taipeiTradeDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}/${value("month")}/${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

export async function verifyTestLogistics(
  userId: string,
  accountSessionId: string | undefined,
  input: LogisticsVerificationInput,
): Promise<ServiceResponse<VerificationResult>> {
  let release: (() => void) | undefined;
  try {
    if (accountSessionId) throw new CustomError("App user required", 403);
    await requireLogisticsVerificationUser(userId);
    const isB2C = input.type === "B2C";
    const hashKey = ecpay.getTestLogisticHashKey(false, isB2C);
    const hashIV = ecpay.getTestLogisticHashIV(false, isB2C);
    const parameters: Record<string, string> = {
      MerchantID: ecpay.getTestLogisticMerchantID(false, isB2C),
      MerchantTradeNo: `V${randomBytes(9).toString("hex")}`,
      MerchantTradeDate: taipeiTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType: isB2C ? "UNIMART" : "UNIMARTC2C",
      GoodsName: "測試商品", GoodsAmount: "300", CollectionAmount: "300", IsCollection: "N",
      SenderName: "測試寄件人", ReceiverStoreID: "131386",
      ...(isB2C ? {} : { SenderCellPhone: "0912345678" }),
      ReceiverName: input.ReceiverName, ReceiverCellPhone: input.ReceiverCellPhone,
      ReceiverEmail: input.ReceiverEmail,
      ServerReplyURL: callbackUrl(),
    };
    const verificationId = randomUUID();
    const CheckMacValue = ecpay.generateCheckValue(parameters, hashKey, hashIV, "md5");
    release = acquire(userId);
    const response = await logisticsVerificationClient.post(TEST_URL,
      new URLSearchParams({ ...parameters, CheckMacValue }).toString(),
      { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) invalidResponse();
    const result = parseLogisticsVerificationResponse(response.data, parameters, hashKey, hashIV);
    return { success: true, data: {
      verificationId, ...result,
      code: result.success ? "VALIDATED" : "PROVIDER_REJECTED",
      message: result.success ? "物流資料驗證成功" : "綠界未接受測試物流資料，請確認收件資訊或稍後重試",
    } };
  } catch (error) {
    if (error instanceof CustomError) return handleServiceError(error);
    // Never return/log Axios config, credentials, receiver data or raw provider content.
    if (axios.isAxiosError(error)) {
      const timedOut = ["ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED"].includes(error.code ?? "");
      return handleServiceError(new CustomError(
        timedOut ? "物流驗證逾時，結果未確認，請稍後重試" : "暫時無法連線物流驗證服務，請稍後重試",
        timedOut ? 504 : 502,
        timedOut ? "LOGISTICS_VERIFICATION_TIMEOUT" : "LOGISTICS_VERIFICATION_PROVIDER_ERROR",
      ));
    }
    return handleServiceError(new CustomError("物流驗證暫時無法完成", 500, "LOGISTICS_VERIFICATION_INTERNAL_ERROR"));
  } finally {
    release?.();
  }
}
