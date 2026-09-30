# Chatroom SSE — backend feasibility review

Date: 2026-09-29

Status: **SSE reviewed; SSE implementation and deployment have not started**. The room authorization prerequisite is now implemented locally; see [authorization changes](CHATROOM_AUTHORIZATION_API_CHANGES.md). This is a response to [FLUTTER_CHATROOM_SSE_API_PLAN.md](FLUTTER_CHATROOM_SSE_API_PLAN.md), not confirmation that its proposed endpoints are available.

## Decision

The plan is implementable, but its complete contract needs durable synchronization state that this backend does not currently have. **SSE transport alone does not require a database schema change. The proposed crash-safe, replayable chat synchronization does.** For this repository, the recommended implementation is additive PostgreSQL migrations; a separate Redis service is not necessary.

If keeping the existing schema is a requirement, revise the proposal to a smaller live-update contract with a full REST resync after every connection loss. That is a different contract and must not advertise 24-hour durable replay or persistent message retry deduplication.

The original review changed no runtime code, environment files, or database state. The subsequent authorization fix is documented separately below. Swagger remains admin-only; the Flutter API contract belongs in Markdown handoff documents.

## Backend findings at review time

| Area | Verified behavior | Consequence |
| --- | --- | --- |
| Chat storage | `chat_rooms`, `chat_messages`, and attachments already exist. Messages store sender role, content, `isRead`, and timestamps. | Reuse existing message/attachment storage. No current `clientMessageId`, authenticated sender identity, message revision, room revision, or user-feed event journal. |
| History | Defaults to 20, supports page/limit and `startAt`/`endAt`, orders only by `createdAt DESC`. | A `before` cursor and `(createdAt DESC, id DESC)` tie-breaker can be added without new columns. Consider an index for large histories. Preserve old page-based clients and their explicit limits. |
| User room list | Filters by user ID, active status, and existence of at least one message. Returns per-room unread counts. Uses live offset pagination. | Empty accessible rooms are currently hidden. There is no global unread/list revision or frozen list snapshot. List membership needs an explicit empty-room decision. |
| Sending | Message and attachments are written transactionally. Sending also marks unread messages from other sender roles as read. | A send can produce both message-created and read-state events. Publishing only from the explicit mark-read endpoint would miss changes. |
| POST response | Currently `{ success: true, data: <canonical message> }`, including attachments. | Preserve this shape and add fields to the message; changing to `data.message` is unnecessary and may break other clients. |
| Explicit read | Marks every currently unread message in the room whose `senderType` differs from the supplied reader role; returns changed rows. | Current semantics are not limited to messages visibly rendered by Flutter. Seller/admin are distinct roles in this predicate. |
| Mutation sources | App/admin REST share chatroom services/repositories. Refund automation calls chat repositories directly. Room creation can reactivate a room or attach an order. | Event creation must cover repository transactions and automation, not just app controllers. |
| Auth | `isAuth` verifies the token. The list is user-scoped, but detail/history/send/read do not pass caller identity through to room authorization. | Add ownership/account-scope checks to every room operation before launching SSE. |
| Runtime | Scripts use PM2; no shared chat replay/fanout implementation was found. Actual deployed process count and proxy limits are not established by these scripts. | Validate deployment topology, streaming behavior, and connection limits in staging. |

Code reviewed: [schema](../../src/db/schema.ts), [chat repository](../../src/repository/chatroom.ts), [controller](../../src/controller/chatroom.ts), [service](../../src/services/chatroom.ts), [app validation](../../src/middleware/chatroom.ts), [admin validation](../../src/middleware/admin/chatroom.ts), [authentication](../../src/middleware/isAuth.ts), and [refund-generated messages](../../src/services/refund.ts).

## What can use the existing schema?

- One authenticated `/api/chatroom/events` stream per foreground app session, with headers, heartbeats, disconnect cleanup, and bounded output queues.
- Deriving the user's rooms on the server, and enforcing room ownership on REST and delivery paths.
- REST history requests of 20 messages, opaque room-bound keyset cursors, `hasMore`, and `nextCursor`.
- Live message/read notifications, provided the contract explicitly states the delivery limitations and reconnect resync behavior.
- Existing file uploads, message storage, and FCM payloads.

