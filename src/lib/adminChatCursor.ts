import { createHmac, timingSafeEqual } from "node:crypto";
import { CustomError } from "./error";

type Cursor = { kind: "feed"; principal: string; sequence: number }
  | { kind: "list"; principal: string; id: string; queryKey: string; limit: number };
function signature(payload: string) {
  if (!process.env.JWT_SECRET) throw new CustomError("Cursor signing is not configured", 503);
  return createHmac("sha256", process.env.JWT_SECRET).update(`admin-chat-v1:${payload}`).digest();
}
export function encodeAdminChatCursor(cursor: Cursor) {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function decodeAdminChatCursor<K extends Cursor["kind"]>(token: string, kind: K): Extract<Cursor, { kind: K }> {
  try {
    if (token.length > 4096) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const expected = signature(parts[0]), actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (value.kind !== kind || typeof value.principal !== "string") throw new Error();
    if (kind === "feed" && (!Number.isSafeInteger(value.sequence) || value.sequence < 0)) throw new Error();
    if (kind === "list" && (!/^[0-9a-f-]{36}$/i.test(value.id) || typeof value.queryKey !== "string" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof CustomError && error.statusCode === 503) throw error;
    throw new CustomError("Invalid admin chat cursor", 400, kind === "feed" ? "ADMIN_CHAT_STREAM_CURSOR_INVALID" : "ADMIN_CHAT_LIST_SNAPSHOT_INVALID");
  }
}
