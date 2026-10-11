# Admin chatroom SSE and synchronization — FE handoff

Date: 2026-10-12

Status: **implemented and verified in disposable PostgreSQL tests; owner-run migration and deployment required**. Availability on development/staging is not implied. These are new admin chat endpoints; existing admin/app chat routes and response shapes remain unchanged. No admin Message Center notification feed or admin push notification is added.

## Migration and rollout

Durable admin replay spans many app users, so it cannot reuse the app's independently ordered user feeds as one ordered stream. This implementation adds three tables in `src/db/schema.ts`:

- `admin_chat_feeds`: ordered feed head, retained boundary and list revision for platform support and each seller.
- `admin_chat_feed_events`: transactional journal, with room ID/access revision and canonical payloads.
- `admin_chat_list_snapshots`: account/scope/query-bound frozen room IDs and expiration.

No enum changes, message backfill or retrospective emission of old messages are required. Existing messages immediately appear in REST lists/history. Feed rows initialize lazily. No migration files were generated and no configured database was migrated for this change.

Owner workflow:

```bash
npm run db:generate:local
# Review generated SQL against your current local migration history.
npm run db:migrate:local
npm run build
```

Repeat generation/review/migration for each intended environment. Migrate before deploying the updated backend. Deploy **all chat writers and API processes together**: both old and new REST write paths now publish admin events transactionally, so the new tables are needed even if FE has not enabled admin SSE yet. Old server processes cannot publish the new journal. Enable FE only after deployment and proxy checks.

## Endpoints and permissions

All endpoints require the existing `Authorization: Bearer ACCESS_TOKEN`. They are documented in admin Swagger at `/api-docs`, under **Chatroom**.

| Method | New endpoint | Success `data` |
| --- | --- | --- |
| GET | `/api/admin/chatroom/events` | SSE, not a JSON envelope |
| GET | `/api/admin/chatroom/sync/list` | `{rooms, page, limit, total, totalPages, listState, listSnapshot, listSnapshotExpiresAt}` |
| GET | `/api/admin/chatroom/sync/history/:chatRoomId` | `{messages, limit, hasMore, nextCursor}` plus offset-pagination fields where applicable |
| POST | `/api/admin/chatroom/sync/message/:chatRoomId` | Canonical message directly; **not** `data.message` |
| PUT | `/api/admin/chatroom/sync/message/:chatRoomId/read` | Array of changed canonical messages |

REST uses `{success:true,data:...}`. Existing `/list`, `/history/:chatRoomId`, `/message/:chatRoomId` and `/message/:chatRoomId/read` routes are retained with their original contracts.

Access derives from the authenticated account:

| Account | Accessible rooms | Sending/reading role |
| --- | --- | --- |
| Active platform admin | All active rooms, including productless 水滴客服 rooms | `admin` |
| Active seller | Active rooms assigned to that seller | `seller` |
| Active employee | Active rooms assigned to its active parent seller | `seller` |
| App user, inactive/deleted account, employee without an active seller | Rejected | — |

Each request verifies room access. The stream rechecks account/seller scope while polling and before content frames; loss/change of scope resets it. Unknown, inactive and foreign rooms return 404. General platform support rooms are not visible to sellers/employees. Stream subscriptions include empty accessible rooms so their first message is delivered, while list responses hide empty rooms.

## Connect first, then load REST

Use **one admin chat stream per signed-in browser session/tab**, covering all accessible rooms regardless of the currently selected room or list filter. Do not create one stream per room.

```http
GET /api/admin/chatroom/events
Authorization: Bearer ACCESS_TOKEN
Accept: text/event-stream
Last-Event-ID: OPTIONAL_ADMIN_CHAT_CURSOR
```

A browser's native `EventSource` cannot set a bearer authorization header. Use a fetch-based SSE client/parser or equivalent library that supports headers and named events. Use the existing shared token-refresh flow, then reopen the stream with the renewed access token. Keep tokens out of query strings. Use Axios for normal REST if that is already FE's convention; its JSON interceptors do not by themselves implement streaming SSE parsing.

Fresh connection:

```text
retry: 3000
event: stream.ready
data: {"schemaVersion":1,"cursor":"OPAQUE_ADMIN_CHAT_CURSOR"}

```

