import { createHmac, timingSafeEqual } from "node:crypto";
import { CustomError } from "./error";

export type ChatCursor =
  | { kind: "feed"; userId: string; sequence: number }
  | { kind: "history"; roomId: string; timestamp: string; id: string }
  | { kind: "list"; userId: string; id: string; limit: number };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function signature(payload: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new CustomError("Chat cursor signing is not configured", 503);
  return createHmac("sha256", secret).update(`chat-v1:${payload}`).digest();
}

export function encodeChatCursor(cursor: ChatCursor): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function decodeChatCursor<K extends ChatCursor["kind"]>(token: string, kind: K): Extract<ChatCursor, { kind: K }> {
  const code = kind === "feed" ? "CHAT_STREAM_CURSOR_INVALID" : kind === "history" ? "CHAT_HISTORY_CURSOR_INVALID" : "CHATROOM_LIST_SNAPSHOT_INVALID";
  try {
    if (token.length > 2048) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const expected = signature(parts[0]);
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (value.kind !== kind) throw new Error();
    if (kind === "feed" && (!uuidPattern.test(value.userId) || !Number.isSafeInteger(value.sequence) || value.sequence < 0)) throw new Error();
    if (kind === "list" && (!uuidPattern.test(value.userId) || !uuidPattern.test(value.id) || !Number.isSafeInteger(value.limit) || value.limit < 1)) throw new Error();
    if (kind === "history" && (!uuidPattern.test(value.roomId) || !uuidPattern.test(value.id) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.timestamp) || !Number.isFinite(Date.parse(value.timestamp)))) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof CustomError && error.statusCode === 503) throw error;
    throw new CustomError("Invalid chat cursor", 400, code);
  }
}
