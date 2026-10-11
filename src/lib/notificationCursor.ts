import { createHmac, timingSafeEqual } from "node:crypto";
import { CustomError } from "./error";

type NotificationCursor =
  | { kind: "feed"; userId: string; sequence: number }
  | { kind: "list"; userId: string; id: string; limit: number; queryKey: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function signature(payload: string, domain = "notification-v1") {
  if (!process.env.JWT_SECRET) throw new CustomError("Notification cursor signing is not configured", 503);
  return createHmac("sha256", process.env.JWT_SECRET).update(`${domain}:${payload}`).digest();
}
export function encodeNotificationCursor(cursor: NotificationCursor) {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function decodeNotificationCursor<K extends NotificationCursor["kind"]>(token: string, kind: K): Extract<NotificationCursor, { kind: K }> {
  const code = kind === "feed" ? "NOTIFICATION_STREAM_CURSOR_INVALID" : "NOTIFICATION_LIST_SNAPSHOT_INVALID";
  try {
    if (token.length > 2048) throw new Error();
    const [payload, rawSignature, extra] = token.split(".");
    if (!payload || !rawSignature || extra !== undefined) throw new Error();
    const actual = Buffer.from(rawSignature, "base64url");
    const expected = signature(payload);
    if (actual.length !== expected.length) throw new Error();
    if (!timingSafeEqual(actual, expected)) {
      if (kind === "feed" && timingSafeEqual(actual, signature(payload, "chat-v1"))) {
        throw new CustomError("Cursor belongs to another feed", 403, code);
      }
      throw new Error();
    }
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value.kind !== kind || !uuid.test(value.userId)) throw new Error();
    if (kind === "feed" && (!Number.isSafeInteger(value.sequence) || value.sequence < 0)) throw new Error();
    if (kind === "list" && (!uuid.test(value.id) || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100 || !/^[a-f0-9]{64}$/.test(value.queryKey))) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError("Invalid notification cursor", 400, code);
  }
}