On ready, fetch the active list and open-room history. Install event handlers before loading REST. A fresh ready cursor is the current committed feed head; a reconnect ready cursor echoes the requested checkpoint, followed by replay **strictly after** that checkpoint. Ready has no `id` field.

Maintain separate state for admin chat, app chat and notifications. Their feed cursors cannot be exchanged. Admin cursors also bind the account, role and seller/platform scope: even two employees of the same seller cannot exchange checkpoints.

## Durable events

Durable frames have signed `id`, named `event` and JSON `data`:

```text
id: OPAQUE_ADMIN_CHAT_CURSOR
event: message.created
data: {"schemaVersion":1,"chatRoomId":"ROOM_UUID","message":{"id":"MESSAGE_UUID","chatRoomId":"ROOM_UUID","senderType":"user","content":"Hello","clientMessageId":null,"version":1,"isRead":false,"createdAt":"2026-10-12T00:00:00.000Z","updatedAt":"2026-10-12T00:00:00.000Z","attachments":[]}}

```

| Event | Payload besides `schemaVersion` and `chatRoomId` | FE action |
| --- | --- | --- |
| `message.created` | Full canonical `message` | Merge into that room's history by message ID/version; resolve an optimistic send using `clientMessageId` when present. |
| `messages.read` | `readerType`, `readAt`, `messages: [{id,version,isRead:true}]` | Apply read patches by message version, including messages not currently loaded. Retain patch versions or mark history dirty. |
| `chatroom.updated` | Full canonical admin `room`, global `listState` | Update that room's latest message/unread count; insert or reorder by activity. Respect the current list filters and `listVisible`. |
| `chatroom.removed` | `roomVersion`, `reason: "access_revoked"`, global `listState` | Remove the room and invalidate its cached history. Retain the room revision so stale REST cannot restore it. |

Events arise from app sends/reads, admin sends/reads through **both legacy and sync routes**, automated chat messages and supported room creation/reactivation/association/status paths. FE does not have to keep the changed room open. Account-scoped delivery is through PostgreSQL, so the sender and stream can use different API instances.

A canonical message retains existing message fields and attachments, adding `version` and nullable `clientMessageId`. Internal sender identity and retry fingerprints are never exposed. A canonical admin room retains the existing room/user/product/variant-display/order/delivery summaries and adds `version`, `lastActivityAt`, `listVisible`, plus a canonical `lastMessage`. `user` contains `id`, `name`, `email`; `product` includes `price`, `variantName`, `variantImage` and may be null. `order` and `order.delivery` may also be null. Room access revisions remain internal.

`room.totalUnread` counts **unread user messages**, unlike the app's count of unread support messages. `listState` is global to the account's accessible scope and independent of active list filters:

```json
{"version":42,"totalRooms":12,"totalUnread":7}
```

`totalRooms` counts active, non-empty rooms. Counts are shared support state, not per-employee personal read state. Message, room and list versions are separate: compare each independently. Apply newer versions only; equal versions are no-ops. A read receipt changes room/list revisions without moving activity order. Sort using `lastActivityAt DESC`, then room `id DESC`; preserve microsecond timestamp precision when ordering tied activity times.

Later changes to product, variant, order or delivery metadata **do not independently emit chat events**. Refresh those related details through REST on list/room open. Keep refresh results separate from version arbitration for chat state: metadata can change while the chat room version remains equal. Stream payload metadata is a committed historical view and can be older than current REST metadata.

Advance the durable checkpoint only after applying an event or recording a reliable invalidation. Never skip a `message.created` just because its accompanying room/list revision is already known. If keeping only an unread badge while chat is closed, also retain a dirty-list/history marker.

## Lists and frozen scrolling

```http
GET /api/admin/chatroom/sync/list?snapshot=true&page=1&limit=20
GET /api/admin/chatroom/sync/list?listSnapshot=TOKEN&page=2&limit=20
GET /api/admin/chatroom/sync/list?snapshot=true&supportOnly=true&limit=20
```

Query fields:

