import { z } from "zod";
import { dateRangeQuery, uuid } from "./common";

const shared = dateRangeQuery.extend({
  timezone: z.string().trim().min(1).optional(),
  sellerId: uuid.optional(),
});

const date = z.iso.date();
const internal = z.object({ report: z.literal("internal"), startDate: date, endDate: date }).strict();
const validRange = (v: { startDate: string; endDate: string }) => {
  const days = (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 + 1;
  return days >= 1 && days <= 366;
};
const legacy = shared.extend({ report: z.never().optional() });
export const dashboardValidation = {
  kpiQuery: z.union([internal.refine(validRange, "Date range must contain 1 to 366 days"), legacy]),
  filtersQuery: shared,
  timeSeriesQuery: z.union([internal.extend({ dataset: z.enum(["users", "coin-flows", "ad-finance"]) }).strict().refine(validRange, "Date range must contain 1 to 366 days"), legacy.extend({
    metric: z.enum(["sales", "orders", "refunds", "adViews", "adSpend"]),
    interval: z.enum(["day", "week", "month"]).default("day"),
  })]),
  activitiesQuery: shared.extend({
    cursor: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};
