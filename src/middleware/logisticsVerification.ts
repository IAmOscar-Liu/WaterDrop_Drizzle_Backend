import { z } from "zod";
import { getEcpayLength, hasEmoji, hasSpecialChars } from "../lib/ecpayValidation";

export const logisticsVerificationBody = z.object({
  type: z.enum(["B2C", "C2C"]).default("C2C"),
  ReceiverName: z.string().min(1).max(10)
    .refine((value) => value.trim().length > 0, "收件人姓名不可為空白")
    .refine((value) => getEcpayLength(value) >= 4 && getEcpayLength(value) <= 10,
      "收件人姓名須為 4–10 字元（中文字佔 2 字元）")
    .refine((value) => !hasEmoji(value) && !hasSpecialChars(value) && !/[0-9\u0000-\u001f\u007f]/.test(value),
      "收件人姓名不可包含數字、表情符號或特殊字元"),
  ReceiverCellPhone: z.string().regex(/^09\d{8}$/, "收件人手機須為 09 開頭的 10 碼數字"),
  ReceiverEmail: z.email().max(50),
}).strict();

export const logisticsVerificationQuery = z.object({}).strict();
export type LogisticsVerificationInput = z.infer<typeof logisticsVerificationBody>;
