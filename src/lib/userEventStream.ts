import { Response } from "express";
import { CustomError, handleServiceError } from "./error";
import { sendJsonResponse } from "./general";

type DurableEvent = { sequence: number; eventType: string; payload: unknown };

// A factory gives each feature its own counters, lifecycle and cursor namespace.
export function createUserEventStream<E extends DurableEvent>(options: {
  name: string;
  limitCode: string;
  openFeed: (userId: string, checkpoint?: string) => Promise<{ sequence: number; cursor: string }>;
  readFeed: (userId: string, sequence: number) => Promise<E[]>;
  canDeliver: (event: E) => Promise<boolean>;
  encodeCursor: (userId: string, sequence: number) => string;
}) {
  const connections = new Map<string, number>();
  let totalConnections = 0;
  const MAX_BUFFER_BYTES = 1024 * 1024;

  return async function startUserEventStream(res: Response, userId: string, tokenExpiresAt?: number, checkpoint?: string, authorize?: () => Promise<void>) {
    let registered = false;
    let closed = false;
    let pollTimer: NodeJS.Timeout | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let expiryTimer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      closed = true;
      clearTimeout(pollTimer);
      clearInterval(heartbeat);
      clearTimeout(expiryTimer);
      if (registered) {
        registered = false;
        totalConnections--;
        const remaining = (connections.get(userId) ?? 1) - 1;
        if (remaining > 0) connections.set(userId, remaining);
        else connections.delete(userId);
      }
    };
    res.once("close", cleanup);
    res.once("error", cleanup);
    const reset = (reason: string) => {
      if (closed) return;
      if (!res.destroyed && res.writableLength < MAX_BUFFER_BYTES) {
        // end() alone can linger indefinitely on a blocked socket.
        const forceClose = setTimeout(() => res.destroy(), 1000);
        forceClose.unref();
        res.once("close", () => clearTimeout(forceClose));
        res.end(`event: stream.reset\ndata: ${JSON.stringify({ reason })}\n\n`);
      } else res.destroy();
      cleanup();
    };
    const write = async (frame: string) => {
      if (closed || res.destroyed) return false;
      if (Date.now() >= tokenExpiresAt! * 1000) { reset("auth_expired"); return false; }
      if (Buffer.byteLength(frame) + res.writableLength > MAX_BUFFER_BYTES) { reset("resync_required"); return false; }
      if (res.write(frame)) return true;
      // Wait for this frame to drain before fetching/writing any more journal events.
      return new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          res.off("drain", drained);
          res.off("close", disconnected);
          resolve(ok && !closed);
        };
        const drained = () => finish(true);
        const disconnected = () => finish(false);
        const timer = setTimeout(() => { reset("resync_required"); finish(false); }, 5000);
        res.once("drain", drained);
        res.once("close", disconnected);
      });
    };
    try {
      if (!tokenExpiresAt || tokenExpiresAt * 1000 <= Date.now()) throw new CustomError("A non-expired access token with exp is required", 401);
      if ((connections.get(userId) ?? 0) >= 3 || totalConnections >= 200) {
        res.setHeader("Retry-After", "15");
        throw new CustomError(`${options.name} stream connection limit reached`, 429, options.limitCode);
      }
      registered = true;
      totalConnections++;
      connections.set(userId, (connections.get(userId) ?? 0) + 1);
      await authorize?.();
      const boundary = await options.openFeed(userId, checkpoint);
      if (closed) return;
      if (tokenExpiresAt * 1000 <= Date.now()) throw new CustomError("Access token expired", 401);
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.setTimeout(0);
      res.flushHeaders();
      if (!await write(`retry: 3000\nevent: stream.ready\ndata: ${JSON.stringify({ schemaVersion: 1, cursor: boundary.cursor })}\n\n: heartbeat\n\n`)) return;
      let sequence = boundary.sequence;
      heartbeat = setInterval(() => { if (!res.writableNeedDrain) void write(": heartbeat\n\n"); }, 15_000);
      const expire = () => {
        const remaining = tokenExpiresAt! * 1000 - Date.now();
        if (remaining <= 0) reset("auth_expired");
        else expiryTimer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      };
      expire();
      const poll = async () => {
        if (closed) return;
        try {
          await authorize?.();
          const events = await options.readFeed(userId, sequence);
          if (closed) return;
          for (const event of events) {
            await authorize?.();
            if (event.eventType === "stream.reset") { reset("resync_required"); return; }
            if (event.sequence !== sequence + 1) { reset("resync_required"); return; }
            if (!await options.canDeliver(event)) { reset("resync_required"); return; }
            const id = options.encodeCursor(userId, event.sequence);
            if (!await write(`id: ${id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event.payload)}\n\n`)) return;
            sequence = event.sequence;
          }
          pollTimer = setTimeout(poll, events.length === 20 ? 0 : 1000);
        } catch (error) {
          reset(error instanceof CustomError && error.statusCode === 401 ? "auth_expired" : "resync_required");
        }
      };
      void poll();
    } catch (error) {
      if (closed) return;
      if (res.headersSent) reset("resync_required");
      else {
        cleanup();
        sendJsonResponse(res, handleServiceError(error));
      }
    }
  };
}
