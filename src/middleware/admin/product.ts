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
  price: nonNegativeNumber,
  images: z.array(z.string()).optional().nullable(),
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
    price: nonNegativeNumber.optional(),
    images: z.array(z.string()).optional().nullable(),
    optionValues: jsonObject.optional(),
    stock: z.coerce.number().int().min(0).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    status: productStatus.optional(),
    metadata: jsonObject.optional().nullable(),
  })
  .refine(
    (variant) =>
      variant.id ||
      (variant.price !== undefined &&
        variant.optionValues !== undefined &&
        variant.stock !== undefined),
    "New variants require price, optionValues, and stock",
  );

const productWriteBody = z.object({
  sellerId: uuid.optional(),
  name: nonEmptyString.optional(),
  description: nonEmptyString.optional(),
  avatar: z.string().optional().nullable(),
  type: productType.optional(),
  allowHomeDelivery: z.coerce.boolean().optional(),
  images: z.array(z.string()).optional().nullable(),
  categoryIds: z.array(uuid).optional(),
  status: productStatus.optional(),
  metadata: jsonObject.optional().nullable(),
  variants: z.array(productVariantUpdateBody).optional(),
});

function hasVariantName(variant: { name?: string | null }) {
  return typeof variant.name === "string" && variant.name.trim().length > 0;
}

function isValidVariantMode(
  variants: { name?: string | null; status?: "active" | "inactive" }[],
) {
  const unnamedVariants = variants.filter((variant) => !hasVariantName(variant));
  if (unnamedVariants.length > 1) {
    return false;
  }

  const activeVariants = variants.filter(
    (variant) => (variant.status ?? "active") === "active",
  );
  const isSimpleMode =
    activeVariants.length === 1 && !hasVariantName(activeVariants[0]);
  const isVariantMode =
    activeVariants.length >= 2 && activeVariants.every(hasVariantName);

  return isSimpleMode || isVariantMode;
}

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
    variants: z.array(productVariantCreateBody).min(1),
  })
    .refine(
      (body) => isValidVariantMode(body.variants ?? []),
      "Use exactly one active unnamed default variant, or at least two active named variants",
    ),
  updateBody: requireAtLeastOneField(productWriteBody),
  salesSummaryQuery: dateRangeQuery,
};
