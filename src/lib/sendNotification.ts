import admin from "./firebase_admin";
import { BatchResponse, Message, MulticastMessage } from "firebase-admin/messaging";
import db from "../lib/initDB";
import * as schema from "../db/schema";
import { inArray } from "drizzle-orm";

/**
 * Sends a push notification to a single device.
 * @param fcmToken The FCM token of the device.
 */
export async function sendPushNotification(message: Message) {
  if ("token" in message) {
    const { token, ...payload } = message;
    await sendMulticastPushNotification({ ...payload, tokens: [token] });
    return;
  }
  try {
    // const message: Message = {
    //   token: fcmToken,
    //   notification: {
    //     title: "FCM v1 Test",
    //     body: "Hello from your Firebase server!",
    //   },
    //   data: {
    //     customKey: "customValue",
    //   },
    // };

    const response = await admin.messaging().send(message);
    console.log("Successfully sent message:", response);
  } catch (e) {
    console.error("Error sending push notification:", e);
  }
}

/**
 * Sends the same push notification to multiple devices.
 * @param fcmTokens An array of FCM tokens for the target devices.
 */
export async function sendRawMulticastPushNotification(message: MulticastMessage): Promise<BatchResponse | void> {
  if (message.tokens.length === 0) {
    console.log("No FCM tokens provided to sendMulticastPushNotification.");
    return;
  }

  try {
    // The MulticastMessage interface is used for sending to multiple tokens.
    // const message: MulticastMessage = {
    //   tokens: fcmTokens,
    //   notification: {
    //     title: "Multicast Test",
    //     body: "This is a message for multiple devices!",
    //   },
    //   data: {
    //     customKey: "customValue",
    //   },
    //   // You can also include common data, and platform-specific overrides
    //   // data: {
    //   //   'customKey': 'customValue'
    //   // },
    //   // apns: { ... },
    //   // android: { ... },
    // };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `Successfully sent multicast message to ${response.successCount} devices.`,
    );

    if (response.failureCount > 0) {
      console.error("Failed to send to some devices:");
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`  - Device index ${idx}: ${resp.error?.code ?? "unknown_error"}`);

          if (
            resp.error?.code === "messaging/invalid-registration-token" ||
            resp.error?.code === "messaging/registration-token-not-registered"
          ) {
            invalidTokens.push(message.tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await db
          .delete(schema.deviceTokenTable)
          .where(inArray(schema.deviceTokenTable.fcmToken, invalidTokens));
      }
    }
    return response;
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? e.code : "unknown_error";
    console.error("Error sending multicast push notification:", code);
  }
}

// Late import avoids a transport/orchestration initialization cycle.
export async function sendMulticastPushNotification(message: MulticastMessage, recipientUserId?: string): Promise<BatchResponse | void> {
  const { sendBadgeAwareMulticast, sendUserPush } = await import("../services/appBadgePush");
  if (!recipientUserId) return sendBadgeAwareMulticast(message);
  try {
    const { tokens, ...payload } = message;
    const result = await sendUserPush(recipientUserId, payload, tokens);
    return { responses: result.responses, successCount: result.responses.filter(r => r.success).length,
      failureCount: result.responses.filter(r => !r.success).length };
  } catch { console.error("[badge-push] User push failed; pending badge work remains available."); }
}
