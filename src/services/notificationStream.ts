import { createUserEventStream } from "../lib/userEventStream";
import { encodeNotificationCursor } from "../lib/notificationCursor";
import { canDeliverNotificationEvent, openNotificationFeed, readNotificationFeed } from "../repository/notificationSync";

export const startNotificationStream = createUserEventStream({
  name: "Notification", limitCode: "NOTIFICATION_STREAM_LIMIT",
  openFeed: openNotificationFeed, readFeed: readNotificationFeed, canDeliver: canDeliverNotificationEvent,
  encodeCursor: (userId, sequence) => encodeNotificationCursor({ kind: "feed", userId, sequence }),
});
