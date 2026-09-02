import { z } from "zod";

export const uuid = z.uuid();
export const nonEmptyString = z.string().trim().min(1);
export const positiveInt = z.coerce.number().int().positive();
export const positiveNumber = z.coerce.number().positive();
export const nonNegativeNumber = z.coerce.number().min(0);
export const jsonObject = z.record(z.string(), z.any());
export const dateTimeString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date-time");

export const paginationQuery = z.object({
  page: positiveInt.optional(),
  limit: positiveInt.optional(),
});

export const idParams = z.object({
  id: uuid,
});

export const dateRangeQuery = z.object({
  startAt: dateTimeString.optional(),
  endAt: dateTimeString.optional(),
});

export function requireAtLeastOneField<T extends z.ZodObject<any>>(schema: T) {
  return schema.refine(
    (value) => Object.keys(value).length > 0,
    "At least one valid field is required",
  );
}

export function requireAtLeastOneUpdateField<T extends z.ZodObject<any>>(
  schema: T,
  ignoredKeys: string[] = [],
) {
  return schema.refine(
    (value) => Object.keys(value).some((key) => !ignoredKeys.includes(key)),
    "At least one valid update field is required",
  );
}
