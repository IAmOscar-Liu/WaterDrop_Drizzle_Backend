import { z } from "zod";
import { dateRangeQuery, paginationQuery, uuid } from "./common";
const money=z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/);
const amounts={cash:money.default("0"),coins:money.default("0")};
const paging= paginationQuery.extend({limit:z.coerce.number().int().min(1).max(100).optional()});
const key=z.string().trim().min(8).max(120);
export const sellerEarningsValidation={
  shippingReversal:z.object({shipmentId:uuid,evidence:z.string().trim().min(1).max(2000)}).strict(),
  query:paging.merge(dateRangeQuery).extend({sellerId:uuid.optional()}),
  sellerParams:z.object({sellerId:uuid}),
  requestParams:z.object({id:uuid}),
  adjustment:z.object({...amounts,direction:z.enum(["increase","decrease"]),reason:z.string().trim().min(1).max(2000),idempotencyKey:key}).strict().refine(v=>Number(v.cash)+Number(v.coins)>0,"Positive total required"),
  request:z.object({...amounts,wallet:z.enum(["advertising","revenue"]),direction:z.enum(["deposit","withdrawal"]),idempotencyKey:key,reason:z.string().max(2000).optional()}).strict(),
  review:z.object({action:z.enum(["processing","completed","cancelled","rejected"]),cash:money.optional(),coins:money.optional(),reason:z.string().trim().min(1).max(2000)}).strict(),
  requestQuery:paging.extend({sellerId:uuid.optional(),status:z.enum(["pending","processing","completed","cancelled","rejected"]).optional()}),
};
