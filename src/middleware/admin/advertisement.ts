import { z } from "zod";
import {
  dateRangeQuery,
  idParams,
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
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
  listQuery: paginationQuery,
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
  viewCountQuery: dateRangeQuery,
  depositBody: z.object({
    amount: nonNegativeNumber.gt(0),
    metadata: jsonObject.optional(),
  }),
  statusBody: z.object({
    status: advertisementStatus,
  }),
};