A process-local emitter only reaches connections attached to that process. PostgreSQL `LISTEN`/`NOTIFY` can wake other connected API instances without a new schema, but it is not a retained user-feed log. PostgreSQL sends notifications after transaction commit to registered listeners; the documented mechanism supplies no client-checkpoint replay API. Use it as a wake-up signal for a durable journal in the full design. [PostgreSQL NOTIFY documentation](https://www.postgresql.org/docs/current/sql-notify.html).

SSE defines event framing and `Last-Event-ID`; storing and replaying the corresponding events is application work. [SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html).

## Durable state required by the full proposal

Recommended design, subject to final schema design and workload sizing:

1. **Per-user feed state and event journal.** Persist the feed head, retained replay boundary, and ordered event records. Write the message/read change, associated summary/list revisions, and all event records in the same transaction. Retain events for at least the agreed 24 hours. A single journal can serve both transactional outbox and replay storage.
2. **Stable revisions.** Persist room and user-list revisions, including removal/regrant state. Message revisions should be updated atomically with exposed changes. For today's strictly monotonic unread-to-read lifecycle, a derived message revision is possible, but timestamps alone do not implement all the proposed room/list ordering guarantees.
3. **Persistent client message identity.** Add nullable `clientMessageId` plus authenticated sender identity and an appropriate uniqueness constraint, or an equivalent dedicated persistent deduplication record. Enforce room/sender/key uniqueness inside the send transaction; compare content and canonical attachment input before returning a retry result or conflict. Keep deduplication for the message's lifetime, independent of event retention.
4. **Frozen list membership/order.** Store bounded, user-scoped snapshot state with expiry if the 15-minute cross-request/cross-instance snapshot contract is retained. It need not be in the relational database if another shared store is introduced. An in-memory cache can instead invalidate missing snapshots, but that weaker availability behavior needs explicit agreement. Do not hold a database transaction open for a user's scrolling session.

There is an existing generic `idempotency_keys` table, but its cleanup removes old rows regardless of request namespace (default retention is three days). It cannot be reused unchanged to promise chat retry deduplication for the life of a message. Reuse would require deliberate namespace/retention and concurrency changes.

Ordering needs care: allocating a global sequence number before commit does not itself guarantee commit-order delivery. Serialize each user's chat mutations/feed-head updates with a consistent locking policy so a later committed cursor cannot skip an earlier transaction. Lock ordering must be consistent for room and feed state. Persist event payloads/revisions from the same committed state rather than rebuilding historical events from current rows after commit.

A dispatcher should read the journal in order, replay strictly after the checkpoint, and then continue live without a gap. Optional notifications reduce latency; journal catch-up also runs after listener reconnects or missed wake-ups. Heartbeats do not query history. If continuity cannot be maintained, reset rather than silently skip events.

## Contract points for SSE implementation

### Authorization and room access

The subsequent authorization fix now requires an existing authenticated user and an active room owned by that user for app operations. Seller/admin operations derive the actor and scope from the authenticated account and reject mismatched `senderType` or `readerType`; automated refund messages use an explicit internal path. Future SSE and snapshot implementations must apply the same access policy at delivery time.

The subsequent fix also validates supplied order/product/account relationships before creating, associating, or reactivating a room. Orders must belong to the user and product rooms must match the product seller; see the authorization handoff for the exact rules.

Register `/events` before `/:chatRoomId`. Close streams at JWT expiry. Immediate session revocation is not currently provided by `isAuth`; do not promise it without a revocation mechanism. Access-removal guarantees must cover every supported access-change path and invalidate old snapshots/replays.

### Read semantics

Recommended rule: users read seller/admin messages; seller/admin readers read user messages. Today, `senderType != readerType` also allows a seller to mark admin messages read and vice versa. Confirm the intended support-side behavior before changing it.

Preserve current automatic mark-read-on-send behavior initially, and publish the corresponding read patches. An optional `upToMessageId` is a separate behavior change if only displayed messages should be acknowledged. Use changed message IDs and versions in events; no-op reads produce no events.

### List semantics and snapshots

Decide whether new snapshot mode includes empty active rooms. The proposal's all-accessible-room feed must subscribe to empty rooms regardless of whether legacy list responses hide them, so their first message is delivered. Keep legacy list behavior compatible and define what `totalRooms` counts for the new mode.

Use the same summary serializer for REST and SSE. The current list transforms variant details into the product summary; do not invent a separate required variant representation based only on the illustrative proposal payload. Read receipts should change unread state/revisions without changing activity order.

Room summaries include live product/variant/order/delivery data. Guaranteeing updates for every exposed metadata change therefore requires identifying those write paths too, or agreeing which changes trigger invalidation and reload. A journal attached only to chat-message writes is insufficient for that full promise.

Snapshot tokens must bind user, query, page size, and expiry. Preserve frozen page boundaries while filtering newly unauthorized rooms. A signed token containing only a timestamp cannot reconstruct an old mutable ordering without retained snapshot data or equivalent history.

### History and response compatibility

Keep page-based history and the current POST response shape. Add opaque room-scoped `before` cursors; reject mixing `before` with `page` and explicitly define whether legacy date filters may accompany a cursor. Preserve full PostgreSQL timestamp precision in cursor boundaries to avoid skips among messages created within one millisecond.

Use a consistent read point for each history response and primary/causally current reads after `stream.ready`. Additive `clientMessageId` and `version` fields should use the same representation in POST, history, last-message summaries, and events. Do not lower the old app's explicit 9999 request limit before its scroll pagination ships.

### Errors and infrastructure

Add explicit machine-readable `code` values for the proposed cursor/conflict/snapshot errors while preserving the existing JSON error envelope. Return errors before starting SSE headers. Confirm 15-second heartbeat, 45-second client watchdog, replay/snapshot retention, connection limits, and slow-client reset behavior under real traffic.

Continue FCM independently of SSE presence. Existing push code requires a product to construct its notification; general support rooms currently exit that path without a push. If general-support notifications are expected, fix that separately within the chat rollout rather than assuming all room types already receive FCM.

Actual proxy/CDN buffering, maximum request duration, and a suitable PostgreSQL connection for listening must be verified in deployment. No infrastructure settings or credentials were changed or printed in this review.

## Implementation choices

| Choice | What ships | Tradeoff |
| --- | --- | --- |
| Full proposal — recommended if its guarantees are required | Additive PostgreSQL migrations, durable user-feed journal, transactional revisions/deduplication, authorized SSE replay, history cursors, and bounded list snapshots. | Larger backend change, but matches the app's proposed synchronization model. |
| Existing-schema first release | Authorization fixes, history cursors, live SSE invalidations/notifications, bounded queues, and mandatory REST resync after every reconnect. | Revise the Flutter plan: no 24-hour replay, crash-safe event delivery, durable clientMessageId deduplication, or full versioned snapshot guarantees. Define how missed notification/listener failures force resync. |

The second choice must be documented as a different contract; it cannot report successful implementation of the original proposal. Avoid silently substituting an in-memory replay buffer for the requested durable feed.

## Suggested implementation sequence and tests

1. Room-authorization prerequisite is implemented. Settle the remaining SSE read/list membership semantics while preserving old clients.
2. Add history keyset pagination and reusable canonical serializers.
3. Generate and review additive schema migrations for the chosen durable design; migrate only the intended environment.
4. Write mutations, revisions, deduplication, and events atomically across app, admin, and automated paths.
5. Add user-stream lifecycle, authorization, replay, retention, and bounded snapshot handling.
6. Verify with isolated PostgreSQL integration tests and multiple API instances, then test through the actual staging proxy before Flutter rollout.

Key tests: foreign-room REST/stream rejection; empty-room first message; equal-timestamp history pages; concurrent duplicate sends; read/POST/history races; two-process event delivery; process failure after commit but before dispatch; disconnect during replay-to-live handoff; expired and foreign cursors; room revoke/regrant; snapshot page reordering; slow consumers; token expiry; and unchanged old-app REST behavior. Keep app routes out of admin Swagger.

This review establishes feasibility and the storage/scope decision. It does not claim these implementation or runtime tests have passed.

## Authorization prerequisite follow-up

Room ownership/account scope, authenticated sender/reader roles, and room-creation relationships are now checked by the backend. Denied writes leave messages unchanged. Tests cover app users, sellers, employees, platform admins, and automated messages. No schema migration is needed for this fix. The synchronization, replay, history cursor, and other SSE work described above remains unimplemented. See [the API changes and validation results](CHATROOM_AUTHORIZATION_API_CHANGES.md).
