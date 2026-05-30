import { z } from "zod";
import {
  dateRangeQuery,
  idParams,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  requireAtLeastOneField,
  uuid,
  jsonObject,
} from "./common";

const productStatus = z.enum(["active", "inactive"]);
const productType = z.enum(["normal", "refrigeration", "virtual"]);

const productWriteBody = z.object({
  sellerId: uuid.optional(),
  name: nonEmptyString.optional(),
  description: nonEmptyString.optional(),
  avatar: z.string().optional().nullable(),
  price: nonNegativeNumber.optional(),
  stock: z.coerce.number().int().min(0).optional(),
  type: productType.optional(),
  allowHomeDelivery: z.coerce.boolean().optional(),
  images: z.array(z.string()).optional().nullable(),
  categoryIds: z.array(uuid).optional(),
  status: productStatus.optional(),
  sku: z.string().optional().nullable(),
  metadata: jsonObject.optional().nullable(),
});

export const productValidation = {
  categoryCreateBody: z.object({
    name: nonEmptyString,
  }),
  listQuery: paginationQuery.extend({
    categoryId: uuid.optional(),
    search: z.string().optional(),
    status: productStatus.optional(),
    minPrice: nonNegativeNumber.optional(),
    maxPrice: nonNegativeNumber.optional(),
  }),
  idParams,
  createBody: productWriteBody.extend({
    sellerId: uuid,
    name: nonEmptyString,
    description: nonEmptyString,
    price: nonNegativeNumber,
    stock: z.coerce.number().int().min(0),
  }),
  updateBody: requireAtLeastOneField(productWriteBody),
  salesSummaryQuery: dateRangeQuery,
};
