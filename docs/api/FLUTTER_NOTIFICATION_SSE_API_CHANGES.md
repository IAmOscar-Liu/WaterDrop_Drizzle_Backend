# Flutter Message Center synchronization — PostgreSQL handoff

Date: 2026-10-12

Status: **implemented and tested locally; owner-run migration and deployment still required**. This confirms the backend contract for [the notification proposal](FLUTTER_NOTIFICATION_SSE_API_PLAN.md). It does not confirm availability on development/staging. All new endpoints are app-only and excluded from admin Swagger. Chat endpoints, event types, cursor formats and API response contracts are unchanged.

## Endpoints and authorization

Use the existing bearer access token. The backend derives the recipient from the authenticated app user; an admin-account token cannot open this feed or use these sync endpoints.

| Method | Endpoint | Successful `data` |
| --- | --- | --- |
| GET | `/api/notification/events` | SSE; see below. |
| GET | `/api/notification/sync/list` | `{notifications, page, limit, total, totalPages, listSnapshot, listSnapshotExpiresAt, stats}` |
| GET | `/api/notification/sync/stats` | Global unread stats with `version` and all six categories. |
| GET | `/api/notification/sync/:id` | One canonical notification; foreign, deleted and unknown IDs return generic 404. |
| POST | `/api/notification/sync/mark-as-read` | `{notifications: [changed canonical items], stats}` |
| DELETE | `/api/notification/sync` | `{deleted: [{id, version}], stats}` |

JSON uses `{success:true,data:...}`. Both mutation bodies use `{"notificationIds":["UUID"]}`: 1–200 unique UUIDs. The entire batch is checked before changing anything. A foreign/unknown ID returns generic 404 and rolls back the whole batch. Already-read items and already-deleted owned items produce no additional events. Delete retries return the original tombstone/version; reading an owned deleted ID succeeds with no changed item. No read-on-list-open, mark-all-read or mark-unread behavior is added.

**Legacy compatibility and security fix:** original list, stats, detail, read and delete endpoints retain their response shapes, without new version/deletion fields. Legacy stats already meant unread counts, but omitted categories with zero counts; sync stats always include every category. Legacy detail/delete now enforce recipient ownership. Legacy batch writes also validate 1–200 unique UUIDs and reject a batch containing unknown/foreign IDs atomically. Legacy read responses still include owned already-read items. Legacy delete retains its string response and 404 when nothing newly deleted; use the sync delete route for idempotent retry responses.

## Canonical items, revisions and stats

Canonical items retain `id`, `userId`, nullable `orderId`, `type`, `title`, `body`, `isRead`, `createdAt`, `updatedAt` and nullable `metadata`, and add positive integer `version`. Dates serialize as UTC ISO-8601. Internal `deletedAt` never appears in app responses. IDs/creation times are immutable; supported edits and read changes increment the item version without changing its ordering time.

```json
{
  "version": 101,
  "total": 3,
  "system_alert": 1,
  "order_status": 2,
  "promotion": 0,
  "coins_earned": 0,
  "chat_message": 0,
  "other": 0
}
```

All stats counts mean **unread, non-deleted notifications**, independent of list filters. `total` is the category sum. `stats.version` is a separate per-user collection revision; it advances once per transaction that changes visible items, including edits/deletes of already-read items. Each changed item in a batch gets its own event with the **same final transaction stats**. Apply item versions independently; equal stats versions must not cause other batch events to be skipped.

Each persisted notification is already a separate recipient-owned row. There is no shared broadcast template/read flag. Current order, refund, delivery and coin-expiry workflows use the instrumented `createNotification` repository path. Legacy and sync read/delete paths share transactional publication. A trusted internal `updateNotificationRecord` helper handles title/body/type/metadata edits; this adds no edit endpoint. Recipient, ID and creation time cannot be changed by that helper.

**Push-only operations remain push-only.** Existing admin `send-notification` / `send-app-notification`, and chat push alerts without a Message Center row, do not create notification SSE items or increment Message Center badges. To publish Message Center content, a workflow must create a recipient row through `createNotification`; raw SQL/table writes are not a supported publication path. No new creation/broadcast HTTP endpoint was added.

