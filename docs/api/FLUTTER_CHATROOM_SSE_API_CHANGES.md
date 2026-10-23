# Flutter chat synchronization — PostgreSQL implementation

Admin FE now has a separate [admin SSE/sync contract](FE-confirmation/ADMIN_CHATROOM_SSE_API_CHANGES.md). Existing app endpoints and cursor contracts below are unchanged; admin replay uses its own journal and requires the additional admin migration.

Date: 2026-10-11

Status: **implemented locally; deployment and environment migrations remain pending**. This is the implementation handoff for [the Flutter proposal](FLUTTER_CHATROOM_SSE_API_PLAN.md) and [the backend review](FLUTTER_CHATROOM_SSE_BACKEND_REVIEW.md). API availability on development/staging must be confirmed after the migration and deployment steps below. **All new contracts are app-only. Original app and admin REST request/response contracts remain unchanged. Admin Swagger now also documents the product-less-room push fix below.**

## Endpoint separation — confirmed 2026-10-11

Existing `/api/chatroom/list`, `/history/:chatRoomId`, `/message/:chatRoomId`, `/message/:chatRoomId/read`, `/create` and `/:chatRoomId` retain their original request validation, response fields, pagination and read behavior. All `/api/admin/chatroom/*` contracts also remain unchanged; there are no admin sync/SSE endpoints and no new fields in admin Swagger.

