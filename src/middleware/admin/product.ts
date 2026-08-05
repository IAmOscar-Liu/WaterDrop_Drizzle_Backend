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
const variantName = z.string().trim().min(1).optional().nullable();

const productVariantCreateBody = z.object({
  name: variantName,
  sku: z.string().optional().nullable(),
  optionValues: jsonObject.default({}),
  stock: z.coerce.number().int().min(0),
  sortOrder: z.coerce.number().int().min(0).optional(),
  status: productStatus.optional(),
  metadata: jsonObject.optional().nullable(),
});

const productVariantUpdateBody = z
  .object({
    id: uuid.optional(),
    name: variantName,
    sku: z.string().optional().nullable(),
    optionValues: jsonObject.optional(),
    stock: z.coerce.number().int().min(0).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    status: productStatus.optional(),
    metadata: jsonObject.optional().nullable(),
  })
  .refine(
    (variant) =>
      variant.id ||
      (variant.optionValues !== undefined && variant.stock !== undefined),
    "New variants require optionValues and stock",
  );

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
  variants: z.array(productVariantUpdateBody).optional(),
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
    variants: z.array(productVariantCreateBody).optional(),
  })
    .refine(
      (body) => body.stock !== undefined || (body.variants?.length ?? 0) > 0,
      "Either stock or variants is required",
    )
    .refine((body) => {
      const variants = body.variants ?? [];
      const hasCustomVariant =
        variants.length > 1 ||
        variants.some((variant) => !!variant.name?.trim());

      return (
        !hasCustomVariant ||
        variants.every((variant) => !!variant.name?.trim())
      );
    }, "Custom variants require every variant to have a name"),
  updateBody: requireAtLeastOneField(productWriteBody),
  salesSummaryQuery: dateRangeQuery,
};
