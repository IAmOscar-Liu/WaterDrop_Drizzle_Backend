import { z } from "zod";
import { dateRangeQuery, uuid } from "./common";

const shared = dateRangeQuery.extend({
  timezone: z.string().trim().min(1).optional(),
  sellerId: uuid.optional(),
});

export const dashboardValidation = {
  filtersQuery: shared,
  timeSeriesQuery: shared.extend({
    metric: z.enum(["sales", "orders", "refunds", "adViews", "adSpend"]),
    interval: z.enum(["day", "week", "month"]).default("day"),
  }),
  activitiesQuery: shared.extend({
    cursor: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};
