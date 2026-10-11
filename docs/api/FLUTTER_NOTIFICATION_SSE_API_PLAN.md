# Message Center (訊息中心) SSE API proposal

Status: **backend implementation completed locally; migration and deployment pending**. See [the confirmed backend handoff](FLUTTER_NOTIFICATION_SSE_API_CHANGES.md) for the implemented contract and differences. The proposal below is retained for context.

Give 訊息中心 the same foreground synchronization behavior as chat: after login, receive changes for all notifications belonging to the authenticated user, even while another page is open. Update the list, notification details, category unread badges, and Home's notification badge. Keep REST for loading data, pagination, read/delete actions, and FCM for push alerts.

This follows the [confirmed chat SSE contract](FLUTTER_CHATROOM_SSE_API_CHANGES.md) without changing it. All notification routes, fields, and limits below are proposals requiring BE agreement. Backend internals are not available in this Flutter repository.

## 1. Current Flutter behavior

| Area    | Observed behavior                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List    | `GET /api/notification/list`, `page`, `limit=20`, `search`, `types` (array), `onlyUnread` (boolean). Response: `data.notifications`, `total`, `page`, `limit`, `totalPages`.                                                         |
| Filters | All, system alerts, order status, promotions, other; text search and unread-only. `coins_earned` and `chat_message` exist in the model, but their category buttons are commented out.                                                |
| Stats   | `GET /api/notification/stats`; `total`, `system_alert`, `order_status`, `promotion`, `coins_earned`, `chat_message`, `other` are displayed as badges. Flutter treats these as unread counts; BE must confirm their existing meaning. |
| Detail  | `GET /api/notification/{id}` when absent from the loaded list; otherwise uses the cached item.                                                                                                                                       |
| Read    | Tapping an unread list item calls `POST /api/notification/mark-as-read`, body `{"notificationIds":["ID"]}`. Merely viewing the list does not mark everything read.                                                                   |
| Delete  | Swipe or detail action calls `DELETE /api/notification`, same ID-array body.                                                                                                                                                         |
| Refresh | Entry/manual refresh/filter changes load REST. List read/delete actions reload stats and all previously loaded pages, in requests of 20. Detail deletion returns a reload signal. No notification polling timer or SSE subscription. |
| Push    | Foreground FCM can display a local alert, but does not refresh list/stats. `command: "message"` opens 訊息中心; existing chat/order commands route elsewhere.                                                                        |

Sources: [message_provider.dart](../lib/provider/message_provider.dart), [message_stats_provider.dart](../lib/provider/message_stats_provider.dart), [message.dart](../lib/models/message.dart), [message_page.dart](../lib/pages/message_page.dart), [single_message_details.dart](../lib/pages/single_message_details.dart), [home_page.dart](../lib/pages/home_page.dart), [main.dart](../lib/main.dart), [root_layout.dart](../lib/layout/root_layout.dart).

Incoming notifications and other-device read/delete actions currently leave these views stale. Offset pages can shift during inserts/deletes, and older REST responses can overwrite newer state. Notification unread counts are distinct from chatroom unread-message counts.

## 2. Connection scope and compatibility

Propose **one notification SSE connection per authenticated foreground app session**:

```http
GET /api/notification/events
Authorization: Bearer ACCESS_TOKEN
Accept: text/event-stream
Last-Event-ID: OPAQUE_NOTIFICATION_CURSOR
```

Omit `Last-Event-ID` for fresh sessions. BE derives the user from authentication. No client-supplied user ID, category/search filter, or subscription list: the stream includes all notification types and recipient-specific changes, including items absent from loaded pages.

Keep `/api/chatroom/events` unchanged. When both features are enabled there are **two connections per foreground device**, one for each feature. Reuse transport/auth/lifecycle infrastructure, but keep notification and chat caches/checkpoints separate. The current chat reducer rejects unknown event types; do not inject notification events into the existing chat feed. A combined feed would require a separate migration.

| App state                       | Notification stream behavior                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Logged in, foreground           | Connect after account/token initialization; bootstrap stats immediately, list/details on demand.          |
| Enter/leave 訊息中心 or details | Change UI observers only; retain the session connection.                                                  |
| Foreground without interaction  | Keep connected; no user-inactivity timeout.                                                               |
| Inactive/background             | Close stream and cancel retry/watchdog timers; retain cursor with matching in-memory state/invalidations. |
| Resume                          | Reconnect and replay from the last applied notification cursor.                                           |
| Logout/account change           | Cancel stream/pending REST; clear cursor, caches, query state, and optimistic actions.                    |
| Cold start after termination    | Fresh stream and REST bootstrap; do not persist a cursor without its corresponding state.                 |

Register literal `/events` and `/sync/*` routes before dynamic `/{id}` routes. Preserve older app/admin response shapes through additive app-only sync routes.

