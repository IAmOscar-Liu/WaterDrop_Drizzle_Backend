import { z } from "zod";
import { nonEmptyString, uuid } from "./common";

const notificationPayload = {
  notification: z
    .object({
      title: nonEmptyString.optional(),
      body: nonEmptyString.optional(),
    })
    .optional(),
  data: z.record(z.string(), z.string()).optional(),
};

export const systemValidation = {
  sendNotificationBody: z.object({
    tokens: z.array(nonEmptyString).min(1).max(500),
    ...notificationPayload,
  }),
  sendAppNotificationBody: z
    .object({
      userIds: z.array(uuid).min(1).max(500).optional(),
      groupIds: z.array(uuid).min(1).max(100).optional(),
      ...notificationPayload,
    })
    .refine(
      ({ userIds, groupIds }) =>
        (userIds?.length ?? 0) > 0 || (groupIds?.length ?? 0) > 0,
      "At least one userId or groupId is required",
    )
    .refine(
      ({ notification, data }) => notification !== undefined || data !== undefined,
      "notification or data is required",
    ),
};
