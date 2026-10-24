# App Icon Badge Plan

Status: backend implemented on `feat/app-badge`, 2026-10-20; owner-run migration/deployment and Flutter/native implementation remain pending. The [backend handoff](../api/FLUTTER_APP_BADGE_API_CHANGES.md) is the implemented contract, including worker bounds and equal-version timer handling. The design below records the joint proposal and review against backend commit `151e48f`.


The app can set a badge while running using existing counts. Updating it while backgrounded or closed also needs backend push support. Recommended scope: an authoritative backend total, foreground reconciliation in Flutter, and native badge values in push payloads. iOS supports the numeric experience; Android support depends on the launcher.

## Count definition

`total = claimableUnopenedBoxes + unreadNotifications + unreadChatMessages`

| Component | Proposed meaning                                                                                                                            | Current app source                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 未開寶箱  | Actual boxes awarded today, still unopened, active and non-expired, including zero-reward boxes                                             | `claimableTreasureBoxCountProvider` in `lib/provider/treasure_box_provider.dart` |
| 未讀通知  | All unread, non-deleted Message Center records, independent of page/category/search                                                         | `messageStatsNotifierProvider.data.total`, backed by notification SSE stats      |
| 新訊息    | Unread incoming support/seller messages across all accessible active chatrooms; count messages, not rooms, and exclude the user's own sends | `chatSyncProvider.totalUnread` from authoritative `listState`                    |

Example: 2 boxes + 3 notifications + 4 chat messages = **9**. Do not add orders, cart items or promotions as separate components in v1; their notifications already contribute where applicable.

The backend working plan specifies **today-only boxes, including `zero_reward`**. `claimableUnopenedBoxes` therefore does not mean only rows with `accountingStatus = claimable` and does not require a positive coin amount. Use these predicates together:

- The box belongs to the authenticated user, `isActive = true`, and `isOpened = false`.
- `accountingStatus` is `claimable`, `zero_reward`, or null for legacy rows; exclude `acquired` and `unacquired`.
- `claimDeadlineAt` is null or strictly later than the server's evaluation time. At the deadline the box stops counting even before maintenance changes its status.
- For rows with `userLocalDate` and `timezoneSnapshot`, compare the stored date with today's date in that snapshot timezone. For legacy rows, derive the date from `earnedAt` using `effectiveTimezone(user.timezone)` (fallback: `Asia/Taipei`). Do not use the server calendar date or a rolling 24-hour window.

The current list endpoint only filters by user and `isActive = true`; it does not enforce the date/deadline rules above. Flutter also does not evaluate those dates in its current count provider. Align that in-app counter with the same eligibility rule during implementation so the home tab and app icon do not disagree.

Count persisted items once: SSE and FCM delivery of the same item must not add two. The inspected chat workflow sends `command: chat_message` without creating a Message Center row, and no production creation call explicitly using notification type `chat_message` was found. Keep all unread notification categories in v1; do not subtract that category speculatively. If a future workflow creates linked mirrors, define deduplication then. Existing independently persisted notifications remain included, even if they describe a box or order.

Opening the app or a list does not clear the badge. Reading a notification, reading chat messages, opening a box, or an item's deletion/expiry reduces the relevant count. Zero clears the iOS badge. Pass the actual integer to the OS, not the in-app `99+` string.

## Current implementation findings

- Firebase Messaging and local notifications already request badge permission. Neither `lib/service/local_notification_service.dart` nor `ios/Runner/AppDelegate.swift` currently writes an aggregate icon count.
- Both SSE hosts run above navigation and close their streams outside the foreground. They cannot maintain an icon badge while the app is suspended or terminated.
- Chat and notification counts are global server totals, so pagination does not need to load all records.
- The treasure provider builds ten UI slots. Both backend award paths enforce `treasureBoxesEarned < 10` per daily cycle, but `getTreasureBoxesByUserId` has no result limit. Query eligible rows directly; do not clamp the badge to ten or count padded UI slots. Keep optimistic open-box updates out of the confirmed badge until success.
- FCM device registration and removal already exist at `/api/auth/device-token`. The background Dart handler currently only logs messages.
- Foreground push handling in `lib/main.dart` suppresses alerts for the currently open chatroom/explore page. Badge reconciliation must happen independently of that alert suppression.