## 3. Proposed REST contract

Keep the existing `{"success":true,"data":...}` envelope.

| Method / route                             | Proposed behavior                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /api/notification/sync/list`          | Existing filters and 20-item pages, plus frozen snapshots and versioned items (section 6). |
| `GET /api/notification/sync/stats`         | Return authoritative stats below as `data`.                                                |
| `GET /api/notification/sync/{id}`          | Return canonical notification as `data`; recipient authorization required.                 |
| `POST /api/notification/sync/mark-as-read` | Existing ID-array body; `data: {notifications: [canonical changed items], stats: ...}`.    |
| `DELETE /api/notification/sync`            | Existing ID-array body; `data: {deleted: [{id, version}], stats: ...}`.                    |

Register `/sync/list`, `/sync/stats`, and `/sync/mark-as-read` before `/sync/{id}`. No new creation API is requested; existing BE workflows continue creating notifications.

Canonical notification retains `id`, `userId`, nullable `orderId`, `type`, `title`, `body`, `isRead`, `createdAt`, `updatedAt`, nullable `metadata`; add **`version`**, a positive monotonically increasing integer per recipient's notification. Use UTC ISO-8601 timestamps. `id` and `createdAt` are immutable; read/content edits do not reorder items.

If broadcast notifications share a template, expose recipient-specific identity/version/read/delete state. One user's action must not affect another user's copy. BE must confirm its current broadcast representation.

Stats are global to the user's visible, non-deleted notifications, independent of search/type/unread-only filters:

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

All counts mean **unread notifications**; `total` equals the category sum. Uncategorized notifications count under `other`. `stats.version` is a per-user collection revision that advances on every visible creation/update/read/deletion, even if unread totals stay unchanged. Do not use timestamps as versions. List `total` means query-matching items, not unread count.

Read/delete accept 1–200 unique IDs and validate the full batch before mutation. Unauthorized IDs reject the request without partial writes or revealing another user's data. Operations are idempotent: already-read/deleted owned IDs succeed without duplicate events. Retain enough recipient-scoped deletion information for retries; return tombstones for already-deleted owned IDs while retained. Unknown IDs return generic `404`; Flutter reconciles errors through fresh reads instead of blindly restoring content.

Current UI actions concern one item at a time; bulk read-all/mark-unread are outside scope. Preserve read-on-item-open behavior. Receiving SSE never marks an item read. Merge canonical REST responses and events by version, in either arrival order. A failed/lost HTTP response must not revert an event-confirmed read/delete.

## 4. SSE event contract

First frame, matching chat conventions:

```text
retry: 3000
event: stream.ready
data: {"schemaVersion":1,"cursor":"OPAQUE_NOTIFICATION_CURSOR"}

```

Fresh connections receive the committed notification-feed head. Reconnects echo the requested checkpoint, then replay strictly after it. Ready/reset/heartbeat frames have no durable `id`.

Each durable frame has an opaque signed `id`, named event, and JSON data with `schemaVersion: 1`. Event IDs are user/feed-bound replay checkpoints, distinct from notification IDs, item versions, and stats versions.

| Event                  | Additional payload                            | Flutter action                                                                                                                              |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification.created` | `notification`: canonical full item; `stats`  | Insert into matching loaded views; update badges.                                                                                           |
| `notification.updated` | `notification`: canonical full item; `stats`  | Merge newer version into list/details; reevaluate filters. Includes read changes from any device and supported content/type/metadata edits. |
| `notification.deleted` | `notificationId`, deletion `version`, `stats` | Remove and retain tombstone; open details show unavailable. No deleted title/body.                                                          |

Example read event (illustrative IDs):

```text
id: OPAQUE_EVENT_CURSOR
event: notification.updated
data: {"schemaVersion":1,"notification":{"id":"notification-1","userId":"user-1","orderId":null,"type":"system_alert","title":"系統通知","body":"通知內容","isRead":true,"version":2,"createdAt":"2026-10-11T01:00:00.000Z","updatedAt":"2026-10-11T01:05:00.000Z","metadata":null},"stats":{"version":102,"total":2,"system_alert":0,"order_status":2,"promotion":0,"coins_earned":0,"chat_message":0,"other":0}}

```

For a multi-item transaction, publish one event per changed item with the same final transaction stats/version. No-op actions emit no new event. Apply item and stats versions independently: equal stats versions must not cause remaining item events in a batch to be discarded.

Commit notification changes, item/collection revisions, and durable journal records atomically. Cover **all writers**, including orders/deliveries, promotions/system announcements, scheduled jobs, admin edits/deletes, and legacy/sync app read/delete routes. A push with no persisted Message Center record does not create an SSE item. Test automated sending through the normal publishing path, not direct SQL.

