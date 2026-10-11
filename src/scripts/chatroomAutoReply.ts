import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const REPLY_DELAY_MS = 5_000;
const SUPPORT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 250;

async function main() {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      "room-id": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    console.log("Usage: npm run chatroom:auto-reply:local -- [--user-id <UUID>] [--room-id <UUID>]");
    console.log("Local defaults to all app users. Other environments require --user-id.");
    console.log("Marks new user messages read, then replies as admin with Taipei time after 5 seconds. Ctrl+C stops.");
    console.log("Local also replies in the same user's existing general-support room when messaging another room.");
    console.log("Local sends a timestamp to each watched user's existing general-support room every 10 seconds, even without incoming messages.");
    console.log("All generated messages also attempt FCM push to the room owner's registered devices.");
    return;
  }
  const userId = values["user-id"] === undefined ? undefined : z.uuid().parse(values["user-id"]);
  const roomId = values["room-id"] === undefined ? undefined : z.uuid().parse(values["room-id"]);
  const environment = process.env.NODE_ENV ?? "local";
  if (!["local", "development", "test", "stg"].includes(environment)) {
    throw new Error("Chat auto-reply is only available in local, development, test and stg.");
  }
  if (!userId && environment !== "local") throw new Error("--user-id is required outside local.");

  // Load configuration before importing the database/repository; --help never connects.
  await import("../lib/env");
  const { default: db, client } = await import("../lib/initDB");
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const { chatFeedTable, chatFeedEventTable, chatRoomTable, chatMessageTable, userTable } = await import("../db/schema");
    const { sendSystemChatMessage } = await import("../repository/chatroom");
    const { lockChatFeed, publishChatRead, publishChatRoom } = await import("../repository/chatroomSync");
    async function sendTestMessage(chatRoomId: string, content: string) {
      const message = await sendSystemChatMessage({ chatRoomId, senderType: "admin", content });
      try {
        // Push runs after commit. Loading lazily keeps missing Firebase setup
        // from stopping stored messages/SSE in this manual test helper.
        const { sendChatMessagePush } = await import("../services/chatroomNotification");
        const room = await db.query.chatRoomTable.findFirst({
          columns: { id: true, userId: true },
          with: { product: { columns: { name: true } } },
          where: and(eq(chatRoomTable.id, chatRoomId), eq(chatRoomTable.status, "active")),
        });
        if (room) await sendChatMessagePush({ room, senderType: "admin", content });
        else console.log(`[chat-auto-reply] Push skipped for ${message.id}: room no longer active.`);
      } catch {
        console.error(`[chat-auto-reply] Push unavailable for ${message.id}; check Firebase configuration. Message remains saved.`);
      }
      return message;
    }
    if (userId) {
      const user = await db.query.userTable.findFirst({ columns: { id: true }, where: eq(userTable.id, userId) });
      if (!user) throw new Error("App user not found.");
    }
    let supportUserId = userId;
    if (roomId) {
      const room = await db.query.chatRoomTable.findFirst({
        columns: { id: true, userId: true },
        where: and(eq(chatRoomTable.id, roomId), userId ? eq(chatRoomTable.userId, userId) : undefined, eq(chatRoomTable.status, "active")),
      });
      if (!room) throw new Error("Room must be active and belong to the selected user.");
      supportUserId = room.userId;
    }
    const supportRoomCondition = (ownerId?: string) => and(
      ownerId ? eq(chatRoomTable.userId, ownerId) : undefined,
      eq(chatRoomTable.status, "active"), isNull(chatRoomTable.productId),
      isNull(chatRoomTable.productVariantId), isNull(chatRoomTable.accountId), isNull(chatRoomTable.orderId),
    );
    const feedCondition = userId ? eq(chatFeedTable.userId, userId) : undefined;
    const initialFeeds = await db.select().from(chatFeedTable).where(feedCondition);
    const cursors = new Map(initialFeeds.map((feed) => [feed.userId, feed.head]));
    type PendingReply = { userId: string; messageId: string; roomId: string; accessVersion: number; dueAt: number };
    const pending: PendingReply[] = [];
    const roomCondition = (reply: PendingReply) => and(
      eq(chatRoomTable.id, reply.roomId), eq(chatRoomTable.userId, reply.userId),
      eq(chatRoomTable.status, "active"), eq(chatRoomTable.accessVersion, reply.accessVersion),
    );
    async function markObservedMessageRead(reply: PendingReply) {
      // Test-only trusted reader: preserve the same feed/room lock order and
      // transactional revisions/events as normal chat mutations.
      return db.transaction(async (tx) => {
        await lockChatFeed(tx, reply.userId);
        const [room] = await tx.select().from(chatRoomTable).where(roomCondition(reply)).for("update");
        if (!room) return false;
        const messages = await tx.update(chatMessageTable)
          .set({ isRead: true, version: sql`${chatMessageTable.version} + 1`, updatedAt: new Date() })
          .where(and(eq(chatMessageTable.id, reply.messageId), eq(chatMessageTable.chatRoomId, reply.roomId),
            eq(chatMessageTable.senderType, "user"), eq(chatMessageTable.isRead, false))).returning();
        if (messages.length) {
          await publishChatRead(tx, room, "admin", messages);
          await publishChatRoom(tx, room.id);
        }
        return true;
      });
    }
    const timestamp = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    console.log(`[chat-auto-reply] ${environment}: watching ${userId ? `user ${userId}` : "all app users"}${roomId ? `, room ${roomId}` : ", all rooms"}. Ctrl+C to stop.`);
    console.log("Only new messages after this point are handled; reads and replies are saved to the database. Run one instance per watched scope.");
    let nextSupportAt = Date.now() + SUPPORT_INTERVAL_MS;
    if (environment === "local") console.log("[chat-auto-reply] Periodic 水滴客服 messages enabled: every 10 seconds. Ctrl+C stops all sends.");
    while (!stopping) {
      let catchingUp = false;
      const feeds = await db.select().from(chatFeedTable).where(feedCondition);
      for (const feed of feeds) {
        if (stopping) break;
        // A feed created after startup starts at zero, including its first message.
        let cursor = cursors.get(feed.userId) ?? 0;
        if (cursor < feed.retainedAfter) throw new Error("Chat feed expired. Restart the script to watch new messages.");
        if (feed.head === cursor) continue;
        const events = await db.select().from(chatFeedEventTable)
          .where(and(eq(chatFeedEventTable.userId, feed.userId), gt(chatFeedEventTable.sequence, cursor)))
          .orderBy(asc(chatFeedEventTable.sequence)).limit(100);
        catchingUp ||= events.length === 100;
        for (const event of events) {
          if (stopping) break;
          if (event.sequence !== cursor + 1) throw new Error("Chat feed has a gap. Restart the script to watch new messages.");
          cursor = event.sequence;
          cursors.set(feed.userId, cursor);
          if (roomId && event.chatRoomId !== roomId) continue;
          if (event.eventType === "stream.reset") throw new Error("Chat feed requests a reset. Restart the script to watch new messages.");
          if (event.eventType !== "message.created") continue;
          const message = event.payload.message as { id?: string; senderType?: string } | undefined;
          if (message?.senderType !== "user" || !message.id) continue;
          const reply = { userId: feed.userId, messageId: message.id, roomId: event.chatRoomId, accessVersion: event.accessVersion, dueAt: Date.now() + REPLY_DELAY_MS };
          if (!await markObservedMessageRead(reply)) {
            console.log(`[chat-auto-reply] Skipped ${reply.messageId}: room access changed.`);
            continue;
          }
          pending.push(reply);
          console.log(`[chat-auto-reply] Read message ${message.id}; queued reply in room ${event.chatRoomId}.`);
        }
      }
      while (!stopping && pending.length && pending[0].dueAt <= Date.now()) {
        const next = pending.shift()!;
        const room = await db.query.chatRoomTable.findFirst({
          columns: { id: true },
          where: roomCondition(next),
        });
        if (!room) {
          console.log(`[chat-auto-reply] Skipped ${next.messageId}: room access changed.`);
          continue;
        }
        const content = `${timestamp.format(new Date())} (UTC+08:00)`;
        const reply = await sendTestMessage(next.roomId, content);
        console.log(`[chat-auto-reply] Sent ${reply.id} in room ${next.roomId}: ${content}`);
        if (environment === "local" && !stopping) {
          // 水滴客服 is the user's general-support room, not an arbitrary
          // seller/order room or another user's product-less room.
          const supportRoom = await db.query.chatRoomTable.findFirst({
            columns: { id: true },
            where: supportRoomCondition(next.userId),
          });
          if (!supportRoom) {
            console.log(`[chat-auto-reply] No active 水滴客服 room for user ${next.userId}; skipped extra reply.`);
          } else if (supportRoom.id !== next.roomId) {
            const supportContent = `${timestamp.format(new Date())} (UTC+08:00)`;
            const supportReply = await sendTestMessage(supportRoom.id, supportContent);
            console.log(`[chat-auto-reply] Sent ${supportReply.id} in 水滴客服 room ${supportRoom.id}: ${supportContent}`);
          }
        }
      }
      if (environment === "local" && !stopping && Date.now() >= nextSupportAt) {
        const supportRooms = await db.query.chatRoomTable.findMany({
          columns: { id: true },
          where: supportRoomCondition(supportUserId),
        });
        for (const supportRoom of supportRooms) {
          if (stopping) break;
          const content = `${timestamp.format(new Date())} (UTC+08:00)`;
          const reply = await sendTestMessage(supportRoom.id, content);
          console.log(`[chat-auto-reply] Periodic message ${reply.id} in 水滴客服 room ${supportRoom.id}: ${content}`);
        }
        // No overlapping sends or bursts to catch up after a slow database call.
        nextSupportAt = Date.now() + SUPPORT_INTERVAL_MS;
      }
      await sleep(catchingUp ? 0 : POLL_INTERVAL_MS);
    }
    console.log(`[chat-auto-reply] Stopped; discarded ${pending.length} pending replies.`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // Do not print database connection details or query parameters on failure.
  console.error("[chat-auto-reply] Failed:", error instanceof Error ? error.message.split("\n")[0] : "Unknown error");
  process.exitCode = 1;
});