## List filters and frozen pagination

```http
GET /api/notification/sync/list?page=1&limit=20&snapshot=true&onlyUnread=false&types=system_alert&types=order_status
GET /api/notification/sync/list?page=2&limit=20&listSnapshot=TOKEN&onlyUnread=false&types=order_status&types=system_alert
```

- Default page size: **20**. Allowed `limit`: 1–100; `page`: 1–1,000,000.
- `types` supports a single value or **repeated `types=` keys**. Use the six category values above. Comma-separated values, JSON strings and `types[]` are not supported sync encodings. Unsupported query keys are rejected rather than silently ignored. Type order and duplicates normalize to a sorted set; at most six supplied entries.
- `onlyUnread` and `snapshot` accept query strings `true` / `false`. Omitted `onlyUnread` equals false.
- `search` is optional, at most 500 characters. It matches title **or** body with PostgreSQL `ILIKE '%search%'`. Case behavior uses the database's locale; there is no application Unicode normalization, accent folding or tokenization. Existing SQL wildcard behavior is preserved: `%` matches arbitrary text, `_` matches one character, and PostgreSQL backslash escaping applies. Whitespace is meaningful; only omitted/empty search normalize together. URL-encode the value.
- List `total` counts query-matching items, not unread notifications. Global `stats` always accompanies the response.
- Without `snapshot=true` or a token, sync list uses live offset pagination and returns null snapshot fields. Flutter should use snapshots for scrolling stability.

A new snapshot requires page 1. `snapshot=true` and `listSnapshot` cannot coexist. Frozen IDs are ordered by database `(createdAt DESC, id DESC)` without reducing timestamp precision. The token binds recipient, normalized filters and page size. Repeat the same filters and limit on later pages; `types` order may differ. Expiry is **15 minutes**. Snapshot pages return current item contents and current stats, but frozen `total`/`totalPages`.

Deleted/inaccessible/no-longer-matching entries are omitted without filling page holes. A short or empty page does not mean the end: use frozen `totalPages`. Merge live inserts/updates by ID/version and keep deletion tombstones so stale REST results cannot restore items. For text-search views, invalidate/coalesce a server refresh as described in the proposal rather than duplicating PostgreSQL matching on the client.

Limits: **10,000 frozen IDs per snapshot**, **5 active queries per user**. Oversized results return explicit 409; they are never truncated. A new snapshot for the same normalized filters **and page size** replaces its predecessor, even at the five-snapshot limit; the old token then returns 410. A sixth distinct query returns 429 with `Retry-After: 15`. Client-side debounce/query disposal is still needed; server snapshots expire naturally.

## Stream and Flutter application

```http
GET /api/notification/events
Authorization: Bearer ACCESS_TOKEN
Accept: text/event-stream
Last-Event-ID: OPTIONAL_NOTIFICATION_CURSOR
```

Keep one notification stream per foreground app session, alongside the separate chat stream. The notification stream includes all the user's notifications, independent of page, search, category or whether Message Center is open. Do not open one stream per page/filter. Do not mix chat and notification checkpoints.

```text
retry: 3000
event: stream.ready
data: {"schemaVersion":1,"cursor":"OPAQUE_NOTIFICATION_CURSOR"}

```

A fresh connection uses the current committed feed head. Reconnect echoes its requested checkpoint and replays strictly after it. Ready/heartbeat/reset frames have no durable event ID. Durable frames have signed `id`, named `event`, and JSON `data`:

| Event | Data besides `schemaVersion: 1` |
| --- | --- |
| `notification.created` | `notification`: full canonical item; `stats`. |
| `notification.updated` | `notification`: full canonical item; `stats`. Covers reads and supported content/type/metadata edits. |
| `notification.deleted` | `notificationId`, deletion `version`, `stats`. No deleted title/body. |

