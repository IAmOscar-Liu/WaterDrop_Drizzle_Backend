import { z } from "zod";
import {
  dateRangeQuery,
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  uuid,
} from "./admin/common";

const userMessageSender = z.enum(["user"]);

const attachment = z.object({
  url: nonEmptyString,
  mimeType: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  size: nonNegativeNumber.optional().nullable(),
});

export const chatroomValidation = {
  createBody: z
    .object({
      accountId: uuid.optional().nullable(),
      productId: uuid.optional().nullable(),
      productVariantId: uuid.optional().nullable(),
      orderId: uuid.optional().nullable(),
    })
    .refine(
      (value) => !value.productId || Boolean(value.productVariantId),
      "productVariantId is required when productId is provided",
    )
    .refine(
      (value) => Boolean(value.productId) || !value.productVariantId,
      "productId is required when productVariantId is provided",
    ),
  chatRoomIdParams: z.object({
    chatRoomId: uuid,
  }),
  historyQuery: paginationQuery.merge(dateRangeQuery),
  listQuery: paginationQuery,
  sendMessageBody: z
    .object({
      senderType: userMessageSender,
      content: z.string().optional(),
      attachments: z.array(attachment).optional().nullable(),
      metadata: jsonObject.optional().nullable(),
    })
    .refine(
      (value) =>
        Boolean(value.content && value.content.trim()) ||
        Boolean(value.attachments?.length),
      "content or attachments is required",
    ),
  readBody: z.object({
    readerType: userMessageSender,
  }),
};
