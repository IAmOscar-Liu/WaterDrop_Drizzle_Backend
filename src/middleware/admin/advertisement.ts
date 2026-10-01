import { z } from "zod";
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

const decimalMoney = z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/);
const withdrawalBase = {
  expectedBalance: decimalMoney,
  confirmationToken: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
};

export const advertisementValidation = {
  withdrawalBody: z.discriminatedUnion("mode", [
    z.object({ ...withdrawalBase, mode: z.literal("all") }).strict(),
    z.object({ ...withdrawalBase, mode: z.literal("amount"), amount: decimalMoney.refine((v) => Number(v) > 0) }).strict(),
  ]),
  listQuery: paginationQuery.extend({ sellerId: uuid.optional() }),
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
    sellerId: uuid.optional(),
    productId: uuid.optional(),
    status: advertisementStatus.optional(),
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
