import { z } from "zod";
import {
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  positiveInt,
  positiveNumber,
  uuid,
} from "./admin/common";

export const refundValidation = {
  createBody: z.object({
    orderItemId: uuid,
    accountId: uuid,
    quantity: positiveInt,
    reason: nonEmptyString.optional(),
    note: z.string().optional().nullable(),
    refundAmount: positiveNumber.optional(),
    extraRefundAmount: nonNegativeNumber.optional(),
    metadata: jsonObject.optional().nullable(),
  }),
};
