import { z } from "zod";
import {
  dateTimeString,
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  positiveInt,
  requireAtLeastOneField,
  uuid,
} from "./common";

const refundStatus = z.enum([
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
  createBody: z.object({
    orderItemId: uuid,
    quantity: positiveInt,
    reason: nonEmptyString.optional(),
    note: z.string().optional().nullable(),
    refundAmount: nonNegativeNumber.optional(),
    extraRefundAmount: nonNegativeNumber.optional(),
    metadata: jsonObject.optional().nullable(),
  }),
  updateStatusBody: requireAtLeastOneField(
    z.object({
      status: refundStatus.optional(),
      reason: nonEmptyString.optional(),
      note: z.string().optional().nullable(),
      extraRefundAmount: nonNegativeNumber.optional(),
    }),
  ),
};
