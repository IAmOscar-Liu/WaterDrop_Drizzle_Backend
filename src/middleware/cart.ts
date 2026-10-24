import { z } from "zod";

const uuid = z.uuid().transform((value) => value.toLowerCase());

export const validateCheckoutBody = z.object({
  items: z.array(z.object({
    cartItemId: uuid,
    productVariantId: uuid,
    quantity: z.number().int().min(1).max(2_147_483_647),
    expectedUnitPrice: z.number().finite().nonnegative(),
  }).strict()).min(1).max(4)
    .refine((items) => new Set(items.map((item) => item.cartItemId)).size === items.length,
      "cartItemId must be unique")
    .refine((items) => new Set(items.map((item) => item.productVariantId)).size === items.length,
      "productVariantId must be unique"),
}).strict();