| Field | Rule |
| --- | --- |
| `page` | Default 1; 1–1,000,000 |
| `limit` | Default 20; 1–100 |
| `productId`, `productVariantId` | Optional UUID filters |
| `supportOnly` | String `true`/`false`; platform admins only when true, requires accountId/productId null; cannot combine true with product filters |
| `snapshot` | String `true`/`false`; true starts a frozen snapshot on page 1 |
| `listSnapshot` | Opaque token; repeat the same filters and limit; cannot combine with `snapshot=true` |

The new list includes only active, non-empty rooms. There is no `status`, `sellerId`, `accountId`, `userId` or `search` query parameter. Unsupported list/stream query keys are rejected; authorization scope is never supplied by FE. Use the legacy list if an existing view needs its inactive-room behavior.

Without snapshot mode, pagination is live offset pagination and both snapshot fields are null. With snapshot mode, membership/order/page boundaries are frozen for **15 minutes**, at most **10,000 rooms per snapshot** and **five active snapshots per account**. Each new snapshot occupies a slot until expiry, including repeated queries. Debounce refreshes and reuse the token; a sixth snapshot returns 429. Oversized snapshots return 409 without truncation.

Snapshot pages return current contents and current global listState, but frozen `total`/`totalPages`. Newly inaccessible rooms or rooms whose access revision changed are omitted without filling holes. A short/empty page is not the end: use `totalPages`. SSE updates may reorder displayed rows or insert new rooms; merge by ID without changing the server's frozen pagination cursor. Refresh the snapshot when starting a new scrolling session or after expiry/reset. On snapshot errors, discard that snapshot rather than silently switching to live offset pages.

## History, sending and reading

```http
GET /api/admin/chatroom/sync/history/ROOM_UUID?limit=20
GET /api/admin/chatroom/sync/history/ROOM_UUID?limit=20&before=NEXT_CURSOR
```

History is newest-first by `(createdAt DESC,id DESC)`. Use `hasMore` and `nextCursor`. `before` is room-bound and cannot combine with `page`, `startAt` or `endAt`. Legacy-style offset requests support page/limit and inclusive startAt/endAt timestamp filters; they include `total`, `page` and `totalPages`. Cursor responses omit those three fields. Date-filtered pages return null nextCursor. All history requests require an active authorized room.

```http
POST /api/admin/chatroom/sync/message/ROOM_UUID
Content-Type: application/json

{"content":"您好，已收到您的訊息","clientMessageId":"CLIENT_GENERATED_UUID"}
```

`senderType` is optional; normally omit it. If supplied, it must match the derived role. Supply non-whitespace content or attachments, using existing uploads and attachment fields `url`, optional nullable `name`, `mimeType`, `size` (nonnegative).

Generate one clientMessageId per new send and reuse it for retries of identical content/attachments. Deduplication is persistent for the message lifetime, scoped to room + authenticated account + key. A repeat returns the current canonical message without duplicate events or another push; different content/attachments with the same key returns 409 `CLIENT_MESSAGE_ID_CONFLICT`. Different employees have separate send identities. Omitting the key preserves ordinary non-idempotent sending.

```http
PUT /api/admin/chatroom/sync/message/ROOM_UUID/read
Content-Type: application/json

{}
```

`readerType` is optional and must match the derived role if supplied. **The existing read behavior is retained:** seller readers mark user/admin messages read; admin readers mark user/seller messages read. Sending also marks currently unread messages from other roles read. This is not a visible-message-only acknowledgement and has no `upToMessageId`. A no-op read returns `[]` and emits no events. Receiving SSE, fetching lists or fetching history never marks messages read automatically.

New admin sends preserve the existing **app-user FCM** attempt after commit, including productless support rooms. No FCM is sent to admin accounts, and no Message Center row is created by chat sending. Push failure does not undo the saved message or SSE events. SSE is independent of push delivery.

## Reconnect, expiry and errors

Keep a checkpoint only alongside its corresponding cache/dirty markers. On a normal network reconnect, reuse it via `Last-Event-ID`. On cold start, account/seller-scope change, cache loss, expired checkpoint or `stream.reset`, discard admin-chat cache/checkpoint/snapshots, reconnect without a checkpoint, then bootstrap REST again. Do not clear unrelated app/notification state.

After opening, the server may send:

```text
event: stream.reset
data: {"reason":"resync_required"}

```

