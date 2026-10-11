import { z } from "zod";
import { notificationTypeEnum } from "../db/schema";

const booleanQuery = z.enum(["true", "false"]).optional();
export const notificationIdParams = z.object({ id: z.uuid() });
export const notificationBatchBody = z.object({ notificationIds: z.array(z.uuid()).min(1).max(200)
  .refine((ids) => new Set(ids).size === ids.length, "notificationIds must be unique") });
export const notificationSyncListQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().max(500).optional(),
  types: z.union([z.enum(notificationTypeEnum.enumValues), z.array(z.enum(notificationTypeEnum.enumValues)).max(6)]).optional(),
  onlyUnread: booleanQuery,
  snapshot: booleanQuery,
  listSnapshot: z.string().min(1).max(2048).optional(),
}).strict().refine((q) => !(q.snapshot === "true" && q.listSnapshot), "snapshot and listSnapshot cannot be combined");
