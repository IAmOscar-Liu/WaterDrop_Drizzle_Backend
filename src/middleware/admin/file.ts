import { z } from "zod";

export const fileValidation = {
  uploadBody: z.object({
    path: z.string().optional(),
  }),
};