For bootstrap, register handlers and connect first. On `stream.ready`, fetch stats and active list/detail views. Merge HTTP/SSE by item version, merge stats independently by `stats.version`, and only advance the event checkpoint after applying the event or recording an invalidation. When Message Center is not open, update Home's badge and retain a dirty-list marker; no need to retain every item. Receiving an event never marks an item read or displays a second alert.

Background/logout closes the stream. Resume may replay with a checkpoint only when its corresponding cache/invalidations remain. Cold launch, account change, an expired cursor or `stream.reset` requires fresh notification bootstrap. Leave chat state alone. Share the existing token refresh mechanism; token expiry resets/closes the stream. Immediate session revocation is not implemented beyond current authentication/user-access checks.

Deleted rows become recipient-scoped tombstones and cannot reuse their IDs. Content fields on the row are scrubbed. **Replay that encounters historical content for an item now deleted/inaccessible resets instead of delivering that content.** This can occur after deleting items during a disconnect; it is a normal full-resync case. Historical journal payloads remain stored until retention cleanup but are not delivered after deletion. Tombstones are retained for the recipient's lifetime, independently of 48-hour replay retention, so deletion retries stay idempotent.

## Transport, errors and operations

Notification and chat share transport code with **separate per-feature counters**: 3 connections per user per API process, 200 total per feature per process. Both can coexist for multiple devices. Header `Retry-After: 15` accompanies stream quota 429s. There is no user-inactivity timeout; JWT expiry still applies.

Responses flush promptly with `text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`. Heartbeat comments: **15 seconds**; Flutter watchdog: **45 seconds**. Polling reads the PostgreSQL journal every **1 second per connection**, batches of 20, immediately continuing when a batch is full. No Redis or process-local event delivery dependency. Heartbeats do not query notification lists.

Mutations, revisions and event records commit atomically under a per-user feed lock, preserving commit-order replay. Each frame rechecks recipient/item access. Durable events are retained **48 hours**; hourly cleanup at minute 23 advances a durable replay boundary before removing records, under the same user lock. Cleanup also removes expired snapshots. `NO_CRON=true` disables cleanup; run it on at least one deployed process. Tombstone rows are not pruned.

Event payload bound: **256 KiB**; larger items save normally and create a small reset marker. The stream resets so Flutter can fetch current content via REST. Output buffering: **1 MiB**, up to **5 seconds** waiting for a slow socket, then reset/close (forced socket destruction after another second if needed). There is no unbounded per-client event queue; backlog lives in PostgreSQL until expiry. Stream resets use `{"reason":"resync_required"}` or `{"reason":"auth_expired"}`.

| HTTP / code | Meaning |
| --- | --- |
| 400 `NOTIFICATION_STREAM_CURSOR_INVALID` | Invalid or ahead-of-feed checkpoint. |
| 403 `NOTIFICATION_STREAM_CURSOR_INVALID` | Another user's checkpoint or a valid chat cursor supplied to this feed. |
| 410 `NOTIFICATION_STREAM_CURSOR_EXPIRED` | Retained replay boundary has passed. |
| 400 `NOTIFICATION_LIST_SNAPSHOT_INVALID` | Invalid token, owner/query/page-size mismatch, or invalid snapshot start. |
| 410 `NOTIFICATION_LIST_SNAPSHOT_EXPIRED` | Expired/replaced snapshot; refresh that query. |
| 409 `NOTIFICATION_LIST_SNAPSHOT_TOO_LARGE` | More than 10,000 matching items. |
| 429 `NOTIFICATION_LIST_SNAPSHOT_LIMIT` | Five active distinct queries. |
| 429 `NOTIFICATION_STREAM_LIMIT` | Per-feature process connection cap. |
| 401 / generic 404 | Invalid app user or inaccessible/unknown notification/batch. |

Before SSE headers, errors use the existing JSON envelope plus `code` where applicable. Request-shape errors use the existing Zod validation envelope. After headers, failures reset/close. Cursor signing requires a persistent shared `JWT_SECRET`; changing it invalidates cursors. Real proxy buffering, duration limits, two-stream connection capacity, storage growth and operational monitoring must be verified in staging.

## Owner-run migration and rollout

