import { z } from "zod";
import { moneyToMinorUnits } from "../../lib/money";
import {
  dateRangeQuery,
  idParams,
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  positiveCurrencyAmount,
  requireAtLeastOneField,
  uuid,
} from "./common";

const advertisementStatus = z.enum([
  "active",
  "paused",
  "depleted",
  "archived",
]);

const advertisementListFilters = {
  sellerId: uuid.optional(),
  status: advertisementStatus.optional(),
  productStatus: z.enum(["active", "inactive"]).optional(),
  search: z.string().trim().max(200).optional(),
};

const decimalMoney = z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/);
const withdrawalBase = {
  expectedBalance: decimalMoney,
  confirmationToken: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
};

const autoRefillAmount = positiveCurrencyAmount.refine(
  value => moneyToMinorUnits(value) >= BigInt(10000) && moneyToMinorUnits(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  "Refill amount must be between NT$100 and NT$90,071,992,547,409.91",
);

export const advertisementValidation = {
  batchAutoRefillBody: z.object({ advertisementIds: z.array(uuid).min(1).max(100), enabled: z.boolean(), amount: autoRefillAmount.optional() }).strict().refine(v => new Set(v.advertisementIds).size === v.advertisementIds.length, "Duplicate advertisements"),
  batchFundingBody: z.object({ items: z.array(z.object({ advertisementId: uuid, amount: positiveCurrencyAmount }).strict()).min(1).max(100), idempotencyKey: z.string().min(8).max(120) }).strict().refine(v => new Set(v.items.map(i => i.advertisementId)).size === v.items.length, "Duplicate advertisements"),
  batchStatusBody: z.object({ advertisementIds: z.array(uuid).min(1).max(100), status: z.enum(["active", "paused"]) }).strict().refine(v => new Set(v.advertisementIds).size === v.advertisementIds.length, "Duplicate advertisements"),
  autoRefillBody: z.object({ enabled: z.boolean(), amount: autoRefillAmount.optional() }).strict(),
  withdrawalBody: z.discriminatedUnion("mode", [
    z.object({ ...withdrawalBase, mode: z.literal("all") }).strict(),
    z.object({ ...withdrawalBase, mode: z.literal("amount"), amount: decimalMoney.refine((v) => Number(v) > 0) }).strict(),
  ]),
  listQuery: paginationQuery.extend(advertisementListFilters),
  statusCountsQuery: z.object(advertisementListFilters).omit({ status: true }).strict(),
  idParams,
  createBody: z.object({
    productId: uuid,
    title: nonEmptyString,
    description: z.string().optional().nullable(),
    video_url: z.url(),
  }),
  updateBody: requireAtLeastOneField(
    z.object({
      title: nonEmptyString.optional(),
      description: z.string().optional().nullable(),
      video_url: z.url().optional(),
    }),
  ),
  viewCountListQuery: paginationQuery.merge(dateRangeQuery),
  platformViewCountListQuery: paginationQuery.merge(dateRangeQuery).extend({
    sellerId: uuid.optional(),
  }),
  metricsQuery: paginationQuery.merge(dateRangeQuery).extend({
    ...advertisementListFilters,
    productId: uuid.optional(),
  }),
  productDashboardParams: z.object({ productId: uuid }),
  productDashboardQuery: dateRangeQuery,
  viewCountQuery: dateRangeQuery,
  budgetBody: z.object({
    operation: z.enum(["increase", "decrease"]),
    amount: positiveCurrencyAmount,
    idempotencyKey: z.string().trim().min(8).max(200),
    metadata: jsonObject.optional(),
  }),
  statusBody: z.object({
    status: advertisementStatus,
  }),
  balanceTransferBody: z.object({
    destinationAdvertisementId: uuid,
    amount: nonNegativeNumber.gt(0).refine((v) => Number.isSafeInteger(Math.round(v * 100)) && Math.abs(Number(v.toFixed(2)) - v) <= Number.EPSILON * Math.max(1, v) * 4, "Use a positive currency amount with at most two decimal places"),
    idempotencyKey: z.string().min(8).max(200),
  }),
};
