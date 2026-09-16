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

export const advertisementValidation = {
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
  depositBody: z.object({
    amount: positiveCurrencyAmount,
    idempotencyKey: z.string().trim().min(8).max(200),
    metadata: jsonObject.optional(),
  }),
  budgetBody: z.object({
    operation: z.enum(["increase", "decrease", "set"]),
    amount: positiveCurrencyAmount,
    idempotencyKey: z.string().trim().min(8).max(200),
    metadata: jsonObject.optional(),
  }),
  statusBody: z.object({
    status: advertisementStatus,
  }),
  balanceTransferBody: z.object({
    destinationAdvertisementId: uuid,
    amount: nonNegativeNumber.gt(0),
    idempotencyKey: z.string().min(8).max(200),
  }),
};