Reuse the shared PostgreSQL journal approach where practical; internal storage is BE's choice. Delivery/replay must work across processes and survive restarts. Recheck recipient authorization before replay/delivery. If historical content is no longer authorized, reset/bootstrap rather than replaying it. Deleted IDs must not be reused.

## 5. Bootstrap, replay, and concurrent REST

1. Register event handlers, then open the stream before taking REST snapshots.
2. On fresh `stream.ready`, load stats and active list/detail views. REST reads must include all commits at or before the ready boundary; avoid lagging replicas without a consistency barrier.
3. Merge REST/events by notification ID/version. Tombstones prevent slow responses from restoring deleted items. Merge counts by `stats.version`; FCM never independently increments/decrements them.
4. Checkpoint durable events after applying them or recording cache invalidations. When Message Center has never been opened, retain stats and a dirty-list marker rather than an unbounded archive.
5. Ordinary reconnect retains caches and checkpoint. Expired replay/reset/cold launch clears notification state and bootstraps fresh, leaving chat synchronization unaffected.

Guard REST completions by account/session, query, and request generation. Bound live overrides/tombstones; if the client budget is exceeded, invalidate/rebootstrap instead of silently dropping required state. Do not replace the SSE checkpoint with a REST pagination token or collection revision.

## 6. Stable pagination and filters

Use frozen membership as in chat, extended to notification filters:

```http
GET /api/notification/sync/list?page=1&limit=20&snapshot=true&onlyUnread=false
GET /api/notification/sync/list?page=2&limit=20&listSnapshot=OPAQUE_SNAPSHOT&onlyUnread=false
```

Optional `search` and `types` retain current semantics. BE must document exact search fields, case/Unicode behavior, and type-array encoding; Flutter should not guess. Repeat the same normalized filters on later pages.

Return `data: {notifications, page, limit, total, totalPages, listSnapshot, listSnapshotExpiresAt, stats}`. Items are canonical/versioned, expiry is UTC ISO-8601, and stats use section 3's shape.

- Freeze matching IDs/order at snapshot creation: **`createdAt DESC, id DESC`**, preserving database timestamp precision. Return current canonical item values and current global stats on each page.
- Bind signed tokens to user, normalized filters, and page size. Proposed expiry: **15 minutes**. New snapshot requires page 1; `snapshot=true` cannot coexist with `listSnapshot`.
- `total`/`totalPages` describe frozen membership; live inserts are overlays that do not shift snapshot boundaries. Deduplicate REST/event overlap by ID.
- Omit deleted/inaccessible items and items no longer matching filters without filling holes from later pages. A short/empty page does **not** imply end-of-list; use `totalPages`. Read events immediately remove items from unread-only views.
- Newly matching items arrive through live overlays or query refresh. Read/content edits must not reorder the underlying history.
- Propose at most **5 active snapshots per user**. A new snapshot for the same normalized query replaces its predecessor; filter changes are debounced and Flutter retains only its active query. Capacity errors use `429`/`Retry-After`; expired/replaced tokens restart that list only.
- BE must confirm storage/result limits. Do not silently truncate large histories; a cap must have an explicit error or agreed cursor alternative.

For all/type/unread filters, full payloads permit local membership updates. For nonempty **text search**, initially invalidate and coalesce a REST refresh of the visible query, keeping search semantics on BE. Keep content while refreshing; replacement starts a new snapshot. While browsing older search results, mark the query dirty and offer an update action rather than continually resetting scroll. Apply known-item deletions/read changes and global stats immediately. Refresh dirty queries on entry/resume.

If another event arrives during search refresh, retain the dirty state and schedule a follow-up refresh. Do not refetch every loaded page for each event. Failed older-page requests retry the same page/token; advance only on success.

## 7. Transport, errors, and operations

Propose chat's conventions: `text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, effective proxy buffering disabled, prompt flush, heartbeat comments every **15 seconds**, Flutter silence watchdog **45 seconds**, initial `retry: 3000`, reconnect backoff/jitter up to 30 seconds unless the server requests longer. Heartbeats do not fetch lists.

| Condition                                      | Proposed response / action                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Invalid cursor                                 | `400 NOTIFICATION_STREAM_CURSOR_INVALID`; clear notification state/checkpoint and bootstrap.                   |
| Other user's/feed's cursor                     | `403 NOTIFICATION_STREAM_CURSOR_INVALID`; reject and stop retries; never reuse another session's caches.       |
| Replay expired                                 | `410 NOTIFICATION_STREAM_CURSOR_EXPIRED`; full notification resync. Proposed retention: **48 hours**.          |
| Snapshot invalid/expired/replaced              | `400 NOTIFICATION_LIST_SNAPSHOT_INVALID` / `410 NOTIFICATION_LIST_SNAPSHOT_EXPIRED`; restart that query only.  |
| Authentication failure                         | `401`; share existing single-flight token refresh with chat/REST, persist token, retry once; stop if it fails. |
| Access denied                                  | `403`; stop retries and show unavailable state.                                                                |
| Rate limit                                     | `429` with `Retry-After`; respect delay.                                                                       |
| Network failure, EOF, `5xx`, heartbeat silence | Reconnect with last applied notification checkpoint.                                                           |