## Backend findings and required integration points

| Backend location                                                                                    | Verified behavior                                                                                                                                           | Badge work required                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/repository/notificationSync.ts`: `statsInTransaction`, `publishChanges`, `mutateNotifications` | Counts unread, non-deleted rows across all categories; writes publish notification SSE in the transaction                                                   | Reuse these count predicates and invalidate the aggregate for actual count changes, including legacy callers                             |
| `src/repository/chatroomSync.ts`: `chatListState`; `src/repository/chatroom.ts`                     | Counts unread messages with `senderType != user`, joined to active rooms belonging to the user; sending a user message can also mark incoming messages read | Cover new messages, explicit/automatic reads, room status and ownership changes; notify both old/new owners when applicable              |
| `src/repository/treasureBox.ts`: award/open/reset paths                                             | Supports ledger and legacy paths, zero-reward boxes and nullable legacy accounting fields; daily reset deactivates existing boxes                           | Cover successful awards, openings, reset/deactivation, and date/deadline transitions in both modes                                       |
| `src/repository/coinLedger.ts`: `expireUnclaimedTreasureBoxes`; `src/lib/scheduler.ts`              | Expiry selects only `accountingStatus = claimable`; ledger maintenance runs every 30 minutes and is disabled when `NO_CRON=true` or ledger mode is off      | Badge reconciliation must also handle expired `zero_reward` boxes and legacy local-day rollover, independently of financial settlement   |
| `src/services/order.ts`, `src/services/refund.ts`, `src/lib/polling.ts`                             | Order push starts before notification creation; refund/delivery pushes and notification inserts run concurrently                                            | Persist the notification first, then calculate the aggregate and send the push                                                           |
| `src/services/chatroomNotification.ts`, `src/lib/coinExpiryNotificationJob.ts`                      | Chat push runs after its message transaction; coin-expiry notice is saved before sending                                                                    | Preserve this ordering and attach the current user's badge snapshot                                                                      |
| `src/services/system.ts`, `src/lib/scheduler.ts`, `src/repository/notification.ts`                  | Admin broadcasts/daily reminders can combine tokens from different users into one multicast; some are push-only                                             | Personalize by user when adding badge data; push-only alerts do not add to the count                                                     |
| `src/repository/user.ts`: `upsertDeviceToken`; `src/db/schema.ts`: `deviceTokenTable`               | FCM token is globally unique, but upsert resolves only `(userId, deviceId)` conflicts                                                                       | Transfer token ownership transactionally on account switch; current code can hit a unique-token conflict if the old registration remains |
| `src/lib/sendNotification.ts`                                                                       | Passes through payloads, prunes invalid tokens and catches transport errors; has no badge enrichment or durable retry                                       | Add user-aware orchestration above this transport; do not attach one user's total to an arbitrary multicast                              |

There is currently no `/api/app/badge` mount in `src/app.ts`, shared badge revision, or aggregate badge implementation. Existing chat/notification revisions cannot be combined with `max()` or addition to represent treasure changes.

## Proposed backend changes

### Aggregate endpoint

Add authenticated `GET /api/app/badge`, using the Bearer token's user without a `userId` query parameter:

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

Return nonnegative integers from one consistent server snapshot. `nextReconcileAt` is a nullable UTC ISO timestamp for the next local-day/deadline boundary that can change the box count; Flutter uses it for a single foreground refresh, not recurring polling. It is a refresh hint, not authorization to decrement locally. The endpoint must work without SSE and with either coin-ledger mode.

Mount an app router in `src/app.ts`, protect it with the existing app `isAuth`, and use `req.userId` following `src/controller/notificationSync.ts`. The shared `isAuth` also accepts admin-account tokens, so additionally require an existing app user (as `requireNotificationUser` does); do not return an empty badge for an admin account. Follow router → controller → service → repository. Reuse count predicates through transaction-aware helpers; do not call helpers that start their own transactions inside a new aggregate transaction.

**Revision implementation proposal:** add a persisted per-user badge snapshot with a monotonically increasing revision and component counts. Serialize reconciliation for a user, then read all counts in one database snapshot and persist the counts/revision together. Increment when any observed component changes, even when the total stays equal; coalesced intermediate states need not be delivered. Concurrent workers must not overwrite a newer snapshot with an older query result. Use the same reconciler for REST and push dispatch, including time-based changes. A timestamp or process-local counter is not a substitute for a durable revision.

This design needs a schema change/migration (an alternative durable design can be agreed with BE). Existing feed tables have different locks and revisions. Keep lock ordering consistent with chat's admin-publication/feed/room locks and treasure-box box/user locks; do not bolt new cross-domain locks into callbacks without reviewing their order.

Store affected-user invalidation/outbox work in the successful domain transaction, then reconcile and send through a worker after commit. This covers legacy and sync writes, cron jobs, and failures between commit and push. Coalesce pending work per user and retry bounded transient delivery failures; do not perform FCM calls inside database transactions. The low-level transport currently catches failures, so the worker needs a structured outcome to retry them. This is proposed reliability work, not an existing backend capability.

Add a badge reconciliation job for due box boundaries and daily resets, including `zero_reward`, legacy dates and users without a current app session. The current 30-minute financial maintenance schedule does not provide immediate badge expiry and misses zero-reward rows in its expiry selector. Specify the badge job's cadence/SLA with BE; REST must apply the deadline immediately regardless. In `NO_CRON` environments, tests should invoke the job explicitly. Reconcile users with existing counts during rollout/registration; no historic notification replay is needed.

### Push payloads

After committing a relevant change, attach the absolute total to the existing push. Preserve `command`, `notificationId`, and `chatRoomId` for navigation. Example additions using Firebase Admin Node SDK field names:

```json
{
  "data": {
    "badgeTotal": "9",
    "badgeVersion": "42",
    "badgeUserId": "CURRENT_USER_ID"
  },
  "apns": {
    "payload": {
      "aps": { "badge": 9 }
    }
  }
}
```

Introduce a user-aware helper such as `sendUserPush(userId, payload)`: resolve only that user's current device tokens, reconcile their badge, merge badge fields without losing the existing payload, and dispatch batches of at most 500 tokens. For broadcasts, retain the user-to-token mapping and personalize each user's payload. Existing arbitrary-token admin pushes should either resolve authorized recipients or omit badge fields; never guess ownership. Their current push-only semantics must remain unchanged.

Order/refund/delivery producers must await notification persistence before calling this helper. A successful mutation without a normal alert still needs count-only delivery to other devices. Coordinate the outbox and normal push workflow so one event does not create two visible alerts.

FCM data values are strings; `aps.badge` is an integer. Always send an absolute value, including zero; do not instruct clients to increment/decrement per push. `badgeUserId` lets a running app reject a previous account's message. It does not prevent the OS from applying an already queued APNs badge.

Reconcile after box creation/claimability/expiry/opening/local-day rollover/reset, notification creation/read/deletion, incoming chat messages/read receipts, and room access changes. Notify all devices registered to the affected account, including changes initiated on another device. When a normal alert already exists, reuse it rather than sending an additional visible alert. For count-only changes, propose `command: badge_sync` with no banner/sound; iOS can carry just the native badge. A badge-bearing APNs request uses the `alert` push type even without alert text. Pure silent background notifications are a different mechanism and must not be the only way to maintain the badge. [Apple APNs request types](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [Apple background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).

Compute current totals when dispatching and coalesce obsolete count-only work. Push delivery/order is not guaranteed: app-side revisions reject stale values while running, but cannot order badges already applied by iOS while terminated. REST reconciliation on launch/resume repairs drift. Do not promise instantaneous accuracy on an offline device. [Apple remote notification payloads](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CreatingtheNotificationPayload.html).

## Proposed Flutter changes

1. Add a session-scoped `AppBadgeController` and a platform service above navigation. Persist the last confirmed snapshot per account if needed; never share it across accounts.
2. Fetch the aggregate after login/account restoration and each foreground resume. Refresh after successful relevant mutations and changes to existing chat/notification aggregate revisions. Coalesce bursts, allow one request at a time, and schedule a follow-up if another invalidation arrives during that request. Also refresh once at `nextReconcileAt` while foregrounded and re-arm from the response; cancel that timer outside the foreground. No periodic client polling or third SSE stream is needed for v1.
3. Handle `badge_sync` and badge metadata in foreground FCM even when there is no visible notification or the current-page alert is suppressed. Reconcile with REST; treat push as a hint and do not insert duplicate list items. Remote treasure changes can use this path, with resume refresh recovering missed pushes. A `badge_sync` event must not open a page or create a blank local notification.
4. Use only a complete confirmed aggregate for the icon. Failed/loading requests retain the last value; a missing source must not be interpreted as zero. Apply new snapshots by badge version and ignore responses from a previous login session. Do not publish the treasure UI's optimistic count before its mutation succeeds.
5. On iOS, set the count directly through a small native bridge (`UNUserNotificationCenter.setBadgeCount` where available, with an availability-gated older-iOS fallback). Align local-notification badge settings with the controller so foreground banners cannot overwrite it with a stale/default count. Check existing deployment targets during implementation. [Apple badge setter](<https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/setbadgecount(_:withcompletionhandler:)>).
6. On logout/account switch, clear the local badge/cache, invalidate pending work, and remove the device's old account binding. Fix BE token ownership transfer as described above. Ensure Flutter awaits/remembers failed deregistration appropriately while it still has the old account credentials, and registers the new binding after account changes. An already queued push can still arrive; repair on the next authenticated sync.

## Platform behavior

| Situation                            | Intended behavior                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Foreground, on any page              | Refresh the aggregate from relevant events/actions and update the native badge      |
| Background or normally terminated    | Native push payload carries the latest count; do not depend on Flutter code running |
| Resume or cold start                 | Reconcile the authoritative aggregate after authentication                          |
| Permission denied or badges disabled | Preserve in-app counters; respect OS settings                                       |
| Force-stop, offline or missed pushes | No guarantee of immediate updates; reconcile when the app can run again             |

On iOS, badge permission is required; a positive badge value sets the number and zero removes it. The OS controls its visual placement and appearance. [Apple badge behavior](https://developer.apple.com/documentation/usernotifications/unmutablenotificationcontent/badge).

Android badges are tied to active notifications and the launcher. Some show dots, some numbers; a universal persistent numeric count is not available. Start with normal notification badges and accept a dot fallback. Do not create a permanent notification solely to force a number. If numeric Android support is required later, evaluate a single summary notification and supported launchers separately. Setting the full aggregate on every separate notification risks overcounting; `notificationCount: 0` is not a universal clear operation. Remove/update the relevant app-owned notifications when reconciling. [Android badge behavior](https://developer.android.com/develop/ui/views/notifications/badges), [Firebase notificationCount semantics](https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.androidnotification#androidnotificationnotificationcount).

Force-stop/background execution restrictions also apply: iOS swipe-away restricts background message handling, and Android force-stop from settings requires reopening before messages work again. Native APNs badge delivery and Dart background execution are distinct. [Firebase Flutter lifecycle restrictions](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages).

## Delivery and verification

1. Confirm the today-only box rule from the BE working plan and agree on the aggregate/revision migration, per-user push helper, token transfer, and deadline-job cadence.
2. Implement the Flutter controller/platform bridge and backend aggregate/push changes. Keep existing push tap navigation and SSE behavior intact.
3. Test exact count predicates: `zero_reward`, nullable legacy status, acquired/unacquired, midnight in stored/fallback timezones, deadline equality, and expiry before cron. Cover all unread notification categories, active-room ownership, explicit reads and read-on-send. Test app-user isolation and rejection of admin-only tokens, sums, zero, incomplete/error states, stale versions, concurrent reconciliations, logout races, and failed mutations.
4. Backend regression tests must also cover per-user broadcast totals, persist-before-push ordering, two accounts reusing one token, replayed/no-op writes, jobs with ledger on/off, and retry/coalescing after dispatch failure. Mock FCM; do not send real pushes from automated tests.
5. Test on physical iPhone and representative Android launchers: foreground/background/terminated, disabled badges, two devices, read/delete/open/expiry, duplicate or delayed push, and account switching. Confirm notifications do not multiply or disappear unexpectedly.

A Flutter-only first phase is possible using existing providers, but would update only when the app can run and those providers are current. The recommended release includes BE support so the iOS icon can update while the app is closed, with the documented Android fallback.
