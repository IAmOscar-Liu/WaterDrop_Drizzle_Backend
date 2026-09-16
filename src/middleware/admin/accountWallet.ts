import { z } from "zod";

import {
  dateRangeQuery,
  jsonObject,
  paginationQuery,
  positiveCurrencyAmount,
  uuid,
} from "./common";

const transactionType = z.enum([
  "legacy_opening_balance",
  "admin_credit",
  "advertisement_funding_debit",
]);

export const accountWalletValidation = {
  accountIdParams: z.object({ accountId: uuid }),
  transactionListQuery: paginationQuery.merge(dateRangeQuery).extend({
    type: transactionType.optional(),
  }),
  summaryQuery: dateRangeQuery,
  creditBody: z.object({
    amount: positiveCurrencyAmount,
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(1).max(500).optional(),
    externalReference: z.string().trim().min(1).max(200).optional(),
    metadata: jsonObject.optional(),
  }),
};