Return JSON errors before streaming, preserving the existing error envelope plus `code`. After headers, send `stream.reset` with `{"reason":"resync_required"}` or `{"reason":"auth_expired"}`, then close. Auth-expired refreshes the token before fresh bootstrap. Match chat's token-expiry enforcement; document whether immediate session revocation is supported.

Unsupported schemas/malformed durable events require controlled resync/error handling, not silent checkpoint advancement or tight retry loops. Reuse chat's payload/backpressure protections where suitable. Oversized content can use reset markers followed by REST retrieval; BE must confirm event size, slow-writer/backlog bounds, and cleanup jobs.

Allow for **two connections per foreground device** when setting quotas; a shared three-connection per-user limit would constrain a second device. Confirm limits per feature/user/process, proxy idle/request timeouts, and delivery through the real proxy/tunnel. Monitor event lag, active streams, replay/reset/reconnect rates without logging tokens/content.

## 8. FCM and planned Flutter changes

Preserve FCM commands/routes (`message`, `chat_message`, `order_completed`, `delivery_updated`, etc.). SSE updates state without showing another local alert. FCM must not independently insert an item or increment an SSE-owned badge. Do not suppress BE push merely because a stream exists; another device may own it.

Retain foreground alert suppression for a genuinely visible Message Center using route visibility and app lifecycle, rather than the current entry/pop flag alone. A stream connected while Home is visible must not suppress every alert. Background/terminated delivery continues through FCM independently.

After BE agreement, Flutter work includes:

- Reuse/extract chat transport/parser/auth mechanics with endpoint-specific reducers and independent checkpoints; add session-level notification ownership above navigation.
- Add notification versions, authoritative stats, and snapshot parsing; centralize list/detail/badge state.
- Update visible lists/details, Home/category badges; preserve row keys/scroll position and show reconnecting state without blanking loaded content.
- Move detail read/delete into shared state, including when the list is not loaded. Keep read-on-item-open behavior.
- Remove reload-all-pages after read/delete; reconcile optimistic actions against newer versions and reject obsolete requests.
- Introduce an independent notification rollout switch until BE deployment is validated; preserve the working chat configuration.

## 9. Acceptance checks

1. BE creates a persisted notification every 10 seconds through its normal writer. Visible list/category badges update without refresh; Home badge updates even before Message Center is opened.
2. Exactly one notification stream plus one chat stream per foreground session; routes/filters create no extra connections. Resets are isolated by feature.
3. Other-device reads/deletes update list/details and badges. Read items leave unread-only views. Replays/duplicates and REST/event arrival order do not double-count or restore old state.
4. All six type counts are correct, including hidden category buttons. Query totals, notification unread stats, and chat unread counts remain distinct.
5. Test 0/1/20/21/many items, tied timestamps, live insert/delete during pagination, empty snapshot pages, filter/search changes, and snapshot expiry. No skipped/duplicate/resurrected items.
6. Events during bootstrap/search refresh are retained; old-account/query results cannot replace current state. Failed older-page requests retry the same page.
7. Lost-response read/delete retries are safe. Every item in a batch sharing one stats revision applies. Optimistic rollback cannot override a newer server event.
8. Idle foreground receives heartbeats; background disconnects; resume replays; cold start/expired replay bootstraps. Logout clears all notification state.
9. Verify simultaneous chat/notification auth refresh, replay authorization, multiple devices, process restarts, proxy flushing, and bounded slow clients.
10. FCM delivery/tap routes work; SSE creates no duplicate alert, FCM does not increment counts, and visibility-based suppression recovers after navigation.

## 10. Decisions requested from BE

1. Separate user-scoped notification endpoint and additive sync routes, preserving chat/admin/legacy compatibility.
2. Recipient-specific versions/broadcast behavior, global unread stats meaning, and complete coverage of notification writers.
3. Event payloads, atomic publication, stream-first consistent reads, 48-hour replay, deletion tombstones, and multi-instance delivery.
4. Twenty-item filtered snapshots, search/token rules and limits, plus server-authoritative search refresh behavior.
5. Idempotent read/delete responses and batch authorization/errors, including deleted-item retries.
6. Heartbeat/auth/reset/error conventions, capacity for both streams, proxy readiness, and unchanged FCM.

After BE confirms its final contract/deployment environment, implement Flutter against that handoff. This is a planning change only; notification runtime behavior is unchanged.