Use these **new app endpoints** for synchronization:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/chatroom/events` | One user-scoped SSE stream. |
| GET | `/api/chatroom/sync/list` | Versioned list, list state and optional frozen snapshots. |
| GET | `/api/chatroom/sync/history/:chatRoomId` | Versioned messages and older-history cursors. |
| POST | `/api/chatroom/sync/message/:chatRoomId` | Send with optional persistent `clientMessageId` deduplication. |
| PUT | `/api/chatroom/sync/message/:chatRoomId/read` | Mark support messages read; return changed messages with versions. |

Create rooms, load ordinary room detail and upload attachments through the existing endpoints. **Do not append sync parameters to old endpoints:** original validators continue ignoring unknown fields, and original sends do not gain retry deduplication. Move the new Flutter synchronization flow to `/sync/*` as a unit.

Shared persistence still records original app/admin/automated chat mutations in the PostgreSQL journal, so the app can see seller replies/read receipts. This internal bookkeeping is necessary for complete app events; it does not add admin API capabilities or alter legacy response fields. Room revision bookkeeping also preserves the original room `updatedAt` behavior.

## Order creation links an existing pre-order chat (2026-10-23)

Implemented; deploy the backend before relying on this behavior. No schema change or migration is required.

When `POST /api/order` successfully creates an order, the same transaction attaches it to existing **active rooms with no order or a failed checkout** matching the buyer, product seller, product and exact variant. The room ID and message history stay unchanged. There is no need to reopen「訂單詳情 → 聯絡賣家」or send another message. No room is created if none exists, and a room linked to a non-failed order is never reassigned to a later order. Platform support, other buyers/sellers/variants and inactive rooms are not changed. Competing purchases can claim an eligible room only once.

The transaction publishes the existing `chatroom.updated` event to app and authorized admin/seller feeds with the new `room.orderId` and `room.order`. On initial creation, an unpaid order normally has `orderStatus: pending` and `delivery: null`, so Flutter can display「待付款」. Existing empty rooms stay hidden according to `listVisible`. Linking does not send a chat message, mark messages read or send a push. An unsuccessful transaction leaves neither the association nor its event committed.

**Contacting the seller again after failure:** cart/product contact without `orderId` reuses an active room for the same buyer/seller/product/variant when its order is absent or failed. It returns the same room ID and hides the failed order ID in the response. The next checkout uses that same room and replaces only the failed-order association; the failed order record itself remains intact. If older code already created multiple eligible rooms, both lookup and checkout select the oldest by `(createdAt, id)`. Only that room is linked to the new order. Existing duplicate rooms/messages are not merged or deleted, so their separate histories remain visible. Explicit contact for an already-associated order continues opening that order’s own room.

**Failed payments:** chat lists/summaries return both `orderId: null` and `order: null` for a `failed` checkout, even if an older backend incorrectly created delivery data for it. Room detail also returns a null order ID. The internal failed-order reference remains until a later checkout reuses the room, and message history is preserved; this avoids collisions if another unlinked room already exists. A transition into/out of failed status publishes `chatroom.updated` atomically, so Flutter must replace (clear) the old order when the newer room contains nulls. Repeated failure callbacks do not emit another room revision. The ECPay payment-result handler now starts delivery creation only on successful payment. No existing delivery record is deleted or externally cancelled by this change.

**Live order and delivery updates:** order-status changes (including payment processing, paid, expired, cancelled and failed) and changes to the order’s merchant trade number now publish `chatroom.updated` in the same transaction. Delivery creation publishes after order-item association; later changes to displayed delivery fields (`merchantTradeNo`, `LogisticsType`, `LogisticsSubType`, `status`, `RtnCode`, `RtnMsg`) also publish. This covers the shared repository paths used by ECPay callbacks, logistics polling and admin updates. Only rooms linked to the affected order item receive delivery updates. Duplicate status callbacks/polls and updates only to internal metadata or polling timestamps do not bump chat revisions. No new endpoint, event type, push or migration is needed.

Flutter should merge each newer room by ID/version, including its nested `order`/`delivery` and null values. A successful payment can produce a paid-order event with `delivery: null`, followed by a second event once delivery creation commits; show the paid-order fallback until delivery arrives. No extra message or list reopen is needed for new updates. Continue REST refresh on entry/bootstrap for older records, catalog metadata and recovery; previously completed payments do not receive retrospective events. Pending/`payment-processing` orders still show waiting-for-payment status; paid orders retain their delivery summaries. Prefer delivery status when present; otherwise use the explicit order status. Unknown/missing status should not be interpreted as `pending`. Existing failed orders are hidden on the next REST refresh after deployment; no retrospective event or data repair is run.

This applies to newly created orders after deployment. Historical unlinked rooms/orders are not backfilled. Existing「聯絡賣家」from order details still explicitly links or opens the appropriate order room.

Validation: `npm run test:order-chatroom` uses a disposable test database to check association, ownership/variant isolation, app/admin journal publication, legacy and sync list summaries, preserved history, empty rooms, retries, rollback and concurrent purchases.

## Agreed behavior

- One authenticated `GET /api/chatroom/events` connection covers all of the app user's accessible active rooms, including rooms that have never had a message.
- **Both legacy and snapshot lists hide empty rooms.** `listState.totalRooms` counts active rooms with at least one message; `totalUnread` is the unread support-message count across all active rooms, not just the current page.
- An empty room may emit `chatroom.updated` with `room.listVisible: false`; retain its revision if needed, but **do not insert it into the displayed room list**. Its first message produces `message.created` followed by `chatroom.updated` with `listVisible: true`.
- App users read seller/admin messages, as before. **Admin/seller reads and automatic mark-read-on-send retain the original `senderType != readerType` rule**, including reading messages from the other support role. The earlier proposed support-side behavior change is withdrawn to preserve the original API. SSE reports the exact resulting read state. A read request still covers all unread messages at the operation's read point, not only displayed messages.
- Supported order/payment and delivery mutations publish the current summary as described above. Separate catalog edits still require REST refresh when the list or room opens. A chat `version` orders published room summaries; it is not a general revision of every underlying product/order/delivery field. Raw SQL and old deployed writers do not publish events.
- FCM remains independent of SSE. Support-side sends now also support rooms without a product, using notification title `水滴客服` and body `客服: <message>`; product rooms retain the product title and `賣家: <message>`. Attachment-only notifications use `<count>個附件`. Payload data remains `{command: "chat_message", chatRoomId: "..."}`. Push is attempted after commit for registered devices; missing tokens or delivery failures do not undo messages or SSE events. New app retry deduplication creates no duplicate message/events. User sends do not notify the same user. Low-level automated repository writes do not implicitly send push; the manual helper explicitly invokes it.

## Migration and rollout — owner-run

Only `src/db/schema.ts` was changed for schema definitions. No environment migration files were generated, and no configured database was migrated by this implementation.

Additions:

| Table | Change |
| --- | --- |
| `chat_rooms` | `version`, `access_version`, both default 1. Access version protects against replaying pre-revocation content after regrant. |
| `chat_messages` | Nullable `client_message_id` UUID, `sender_identity`, `request_fingerprint`; `version` default 1; room/sender/client-key uniqueness and retry identity check; history index `(chat_room_id, created_at DESC, id DESC)`, and a partial unread-message index. |
| `chat_user_feeds` | Per-user head, retained replay boundary and list version, plus sequence checks. |
| `chat_feed_events` | Journal/outbox keyed by `(user_id, sequence)`, stored event payload, room access generation, retention index. |
| `chat_list_snapshots` | User-bound frozen membership/order, page size and expiry, with user/expiry indexes. |

Existing rows receive default versions and null client retry keys. Existing messages remain accessible through history; they are not retrospectively emitted as `message.created`. Feed state initializes lazily. No chat backfill command is needed.

Start locally:

```bash
npm run db:generate:local
# Review the generated SQL: additive chat tables/columns/checks/indexes only.
npm run db:migrate:local
npm run build
```

Repeat generation/review/migration for the intended environment, using the existing `:development`, `:test`, or `:stg` scripts. Review unrelated schema drift separately. For a large chat history, plan index creation and the migration lock window before applying the generated migration.

All instances must use the same persistent `JWT_SECRET` to sign cursors. Missing signing configuration returns 503; rotating the secret invalidates existing cursor tokens. No Redis, new service, trigger-install script or hand-edited migration snapshot is required.

**Do not serve a mixture of old and new chat writers after SSE rollout.** Old processes do not write journal events. Stop/drain old writers, apply the migration, deploy/restart all API instances, then enable Flutter SSE. Keep the new Flutter behavior disabled until the actual proxy has been tested. Do not run migrations implicitly at application startup.

The shared PostgreSQL journal is polled once per second per connected session, in ordered batches of 20. This works across processes and after restarts without a process-local event emitter or `LISTEN/NOTIFY`. Notifications can be added later as a latency optimization; correctness comes from the journal. Heartbeats never query chat history. Size/load-test this polling strategy before increasing connection limits.

## Stream

```http
GET /api/chatroom/events
Authorization: Bearer ACCESS_TOKEN
Accept: text/event-stream
Last-Event-ID: OPTIONAL_LAST_APPLIED_CURSOR
```

`Last-Event-ID` is a header, not a query parameter. Register `/events` before the dynamic room route. The server derives the user and room scope from authentication; clients supply neither a user ID nor a room subscription list.

The response uses `text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`.

First frame:

```text
retry: 3000
event: stream.ready
data: {"schemaVersion":1,"cursor":"OPAQUE_CURSOR"}

```

A fresh connection receives the committed feed head. A reconnect receives exactly its requested checkpoint and replays strictly after it. `stream.ready` and heartbeat comments have no durable `id`.

Durable frames have an opaque signed `id`, named `event`, and JSON `data`. All payloads include `schemaVersion: 1` and `chatRoomId`:

| Event | Additional data |
| --- | --- |
| `message.created` | `message`: canonical message, including attachments, `clientMessageId`, `version`, `isRead`. Includes own sends and automated refund messages. |
| `messages.read` | `readerType`, UTC `readAt`, `messages: [{id, version, isRead: true}]`. At most 200 changed messages per frame; no event for a no-op. |
| `chatroom.updated` | `room`: complete user-list projection with `version`, `lastActivityAt`, `listVisible`, `totalUnread`, `lastMessage`, existing product/order fields; authoritative `listState`. |
| `chatroom.removed` | `roomVersion`, `reason: "access_revoked"`, `listState`. No message content. |

Room versions and list versions are independent of feed event IDs. List ordering is `lastActivityAt DESC, id DESC`; `lastActivityAt` is the latest message's creation time (room creation time for an empty room), never the read receipt time.

Messages, automatic/explicit read patches, room revisions, list revisions, and journal records commit together under a per-user PostgreSQL row lock. A process dying after commit leaves events available to other instances and replay. Message retry keys remain with the message and are independent of journal retention.

Room access is checked during journal reads and again before each content frame. Supported status changes go through repository `setChatRoomStatus`; creation/reactivation/association paths publish events too. There is no new HTTP room-status/deletion API. Direct SQL updates/deletes or new code bypassing these repository transactions do not have a guaranteed removal event and must not be used as normal access-change paths. If retained content spans an incompatible revoke/regrant generation, the server resets instead of replaying that content; Flutter must discard the old cache and perform full resync.

Heartbeat comments are sent immediately and every 15 seconds. Keep the proposed 45-second Flutter watchdog. Streams close at the verified JWT `exp`; token expiry sends `stream.reset` with `reason: "auth_expired"` when the socket permits. Immediate token revocation is not supplied by the current authentication system.

Other continuity failures use:

```text
event: stream.reset
data: {"reason":"resync_required"}

```

Then the connection closes. Full resync opens a fresh stream without the old checkpoint and reloads list/visible history. Replay history is retained for **48 hours** (exceeding the agreed 24-hour minimum). Hourly cleanup at minute 17 advances the retained boundary atomically before deleting events and removes expired list snapshots. `NO_CRON=true` disables cleanup; replay remains correct but storage grows. At least one API process must run scheduled jobs.

Limits: 3 connections per user **per API process**, 200 total per process. These are process-local resource limits, not a global multi-instance session quota. HTTP 429 includes `Retry-After: 15`. Event payloads are bounded to 256 KiB; an oversized message/summary is represented in the journal by a small internal reset marker. Its underlying write still succeeds, preserving legacy API behavior. A stream encountering the marker sends control `stream.reset` without a durable ID, then closes; bootstrap fresh and fetch that data through REST. Stream buffering is bounded to 1 MiB. A blocked writer gets 5 seconds to drain before reset/disconnect. Reconnect/reset after a slow connection rather than dropping frames silently.

## Bootstrap and reconnect in Flutter

1. Open the stream; register event buffers before requesting REST snapshots.
2. Receive `stream.ready`, save its boundary, then fetch list page 1 and visible-room history. Reads use the primary database and include earlier committed feed changes.
3. Merge messages by ID/version and room chat state by room ID/version. Apply newer read patches even if POST/history responses arrive later. Refresh associated catalog/order/logistics metadata from REST on entry.
4. Apply each durable event or record the corresponding cache invalidation before advancing the session checkpoint. History/list pagination tokens never replace the SSE checkpoint.
5. On ordinary reconnect, keep matching caches and use the last applied `Last-Event-ID`. On reset/expired replay or cold launch, clear stale caches and reconnect without it.
6. Background/logout closes the stream. Use one stream per foreground session, not one per room. Keep FCM for background notifications. Do not poll history while SSE is healthy.

## History and sending

```http
GET /api/chatroom/sync/history/ROOM_ID?page=1&limit=20
GET /api/chatroom/sync/history/ROOM_ID?before=NEXT_CURSOR&limit=20
```

Newest-first ordering is `(createdAt DESC, id DESC)`. The cursor preserves PostgreSQL timestamp microseconds, not the truncated JavaScript timestamp. It is exclusive, signed and room-bound; it has no replay-retention expiry. `before` cannot be combined with `page`, `startAt` or `endAt`.

**New sync history** page mode returns `messages`, `total`, `page`, `limit`, `totalPages`, `hasMore`, `nextCursor`. Original history endpoints retain only their original fields. Cursor mode returns `messages`, `limit`, `hasMore`, `nextCursor`. At the end `hasMore=false` and `nextCursor=null`. Date-filtered requests on the new sync history endpoint remain page-based and return `nextCursor=null`; `hasMore` describes remaining pages. Explicit legacy `limit=9999` remains supported. New Flutter requests should use 20.

```http
POST /api/chatroom/sync/message/ROOM_ID
Content-Type: application/json

{"senderType":"user","content":"你好","clientMessageId":"093b1bca-5d65-41ea-aae3-efb6c2b0cc51"}
```

`clientMessageId` is optional on the **new sync send endpoint** and should be a stable UUID per new outgoing message. It is not added to either original app or admin send API. The same authenticated sender/room/key with identical content and attachment input returns the current canonical message, with no new message, events, auto-read or FCM. Reusing it for changed content/attachments returns `409 CLIENT_MESSAGE_ID_CONFLICT`. Attachment input preserves order and compares URL/name/MIME type/size; absent nullable attachment attributes normalize to null.

**The new sync POST envelope is `{success:true,data:<canonical message>}`**, not `data.message`. New fields are `clientMessageId: string | null` and positive integer `version`; attachments are arrays in history/POST/events/last-message summaries. Sender identity and fingerprint are internal and not returned. Original app/admin responses also omit `version` and `clientMessageId`. Old messages start at version 1, including messages already read before migration.

```http
PUT /api/chatroom/sync/message/ROOM_ID/read
Content-Type: application/json

{"readerType":"user"}
```

These additions belong only to the new app sync routes. Admin REST and Swagger retain their original fields and behavior. Flutter sync routes are documented here only.

## Stable room-list pagination

```http
GET /api/chatroom/sync/list?page=1&limit=20&snapshot=true
GET /api/chatroom/sync/list?page=2&limit=20&listSnapshot=OPAQUE_TOKEN
```

First page must use `page=1`. Do not combine `snapshot=true` with `listSnapshot`. The new response adds `listSnapshot`, `listSnapshotExpiresAt`, and `listState: {version,totalRooms,totalUnread}` to the usual pagination fields and room array. Requests to the new `/sync/list` without snapshot mode use live offset pagination and still include versions/list state. Original `/api/chatroom/list` and admin lists receive no new fields.

Membership and ordering are frozen for **15 minutes** in PostgreSQL, shared across processes. Page summaries use current readable chat state; page boundaries remain frozen. New messages/read receipts update the list through events. Expired tokens restart list pagination only, not the stream/history.

Tokens bind the user and page size. Snapshot page sizes are 1–100; recommended 20. A snapshot contains at most 10,000 visible rooms. At most 5 unexpired snapshots can exist per user; reuse the current token rather than creating a new one for every page or SSE event. The sixth returns 429 until an existing snapshot expires.

Revoked or revoke/regranted entries are omitted from old snapshot pages without filling the holes from later pages. Use frozen `totalPages`, not returned page length, to decide whether to fetch the next page. `listState` reports current global counts. Retain live room overrides/tombstones so older pages cannot restore removed rooms. Empty rooms remain hidden; honor `room.listVisible` on stream events.

## Errors

Errors retain `{success:false,statusCode,message}` and add `code` where applicable. Stream errors are JSON before streaming starts; after headers, continuity failures reset/close.

| Status / code | Action |
| --- | --- |
| 400 `CHAT_STREAM_CURSOR_INVALID` | Discard malformed/invalid stream cursor and bootstrap fresh. |
| 403 `CHAT_STREAM_CURSOR_INVALID` | Cursor belongs to another user; do not reuse caches across accounts. |
| 410 `CHAT_STREAM_CURSOR_EXPIRED` | Clear shared cached chat state and bootstrap fresh. |
| 400 `CHAT_HISTORY_CURSOR_INVALID` | Restart that room's history; check room scope and mixed parameters. |
| 400 `CHATROOM_LIST_SNAPSHOT_INVALID` | Check owner/page size/start-page parameters and restart list snapshot. |
| 410 `CHATROOM_LIST_SNAPSHOT_EXPIRED` | Restart list pagination only. |
| 429 `CHATROOM_LIST_SNAPSHOT_LIMIT` | Reuse an existing snapshot or wait for expiry. |
| 409 `CHATROOM_LIST_SNAPSHOT_TOO_LARGE` | Snapshot membership exceeds the bounded first-release capacity. |
| 409 `CLIENT_MESSAGE_ID_CONFLICT` | Key already represents different content; do not blindly retry changed content under that key. |
| 429 `CHAT_STREAM_LIMIT` | Honor `Retry-After`; avoid duplicate foreground connections. |
| 401 / 403 / room 404 | Existing authentication/room ownership rules apply. Refresh expired tokens once; stop on forbidden access. |

Malformed request shapes can still return the existing Zod validation error envelope rather than a cursor code.

## Verification and remaining rollout checks

### Interactive timestamp reply helper

After migrating the selected database and starting the API, run this in another terminal. Local defaults to watching **all app users**, including users whose first chat feed is created while the helper is running:

```bash
npm run chatroom:auto-reply:local
# Optional: restrict to a user and/or room
npm run chatroom:auto-reply:local -- --user-id <USER_UUID>
npm run chatroom:auto-reply:local -- --user-id <USER_UUID> --room-id <ROOM_UUID>
# For an API connected to .env.development instead:
npm run chatroom:auto-reply:development -- --user-id <USER_UUID>
```

`chatroom:auto-reply:stg` is also available. All environments except local require `--user-id`. Choose the same database environment as the API, and avoid overlapping helper instances (one all-user helper is enough locally). Wait for the `watching` log, then send messages from Flutter through either original or sync send endpoints. Each newly observed user message is marked read immediately, with a version increment and `messages.read`/summary SSE events, then receives an `admin` reply approximately five seconds after detection. The reply contains the current `Asia/Taipei` date/time, e.g. `2026-10-11 14:30:05 (UTC+08:00)`. Polling/database latency adds to the delay. Multiple messages each get a reply; support replies cannot trigger a loop.

This standalone helper polls the PostgreSQL chat event journal every 250 ms and uses the existing system-message repository path. Replies are real stored messages, produce SSE events, and apply normal automatic mark-read-on-send behavior. Every generated reply and periodic message also attempts FCM push after saving; no API routes are changed. Historical messages are ignored at startup. Ctrl+C stops the script and drops queued replies; it has no restart recovery or persistent retry state. Rooms whose access changed are skipped; feed gaps/resets and database/send errors stop the helper instead of silently skipping or retrying writes. This is a manual test helper, not a deployed bot.

**Local cross-room test:** after replying in the originating room, the helper also sends a timestamp message to the **same user's** existing active「水滴客服」room (no product, variant, account or order). This lets Flutter test an SSE update for a room that is not currently open. Sending directly in that support room produces only one reply. If the user has no matching room, the helper logs a skip; it does not create a room or send to another user's room. `--room-id` filters incoming triggers, so a selected product room can still trigger the extra support-room reply. This extra reply runs only in `local`, and uses the same normal send behavior, including marking unread messages from other roles in the support room read.

**Local periodic list test:** while the helper runs, it also sends a timestamp message to each watched user's existing active「水滴客服」room approximately every **10 seconds**, starting 10 seconds after startup, without requiring any incoming message. With no filters this covers all local users' support rooms; `--user-id` restricts the owner, and `--room-id` restricts it to that room's owner. Missing support rooms are not created. These messages follow the normal send path and generate `message.created` and `chatroom.updated` SSE events, so Flutter can update the list preview, activity ordering and unread count. This timer is independent of the five-second replies above. Sends run sequentially, with no catch-up bursts; database/polling delays can extend the interval. Ctrl+C stops both the periodic messages and automatic replies. Other environments have no periodic sends.

### Push checks for the manual helper

Restart the helper after updating it. All generated messages (original-room replies, extra support-room replies and ten-second periodic messages) attempt push using the selected environment's Firebase configuration and the room owner's registered device tokens. Use the app normally to register its token against that same API/database. The helper's existing `.env.local` Firebase credential file/bucket settings must be valid; do not put tokens or credentials into script arguments.

Check `[chat-push]` logs: `FCM accepted N, failed M` reports the provider response; `skipped (no registered device tokens)` means the backend has no destination; `FCM request failed` or `Push unavailable` means push setup/delivery needs attention. Acceptance is not confirmation that a notification appeared on screen. Push failures are best-effort, with no durable retry queue, and do not stop saved messages/SSE. The periodic interval can extend while a push request is pending. Device tokens are not printed in failure logs. No real device pushes were sent by the implementation checks.

### Automated verification

```bash
npm run build
npm run test:chatroom-sse
```

The SSE test command creates a **disposable database** on the `.env.test` PostgreSQL server, derives its empty schema from the current TypeScript definition, runs authorization, legacy-contract compatibility and SSE integration tests, then drops it. It does not edit migration files, run migrations on a configured database, or contact FCM/SendGrid recipients. The shared test runner now builds the current schema in memory for every suite, with a separate disposable database per test script. Deployment migration generation/execution remains an owner task.

Verified locally: authorization regressions; two independent API processes sharing the journal; replay checkpoint echo; concurrent duplicate sends; conflict rejection; canonical versions; original admin read semantics, app-user reads and no-op reads; exact legacy response keys and no new legacy deduplication; app-only `/sync/*` routing; empty-room first message from the automated path; frozen pagination across reordering; foreign/expired snapshot tokens; removal/regrant filtering; microsecond/tied history pagination including 10,001 messages; legacy 9999 limit; replay-to-live handoff over multiple batches; mixed/foreign history cursor rejection; transactional rollback; retention boundary and deduplication after pruning; token expiry; stream connection limits. A separate mocked-transport check verified that a blocked writer resets, destroys its socket and stops polling. Admin Swagger excludes all Flutter routes; the existing send endpoint description documents the general-support push fix.

Still required before Flutter rollout: owner-reviewed environment migrations; full deployment of all writers; real proxy/CDN buffering/idle-duration checks; load and slow-network testing at expected connection counts; operational storage/cleanup monitoring. Passing local tests does not establish those deployment properties. Keep a Flutter polling rollback switch until staging verification is complete.
