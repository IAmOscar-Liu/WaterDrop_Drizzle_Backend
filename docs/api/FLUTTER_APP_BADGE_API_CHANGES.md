# Flutter app icon badge — backend handoff

Date: 2026-10-20

Status: backend implemented; owner-run migration and deployment required. Flutter/native integration and physical-device verification remain app work. This is the implemented contract for [the badge plan](../plans/FLUTTER_APP_BADGE_API_PLAN.md). It does not confirm availability on development or staging. App endpoints remain excluded from admin Swagger.

## Aggregate endpoint

```http
GET /api/app/badge
Authorization: Bearer APP_ACCESS_TOKEN
```

No query parameters are accepted. The authenticated app user determines the recipient; account/admin tokens cannot retrieve an app badge. Returns `Cache-Control: no-store` and the normal JSON envelope:

```json
{
  "success": true,
  "data": {
    "version": 42,
    "total": 9,
    "claimableUnopenedBoxes": 2,
    "unreadNotifications": 3,
    "unreadChatMessages": 4,
    "nextReconcileAt": "2026-10-20T16:00:00.000Z"
  }
}
```

`version` is a positive, persistent per-user snapshot revision. It increments when any observed component count changes, even when `total` remains equal. Intermediate changes may be coalesced; it is not a message/event sequence. Repeated reads of unchanged counts retain the revision. All counts are nonnegative integers and `total` is their sum. Do not combine this revision with chat or Message Center revisions.

`nextReconcileAt` is a nullable UTC timestamp: the earliest eligibility deadline/local midnight among currently counted boxes. It is a refresh hint. It can change while counts and `version` remain equal. Accept the timer from the current successful REST request even at equal version, guarded against earlier login sessions and older requests. Never decrement locally just because the timer fires.

Invalid/missing authentication returns the existing authentication error. A backend account with no app-user identity is rejected; onboarding middleware may reject it earlier. Unsupported queries return the existing Zod 400 envelope. Database failures return an error, not a synthetic zero badge. Receiving this aggregate does not mark anything read or open any box.

## Exact counting rules

- **Treasure boxes:** real rows belonging to this user, `isActive = true`, `isOpened = false`, with `accountingStatus` null (legacy), `claimable`, or `zero_reward`. Reward amount does not matter. Exclude acquired/unacquired rows. A non-null `claimDeadlineAt` must be strictly later than the database evaluation time; equality is expired, without waiting for financial maintenance.
- **Today:** when both `userLocalDate` and `timezoneSnapshot` exist, compare the stored date with today in that timezone. Otherwise derive the earning date from `earnedAt` using the user's valid timezone, falling back to `Asia/Taipei`. Invalid snapshot timezone values also fall back to the effective user timezone. Prior-day boxes do not count, even if stale rows remain active. The count is not clamped to ten UI slots.
- **Notifications:** all unread, non-deleted Message Center rows across all categories. Independently persisted `chat_message` records also count; ordinary chat pushes do not create these records.
- **Chat:** unread incoming messages (`senderType != user`) in active rooms owned by the user. Count messages, not rooms. Own sends are excluded. Existing automatic read-on-send behavior is included.

All three counts and the next deadline come from one PostgreSQL statement/snapshot. Reconcilers serialize per user before taking that snapshot and updating their state. No domain/feed locks are taken by reconciliation, and network delivery happens after commit.

Flutter should align its home treasure count with this rule, preferably using `claimableUnopenedBoxes` from the aggregate. The original treasure list remains compatible and still returns active rows; counting every row from that list is not equivalent to this badge rule.

## Push payload and navigation

Registered-user pushes include the following additional fields:

```json
{
  "data": {
    "command": "message",
    "notificationId": "EXISTING_NOTIFICATION_UUID",
    "badgeUserId": "APP_USER_UUID",
    "badgeVersion": "42",
    "badgeTotal": "9"
  },
  "apns": {
    "headers": { "apns-push-type": "alert" },
    "payload": { "aps": { "badge": 9 } }
  }
}
```

Existing commands, navigation IDs, alert content and APNs options are preserved. Order/refund/delivery flows now persist the notification before their alert and include its `notificationId`; their existing commands remain unchanged. Chat alerts still carry `chatRoomId`. The notification test helper retains its saved `notificationId`.

Totals are absolute, including zero to clear the badge. `data` values are strings; the native APNs badge is numeric. Multi-user multicast lists are personalized by registered owner rather than sharing one user's total. Arbitrary admin pushes to unregistered tokens retain their push-only behavior without inferred badge data.

User-specific producers bind the push to the intended user and recheck token ownership immediately before sending. A token transferred to another account is excluded from the former user's alert. The final provider/network race cannot recall an already queued push.

For updates without a visible alert, the worker sends:

```json
{
  "data": {
    "command": "badge_sync",
    "badgeUserId": "APP_USER_UUID",
    "badgeVersion": "43",
    "badgeTotal": "0"
  },
  "apns": {
    "headers": {
      "apns-push-type": "alert",
      "apns-collapse-id": "app-badge"
    },
    "payload": { "aps": { "badge": 0 } }
  }
}
```

These count-only pushes have no notification title/body or sound and expire at the provider after five minutes. They must not navigate or create an empty local notification. A normal alert may be followed by a count-only reconciliation; this does not create another visible alert or another Message Center item. Existing visible alerts remain best-effort; durable badge work retries the count, not the original banner.

