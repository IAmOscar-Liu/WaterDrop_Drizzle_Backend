import { z } from "zod";
import { chatroomValidation } from "./chatroom";
import { dateRangeQuery, nonEmptyString, nonNegativeNumber, uuid } from "./common";

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const adminChatroomSyncValidation = {
  eventsQuery: z.object({}).strict(),
  listQuery: pageQuery.extend({
    productId: uuid.optional(), productVariantId: uuid.optional(),
    supportOnly: z.enum(["true", "false"]).optional(),
    snapshot: z.enum(["true", "false"]).optional(),
    listSnapshot: z.string().min(1).max(4096).optional(),
  }).strict().refine((q) => !(q.snapshot === "true" && q.listSnapshot), "snapshot and listSnapshot cannot coexist")
    .refine((q) => !(q.supportOnly === "true" && (q.productId || q.productVariantId)), "supportOnly cannot be combined with product filters"),
  roomParams: chatroomValidation.messageParams,
  historyQuery: pageQuery.merge(dateRangeQuery).extend({ before: z.string().min(1).max(2048).optional() })
    .refine((q) => !(q.before && (q.page !== undefined || q.startAt !== undefined || q.endAt !== undefined)), "before cannot be combined with page or date filters"),
  sendBody: z.object({
    senderType: z.enum(["admin", "seller"]).optional(),
    content: z.string().optional(),
    clientMessageId: uuid.optional(),
    attachments: z.array(z.object({ url: nonEmptyString, name: z.string().nullable().optional(),
      mimeType: z.string().nullable().optional(), size: nonNegativeNumber.nullable().optional() })).nullable().optional(),
  }).refine((body) => Boolean(body.content?.trim() || body.attachments?.length), "content or attachments is required"),
  readBody: z.object({ readerType: z.enum(["admin", "seller"]).optional() }),
};
