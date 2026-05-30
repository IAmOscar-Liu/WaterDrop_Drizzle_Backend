import { z } from "zod";
import { nonEmptyString } from "./common";

export const systemValidation = {
  sendNotificationBody: z.object({
    tokens: z.array(nonEmptyString).min(1).max(500),
    notification: z
      .object({
        title: nonEmptyString.optional(),
        body: nonEmptyString.optional(),
      })
      .optional(),
    data: z.record(z.string(), z.string()).optional(),
  }),
};