Push ordering/delivery is not guaranteed. Revisions help a running app reject older data, but iOS can apply an older queued native badge while Flutter is not running. Restore correctness with authenticated REST on launch/resume. Android numeric badges remain launcher-dependent; no permanent/summary Android notification is introduced by the backend.

## Flutter integration

1. After login/account restoration and every foreground resume, fetch the aggregate. Keep one session-scoped controller above navigation.
2. Coalesce invalidations from existing chat/notification SSE revisions, successful box/read/delete operations, and foreground push badge metadata. Keep one REST request in flight, with a follow-up if another invalidation arrives.
3. Apply only a complete successful snapshot. Retain the last confirmed badge on error. Merge counts by revision; manage equal-version `nextReconcileAt` as described above.
4. While foregrounded, schedule one refresh at `nextReconcileAt` and re-arm from its response. Cancel it on background/logout. Device clock skew must not cause a tight immediate retry loop if a deadline remains in the future on the server.
5. Handle badge metadata even when a page suppresses the visible chat/explore alert. Push is an invalidation hint; do not increment counters or insert a second item.
6. On logout/account switch, invalidate old asynchronous requests, clear local badge/cache/timers and remove the old token binding using the existing authenticated device-token API. Register under the new account. Reject another user's `badgeUserId` while the app is running.
7. Set the native iOS badge using the existing app permission flow and implement the planned Android fallback. The server does not modify Flutter/native code.

No third SSE connection or recurring client polling is required. Background reconciliation uses native push; foreground deadline reconciliation uses the one-shot timer.

## Device registration

The existing device-token endpoint's request/response shape is preserved. Registration replaces conflicting token/device bindings atomically, including a token reused across accounts or a refreshed token for the same device. Keep `deviceId` stable for an installation and distinct between installations. When omitted, token uniqueness still prevents multiple owners of that token; the backend cannot identify a rotated old token by device identity alone.

Each successful registration records forced delivery work, even if the count/revision did not change or the total is zero. It is processed by the next worker pass. With cron disabled, REST still provides the immediate initial badge; pending pushes wait for a worker.

## PostgreSQL state, worker and operational bounds

Additive schema definitions:

- `user_badge_states`: one row per user; revision, three counts, next boundary, last dispatched revision and retry state, with bounds checks and due/retry indexes.
- `user_badge_work`: append-only invalidations written inside successful domain transactions; user/creation index and forced-delivery flag. Captured IDs are deleted only after successful handling. Concurrent inserts remain pending, including device registration during dispatch.
- `treasure_boxes_badge_user_idx`: partial per-user index for active unopened boxes.

Existing records remain the source of truth. Invalidation covers legacy/sync notification and chat writes, automated chat writes through the repository, room reactivation/status changes, both treasure award/open modes, daily reset, financial expiry and user timezone updates. There is no supported room ownership-transfer endpoint today; future ownership changes must invalidate both owners. Raw SQL/table writes are not supported publication paths.

The worker runs every minute inside the existing API process. No additional VM, dedicated CPU core, Redis service or separate worker process is required. A PostgreSQL advisory lock permits one worker across PM2/API instances. Work is sequential, capped at 50 users per pass, with a 45-second budget checked between users. Each user captures at most 1,000 pending IDs; remaining work is drained on later passes. FCM requests contain at most 500 tokens and have a 15-second caller timeout; a provider request can still finish after that timeout.

Retryable delivery failures keep work and use exponential backoff from 30 seconds up to 15 minutes. Each pass makes bounded attempts; persistent failures remain pending for later passes. Invalid/unregistered tokens are pruned by the existing transport. All-invalid/no-device results finish the captured work; a later registration forces delivery again. Superseded counts are recalculated at dispatch, not replayed as old values.

REST-discovered count changes, pending mutations, due boundaries and users without initialized badge state all enter worker selection. Existing users initialize gradually in bounded batches, including users without active sessions. No manual counter backfill is needed. `NO_CRON=true` disables the job; `COIN_LEDGER_ENABLED=false` does not. Pending work and overdue deadlines are recovered when a worker resumes. Deadline push attempts normally occur on the next available minute pass; load, backlog, retries and provider delivery can delay them. This is not an instantaneous delivery SLA.

## Owner-run local rollout and tests

No migration files were generated or edited, no environment files were changed and no configured database was migrated for this implementation. Tests create/drop disposable databases on the test server from the current schema in memory; they mock FCM.

```bash
npm run db:generate:local
# Review the two new tables, their constraints/indexes, and treasure-box index.
npm run db:migrate:local
npm run build
npm run dev
```

Deploy all writers with the migrated schema: legacy chat and notification writes also create badge work. Starting the new code before migration can fail those writes. Apply the same review/migration process to other intended environments yourself. The background worker needs cron enabled on at least one instance. These steps do not migrate production automatically.

```bash
npm run test:app-badge
npm run test:notification-sse
npm run test:admin-chatroom-sse
```

For manual app testing after migration, the existing notification helper can exercise both SSE and badge-bearing push:

```bash
npm run notification:auto-send:local -- --user-id USER_UUID --push
```

This manual helper sends real pushes to that environment's registered devices. Test read/delete/open, zero clearing, two devices, logout/account switch, deadline expiry and zero-reward boxes on physical devices. Automated tests do not establish OS presentation or production throughput; monitor queue growth, retry state and database/CPU load during rollout.
