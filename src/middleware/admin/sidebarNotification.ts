import { z } from "zod";
import { uuid } from "./common";

export const sidebarNotificationValidation = {
  summaryQuery: z.object({ sellerId: uuid.optional() }),
  sectionParams: z.object({
    section: z.enum([
      "orders",
      "deliveries",
      "refunds",
      "advertisements",
      "chatrooms",
    ]),
  }),
  seenBody: z.object({
    sellerId: uuid.optional(),
    seenAt: z.iso.datetime().optional(),
  }),
};
