import { sendMulticastPushNotification } from "../lib/sendNotification";
import { getFcmTokensInUserIds } from "../repository/user";

type ChatPushInput = {
  room: { id: string; userId: string; product?: { name: string } | null };
  senderType: "user" | "admin" | "seller";
  content?: string | null;
  attachments?: readonly unknown[];
};

// Call only after the message transaction commits, with the authorized room
// (or room context obtained by a trusted server workflow).
export async function sendChatMessagePush({ room, senderType, content, attachments }: ChatPushInput): Promise<void> {
  if (senderType === "user") return;
  try {
    const body = content || (attachments?.length ? `${attachments.length}個附件` : null);
    if (!body) return;
    const tokens = [...new Set(await getFcmTokensInUserIds([room.userId]))];
    if (!tokens.length) {
      console.log(`[chat-push] Room ${room.id}: skipped (no registered device tokens).`);
      return;
    }
    // Preserve product-room notifications; general support has no product.
    const title = room.product?.name || "水滴客服";
    const prefix = room.product ? "賣家" : "客服";
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const response = await sendMulticastPushNotification({
        tokens: tokens.slice(offset, offset + 500),
        notification: { title, body: `${prefix}: ${body}` },
        data: { command: "chat_message", chatRoomId: room.id },
      });
      if (response) {
        console.log(`[chat-push] Room ${room.id}: FCM accepted ${response.successCount}, failed ${response.failureCount}.`);
      } else {
        console.error(`[chat-push] Room ${room.id}: FCM request failed; message remains saved.`);
      }
    }
  } catch {
    // Push is best-effort and must not roll back a committed message or stop
    // the test helper. Avoid logging tokens, message content or DB parameters.
    console.error(`[chat-push] Room ${room.id}: notification failed; message remains saved.`);
  }
}