Only schema definitions are supplied; **no migration files or environment configurations were generated/modified and no configured database was migrated for this feature**. Existing local chat migration files are left intact.

Changes in `src/db/schema.ts`:

- `user_notifications`: `version` default 1, nullable `deleted_at`, positive-version check, active per-user history index.
- `notification_user_feeds`: per-user head, retained boundary and collection version.
- `notification_feed_events`: durable ordered journal, event checks and retention index.
- `notification_list_snapshots`: query-bound frozen IDs, expiry/page-size checks and one snapshot per normalized query.

Existing notifications get version 1 and null deletion time. Feed rows initialize lazily and stats count existing notifications immediately. No notification backfill script is required and old notifications are not emitted retrospectively. Broadcasts are represented by separate recipient rows when a workflow persists them.

```bash
npm run db:generate:local
# Review SQL, including any ungenerated chat changes already in your worktree.
npm run db:migrate:local
npm run build
```

Repeat generation/review/migration for each intended environment yourself. Deploy all notification writers together after migration: old writers do not publish events or respect tombstones. Keep Flutter's notification rollout switch disabled until migration, deployment and proxy verification are complete. Use primary PostgreSQL reads; do not move REST or journal reads to lagging replicas without a consistency barrier.

## Push tap navigation

The local notification helper's `--push` payload now includes the saved Message Center notification ID in FCM `data`:

```json
{
  "command": "message",
  "notificationId": "<saved-notification-UUID>"
}
```

`notificationId` is the same ID returned by REST and `notification.created`, not an FCM message ID or SSE cursor. The notification is saved before push is attempted. `command: message` remains unchanged for older apps.

For Flutter's push-tap handler (including a tap that launches the app), wait until authentication/account initialization completes. When `command == "message"` and `notificationId` is present, fetch `GET /api/notification/sync/{notificationId}` and open that item's detail page. After displaying the item, use the existing sync mark-as-read action and merge its canonical response/stats. Receiving a push or fetching detail does not itself mark the notification read.

If the ID is absent, open Message Center as before: other existing push producers may still send only `command: message`. If the detail request returns 404 because the notification was deleted or belongs to another account, show it as unavailable and fall back to Message Center. Do not use push content to bypass recipient checks or recreate a missing item. SSE remains the source of list/badge updates; push should not insert a second item or increment counts.

## Local testing

After your local migration, run the API and helper in separate terminals:

```bash
npm run dev
npm run notification:auto-send:local -- --user-id USER_UUID
# Optional push test, retaining the Message Center command:
npm run notification:auto-send:local -- --user-id USER_UUID --push
```

The helper writes one persisted `system_alert` every ten seconds through the normal publishing path. `--type promotion` (or another category) tests different badges. It starts after ten seconds, stops with Ctrl+C, and does not replay missed ticks. It requires a real local app-user UUID. `--push` additionally attempts FCM with `command: message` and the saved `notificationId`, using the selected environment's registered device tokens/configuration; push failure does not roll back SSE or the stored item. It is independent of the chat auto-reply helper, whose chat messages do not create Message Center records.

```bash
npm run build
npm run test:notification-sse
```

The suite creates a disposable database on the `.env.test` PostgreSQL server using the current schema **in memory**, tests two API processes, then drops it. No configured database is migrated and no migration files are produced. It also runs the existing chat legacy-compatibility and SSE regression suites because the transport implementation is shared. Tests do not send real device pushes. The shared test runner now builds the current schema in memory for every suite, with a separate disposable database per test script. Deployment migration generation/execution remains an owner task.

Verified: app-user isolation, legacy ownership fixes and response shapes, created/read/deleted events across processes, atomic mixed-owner rejection, batch stats/revisions, concurrent no-op retries, content edits, scrubbed tombstones and ID non-reuse, category totals, tied-timestamp paging, filtered snapshot holes/replacement/expiry/caps, normalized query binding, replay/live transitions, expiry/retention/rollback, oversized/malformed-event resets, the 10,000-item cap, JWT expiry, and independent chat quotas. Actual Flutter UI behavior, FCM presentation and production proxy/load behavior remain deployment checks.
