import { z } from "zod";

// Device identifiers are opaque: reject blanks without changing their value.
const deviceSelector = z.string().min(1).refine(value => value.trim().length > 0, "Must not be blank");

export const clearDeviceTokenBody = z.object({
  deviceId: deviceSelector.optional(),
  fcmToken: deviceSelector.optional(),
}).strict().refine(value => value.deviceId !== undefined || value.fcmToken !== undefined,
  "Provide deviceId or fcmToken for the device being removed");
