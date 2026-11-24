import { z } from "zod";
import { normalizeMoney } from "../../lib/money";

import {
  dateRangeQuery,
  jsonObject,
  paginationQuery,
  positiveCurrencyAmount,
  uuid,
} from "./common";

const transactionType = z.enum([
  "seller_deposit",
  "seller_withdrawal",
  "legacy_opening_balance",
  "admin_credit",
  "advertisement_funding_debit",
  "advertisement_budget_return",
]);

export const accountWalletValidation = {
  accountIdParams: z.object({ accountId: uuid }),
  autoRefillSettingsBody: z.object({
    autoRefillStopThreshold: z.union([z.string(), z.number()]).refine((value) => {
      try { normalizeMoney(value); return true; } catch { return false; }
    }, "Threshold must be non-negative with at most two decimal places").transform(normalizeMoney),
  }).strict(),
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
