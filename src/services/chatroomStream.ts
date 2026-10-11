import { createUserEventStream } from "../lib/userEventStream";
import { encodeChatCursor } from "../lib/chatCursor";
import { canDeliverChatEvent, openChatFeed, readChatFeed } from "../repository/chatroomSync";

export const startChatroomStream = createUserEventStream({
  name: "Chat", limitCode: "CHAT_STREAM_LIMIT",
  openFeed: openChatFeed, readFeed: readChatFeed, canDeliver: canDeliverChatEvent,
  encodeCursor: (userId, sequence) => encodeChatCursor({ kind: "feed", userId, sequence }),
});
