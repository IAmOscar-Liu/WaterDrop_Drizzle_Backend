import { z } from "zod";

const orderDate = z.iso.datetime({
  offset: true,
  error: "Use a valid ISO 8601 timestamp with an explicit timezone (Z or ±HH:MM).",
}).transform((value) => {
  // Normalize the timezone without truncating Flutter's fractional seconds
  // to JavaScript Date's millisecond precision.
  const fraction = value.match(/\.(\d+)/)?.[1].replace(/0+$/, "") ?? "";
  return new Date(value).toISOString().slice(0, 19) +
    (fraction ? `.${fraction}` : "") + "Z";
});

export const orderValidation = {
  listQuery: z
    .object({
      startDate: orderDate.optional(),
      endDate: orderDate.optional(),
    })
    // Preserve the existing pagination and sort handling.
    .passthrough()
    .superRefine(({ startDate, endDate }, ctx) => {
      if (
        startDate !== undefined &&
        endDate !== undefined &&
        // UTC timestamps sort by instant after removing the terminal Z.
        startDate.slice(0, -1) >= endDate.slice(0, -1)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "endDate must be later than startDate.",
        });
      }
    }),
};
