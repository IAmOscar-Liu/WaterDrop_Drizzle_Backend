import admin from "./firebase_admin";
import { Message, MulticastMessage } from "firebase-admin/messaging";

/**
 * Sends a push notification to a single device.
 * @param fcmToken The FCM token of the device.
 */
export async function sendPushNotification(message: Message) {
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
export async function sendMulticastPushNotification(message: MulticastMessage) {
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
      `Successfully sent multicast message to ${response.successCount} devices.`
    );

    // if (response.failureCount > 0) {
    //   console.error("Failed to send to some devices:");
    //   response.responses.forEach((resp, idx) => {
    //     if (!resp.success) {
    //       console.error(`  - Token ${message.tokens[idx]}: ${resp.error}`);
    //     }
    //   });
    // }
  } catch (e) {
    console.error("Error sending multicast push notification:", e);
  }
}
