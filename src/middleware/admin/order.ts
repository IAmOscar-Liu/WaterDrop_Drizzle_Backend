import { z } from "zod";
import { dateTimeString, idParams, paginationQuery, uuid } from "./common";

const orderStatus = z.enum([
  "pending",
  "payment-processing",
  "paid",
  "failed",
  "expired",
  "canceled",
]);
const sortOrder = z.enum(["asc", "desc"]);

export const orderValidation = {
  listQuery: paginationQuery.extend({
    userId: uuid.optional(),
    status: orderStatus.optional(),
    order: sortOrder.optional(),
    startDate: dateTimeString.optional(),
    endDate: dateTimeString.optional(),
  }),
  idParams,
  merchantTradeNoParams: z.object({
    merchantTradeNo: z.string().min(4),
  }),
};
