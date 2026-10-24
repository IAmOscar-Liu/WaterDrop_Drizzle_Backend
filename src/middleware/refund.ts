import { z } from "zod";
import { nonEmptyString, positiveInt, uuid } from "./admin/common";
export const refundValidation = {
  createBody: z.object({
    orderItemId: uuid,
    accountId: uuid.optional(), // Legacy seller-recipient hint, checked against the product.
    clientRequestId: uuid.optional(),
    quantity: positiveInt,
    reason: nonEmptyString.max(2000).optional(),
    note: z.string().max(5000).nullable().optional(),
  }).strict(),
};
