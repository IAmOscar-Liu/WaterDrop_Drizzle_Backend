import { handleServiceError } from "../lib/error";
import { ServiceResponse } from "../type/general";
import {
  getSyncChatHistory,
  listSyncChatRooms,
  markSyncMessagesAsRead,
  sendSyncChatMessage,
} from "../repository/chatroom";

async function respond<T>(operation: () => Promise<T>): Promise<ServiceResponse<T>> {
  try {
    return { success: true, data: await operation() };
  } catch (error) {
    return handleServiceError(error);
  }
}

// App-only entry points. Legacy app/admin services remain unchanged.
export default {
  history: (query: Parameters<typeof getSyncChatHistory>[0]) => respond(() => getSyncChatHistory(query)),
  list: (query: Parameters<typeof listSyncChatRooms>[0]) => respond(() => listSyncChatRooms(query)),
  send: (input: Parameters<typeof sendSyncChatMessage>[0]) => respond(async () => (await sendSyncChatMessage(input)).message),
  read: (roomId: string, userId: string) => respond(() => markSyncMessagesAsRead(roomId, { kind: "user", id: userId })),
};