`auth_expired` requires refreshing the access token before reconnecting. JWT expiry closes streams even if the user is active. Current account/seller status is revalidated, but this does not add immediate token/session revocation or guarantee detection of a revoke/regrant entirely between checks. Replaying old room content after a room access revision changed resets rather than leaking that content; this can require a full resync even after reactivation.

| HTTP / code | Meaning |
| --- | --- |
| 400 `ADMIN_CHAT_STREAM_CURSOR_INVALID` | Malformed, wrong-feature or ahead-of-feed checkpoint |
| 403 `ADMIN_CHAT_STREAM_CURSOR_INVALID` | Checkpoint belongs to another account/role/scope |
| 410 `ADMIN_CHAT_STREAM_CURSOR_EXPIRED` | Checkpoint is older than retained boundary |
| 400 `ADMIN_CHAT_LIST_SNAPSHOT_INVALID` | Invalid token, owner/scope/query/page-size mismatch or invalid start page |
| 410 `ADMIN_CHAT_LIST_SNAPSHOT_EXPIRED` | Snapshot missing/expired |
| 409 `ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE` | More than 10,000 matching rooms |
| 429 `ADMIN_CHAT_LIST_SNAPSHOT_LIMIT` | Five active account snapshots |
| 429 `ADMIN_CHAT_STREAM_LIMIT` | Connection cap, with `Retry-After: 15` |
| 400 `CHAT_HISTORY_CURSOR_INVALID` | Invalid/wrong-room history cursor or incompatible history parameters |
| 409 `CLIENT_MESSAGE_ID_CONFLICT` | Retry key reused with different content/attachments |
| 401 / 403 / 404 | Authentication, account/role permission or room access failure |

Before SSE headers, errors use the normal JSON envelope and `code` when applicable. Request-shape validation uses the existing Zod error envelope. After headers, errors reset/close. Reconnect with backoff and jitter; honor Retry-After instead of retrying quota failures in a tight loop. On authorization failure, clear chat state and resolve account access rather than looping.

## Operations and verification

- Durable events retained **48 hours**; cleanup shares the existing hourly chat-sync cleanup job. Expired snapshots are removed there too. `NO_CRON=true` disables cleanup; run the job on at least one instance.
- All supported chat mutations, app journal entries and admin journal entries commit atomically. A **shared platform publication row lock is acquired before user-feed/room locks**, giving platform-wide commit order without sequence allocation races. Seller journals share that write ordering. This serializes chat writes, and snapshot creation also holds that lock; measure throughput, lock waits and list aggregate cost in staging.
- Polling reads PostgreSQL once per second per connection in batches of 20, continuing immediately for full batches. Use the primary database for REST and SSE. No Redis or process-local emitter is required.
- Admin chat has independent limits: three connections per account/scope per API process, 200 per process. Counts are not cluster-wide. Coordinate multiple tabs if needed.
- Heartbeat comments every 15 seconds; FE watchdog 45 seconds. Headers disable buffering/cache transformations. Output buffering is bounded at 1 MiB; a socket blocked for five seconds resets/closes. Oversized journal payloads above 256 KiB commit a small reset marker; FE fetches the full current data via REST.
- Use a persistent shared JWT_SECRET across instances; changing it invalidates signed cursors. Verify proxy buffering, request duration, CORS/header support, and multi-tab load in staging.
- Supported repository mutation paths publish events. Raw SQL room/message changes or old backend writers do not. Room reassignment/raw deletion is not added as an admin API by this change.

```bash
npm run build
npm run test:admin-chatroom-sse
```

The suite creates and drops a disposable database on the `.env.test` PostgreSQL server, using the current schema in memory without generating migration files or migrating configured databases. It tests two API processes, platform/seller/employee isolation, empty-room first message, live/replay, snapshots, canonical REST, duplicate send/conflict, read no-ops, rollback, concurrent publication across users, access resets, token expiry, oversized events and retention. It also runs existing chat authorization, legacy response compatibility and app SSE regressions. No real device pushes are sent. Actual FE behavior, FCM presentation, proxy streaming and production load remain deployment checks.

Related app contracts: [Flutter chat SSE](../FLUTTER_CHATROOM_SSE_API_CHANGES.md) and [chat authorization](../CHATROOM_AUTHORIZATION_API_CHANGES.md). FE should use this document for admin-specific scope, unread counts and endpoint paths.
