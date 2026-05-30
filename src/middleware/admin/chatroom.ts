import { z } from "zod";
import {
  dateRangeQuery,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  uuid,
} from "./common";

const chatRoomStatus = z.enum(["active", "inactive"]);
const adminMessageSender = z.enum(["admin", "seller"]);

export const chatroomValidation = {
  listQuery: paginationQuery.extend({
    productId: uuid.optional(),
    supportOnly: z.enum(["true", "false"]).optional(),
    status: chatRoomStatus.optional(),
  }),
  historyParams: z.object({
    chatRoomId: uuid,
  }),
  historyQuery: paginationQuery.merge(dateRangeQuery),
  messageParams: z.object({
    chatRoomId: uuid,
  }),
  sendMessageBody: z
    .object({
      senderType: adminMessageSender,
      content: z.string().optional(),
      attachments: z
        .array(
          z.object({
            url: nonEmptyString,
            mimeType: z.string().optional().nullable(),
            name: z.string().optional().nullable(),
            size: nonNegativeNumber.optional().nullable(),
          }),
        )
        .optional()
        .nullable(),
    })
    .refine(
      (value) =>
        Boolean(value.content && value.content.trim()) ||
        Boolean(value.attachments?.length),
      "content or attachments is required",
    ),
  readBody: z.object({
    readerType: adminMessageSender,
  }),
};
