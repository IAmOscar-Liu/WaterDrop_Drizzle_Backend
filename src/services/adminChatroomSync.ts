import { Response } from "express";
import { handleServiceError } from "../lib/error";
import { sendJsonResponse } from "../lib/general";
import { createUserEventStream } from "../lib/userEventStream";
import { encodeAdminChatCursor } from "../lib/adminChatCursor";
import { ServiceResponse } from "../type/general";
import { adminChatPrincipal, canDeliverAdminChatEvent, listAdminSyncChatRooms, openAdminChatFeed, readAdminChatFeed } from "../repository/adminChatroomSync";
import { getAdminSyncChatHistory, getChatRoomById, markAdminSyncMessagesAsRead, sendAdminSyncChatMessage } from "../repository/chatroom";
import { sendChatMessagePush } from "./chatroomNotification";

const stream = createUserEventStream({
  name: "Admin chat", limitCode: "ADMIN_CHAT_STREAM_LIMIT", openFeed: openAdminChatFeed,
  readFeed: readAdminChatFeed, canDeliver: canDeliverAdminChatEvent,
  encodeCursor: (principal, sequence) => encodeAdminChatCursor({ kind: "feed", principal, sequence }),
});
async function respond<T>(operation: () => Promise<T>): Promise<ServiceResponse<T>> {
  try { return { success: true, data: await operation() }; }
  catch (error) { return handleServiceError(error); }
}
export default {
  async events(res: Response, accountId: string, expiresAt?: number, checkpoint?: string) {
    try { await stream(res, await adminChatPrincipal(accountId), expiresAt, checkpoint); }
    catch (error) { sendJsonResponse(res, handleServiceError(error)); }
  },
  list: (input: Parameters<typeof listAdminSyncChatRooms>[0]) => respond(() => listAdminSyncChatRooms(input)),
  history: (input: Parameters<typeof getAdminSyncChatHistory>[0]) => respond(() => getAdminSyncChatHistory(input)),
  read: (roomId: string, accountId: string, readerType?: "admin" | "seller") => respond(() => markAdminSyncMessagesAsRead(roomId, { kind: "account", id: accountId }, readerType)),
  send: (input: Parameters<typeof sendAdminSyncChatMessage>[0]) => respond(async () => {
    const result = await sendAdminSyncChatMessage(input);
    if (!result.replayed) {
      // Preserve the existing app-user push behavior; admin clients receive SSE only.
      void getChatRoomById(input.chatRoomId, input.actor).then((room) => {
        if (room) return sendChatMessagePush({ room, senderType: result.message.senderType, content: input.content, attachments: input.attachments });
      }).catch(() => console.error("[admin-chat] App push failed; message remains saved."));
    }
    return result.message;
  }),
};
