import { z } from "zod";
import {
  dateTimeString,
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  positiveInt,
  positiveNumber,
  requireAtLeastOneField,
  uuid,
} from "./common";

const refundStatus = z.enum([
  "rejected",
  "pending",
  "processing",
  "completed",
  "cancelled",
]);

export const refundValidation = {
  listQuery: paginationQuery.extend({
    userId: uuid.optional(),
    productId: uuid.optional(),
    merchantTradeNo: z.string().optional(),
    startAt: dateTimeString.optional(),
    endAt: dateTimeString.optional(),
    status: refundStatus.optional(),
  }),
  refundItemIdParams: z.object({
    refundItemId: uuid,
  }),
  updateStatusBody: requireAtLeastOneField(
    z.object({
      rejectionReason: nonEmptyString.max(2000).optional(),
      agreement: z.object({ confirmed: z.literal(true), note: nonEmptyString.max(2000) }).strict().optional(),
      status: refundStatus.optional(),
      quantity: positiveInt.optional(),
      refundAmount: positiveNumber.optional(),
      reason: nonEmptyString.optional(),
      note: z.string().optional().nullable(),
      message: nonEmptyString.optional(),
      extraRefundAmount: nonNegativeNumber.optional(),
      metadata: jsonObject.optional().nullable(),
    }).strict(),
  ),
};
