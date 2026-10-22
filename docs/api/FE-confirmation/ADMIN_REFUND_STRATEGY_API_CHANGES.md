# 地平線 — refund review and deadline changes

Date: 2026-10-23

Status: **Implemented; local and development migrations applied. Development deployment and staging migration/deployment remain required.**

This supersedes the creation, editable-fields and terminal-state sections of [ADMIN_REFUND_API.md](ADMIN_REFUND_API.md). Swagger at `/api-docs` documents the updated admin contract. Flutter has a [separate handoff](../FLUTTER_REFUND_STRATEGY_API_CHANGES.md).

## Endpoints and permissions

| Method / endpoint | Behavior |
| --- | --- |
| `POST /api/admin/refund` | **Removed. Returns 404.** Remove the admin/seller create-refund UI. |
| `GET /api/admin/refund/list` | Existing pagination/filters; `status` also accepts `rejected`. |
| `GET /api/admin/refund/:refundItemId` | Existing scoped detail, including original request, decision fields, order item and logs. |
| `PATCH /api/admin/refund/:refundItemId/status` | Review/update an existing buyer request. Examples below. |

Use the existing admin bearer token and account onboarding requirements. Active platform admins can manage refunds across sellers; active sellers can manage only their own products. Employees retain their existing seller-scoped read access and cannot write. Foreign-seller detail/update requests return 404. These checks apply to log-only updates and retries too. App tokens cannot manage refunds.

Only the authenticated app buyer creates a request for their own paid order item. Seller identity, initial unit amount and coin/cash breakdown come from the purchase. Initial `extraRefundAmount` is always zero. App-supplied monetary/status/audit fields are rejected.

List parameters remain `page`, `limit`, `userId`, `productId`, `merchantTradeNo`, `startAt`, `endAt`, `status`. Status values: `pending`, `processing`, `completed`, `cancelled`, `rejected`. Date filters on this list select **request creation time**, not pickup or refund deadline. Existing response envelopes remain `{success:true,data:...}`; list data remains `{refunds,total,page,limit,totalPages}`.

## Local/development testing exception

With **`NODE_ENV=local` or `NODE_ENV=development`**, a buyer may request a refund for a **paid** order before delivery/pickup. **For faster testing, the base window is 24 hours and the rejection extension is 12 hours (one tenth of the normal durations).** Delivery/pickup prerequisites are relaxed; ownership, available quantity, strict app input, reviewer permissions and agreement requirements remain enforced.

- If the item already has a trusted pickup window, use that stored window and its existing rejection extensions. Newly recorded pickup windows in these environments last 24 hours.
- Otherwise, use the order's **payment confirmation time (`orders.completedAt`) + 24 hours**, including when no delivery exists. Order creation time is not used. Repeated payment confirmations preserve the first recorded payment time.
- Explicit rejection still sets `max(currentDeadline, rejectedAt + 12 hours)`. New requests and review quantity increases are blocked at or after the effective deadline. Previously accepted requests remain reviewable after expiry.
- If neither a receipt window nor a payment confirmation timestamp is known, block new requests and deadline-extending rejection with `409 PAYMENT_TIME_UNKNOWN`. Do not invent a timestamp for historical data.

Order/delivery detail returns the **effective** window timestamps plus `refundWindowSource`: `receipt`, `payment_for_testing`, or null. `refundReceiptChecksBypassed:true` means delivery/pickup is relaxed, **not that deadlines are ignored**. Use `canRefund` and `remainingRefundQuantity` for actions; an expired window cannot allow a new request.

Payment-based test windows are derived without writing fake receipt timestamps to the item or delivery. Rejection deadline-before/after values are stored on the existing refund decision rows and included when deriving subsequent test eligibility. Once a real pickup window is recorded, it becomes authoritative. Refund detail's raw nested `orderItem` and items nested under order deliveries do not substitute for computed order/delivery detail eligibility.

**Staging, production, test and unknown/unset environments require the normal receipt window below**, with `refundReceiptChecksBypassed:false`; they retain the normal 240-hour window and 120-hour rejection extension and do not use the payment fallback. This correction requires no additional database migration or environment variable.

Previously stored pickup deadlines and rejection extensions are preserved; this change does not rewrite historical database rows. Payment-based fallback windows are recalculated as payment confirmation + 24 hours, while retaining any longer recorded rejection extension. Use fresh test orders for the accelerated flow. FE should display the returned `refundDeadlineAt`, not hardcode either duration.

## Normal-environment deadline and quantity rules

- A trusted pickup/receipt observation starts the item's **240-hour** window. Exactly at the deadline, new requests are no longer accepted.
- Review does not pause the clock. A request accepted on time may be processed, reduced by agreement, completed, cancelled or explicitly rejected after the deadline.
- Explicit rejection changes the affected order-item deadline to **`max(currentDeadline, rejectedAt + 120 hours)`**. The rejection time is the backend decision time, independent of push delivery. All remaining units in that item row share the deadline.
- Every distinct rejected request can extend the window. There is no request-count or extension-count cap. Retrying the same rejection does not extend again.
- Pending/processing quantities reserve units; completed quantities consume them; cancelled/rejected quantities consume zero. There is no separate reservation for an appeal/dispute.
- Cancellation and agreed partial completion do **not** extend the deadline. A new attempt is a new request; terminal rows are never reopened.

Example: a request for two units is agreed down to one in chat. Complete that request for one unit when the refund is actually executed. The other unit is released and can be requested again only while the item's current deadline is open. It is not automatically rejected. Rejecting an entire request on day 8 instead extends its item deadline to day 13; rejecting on day 3 leaves the original day-10 deadline intact.

## Review actions

The PATCH body is strict: unknown keys return 400. Keep using the existing endpoint, not PUT. Server-owned times, actors, original requests and audit values are never editable.

### Start review

```http
PATCH /api/admin/refund/REFUND_UUID/status
Content-Type: application/json
```

```json
{"status":"processing","message":"Review started"}
```

### Record an agreed adjustment and complete

```json
{
  "status": "completed",
  "quantity": 1,
  "refundAmount": 100,
  "extraRefundAmount": 20,
  "agreement": {
    "confirmed": true,
    "note": "Buyer agreed in the order chat to refund one unit; shipping compensation NT$20."
  },
  "message": "Agreed refund completed"
}
```

- `quantity`: positive integer; total pending/processing/completed quantities cannot exceed purchased quantity. Increasing an existing request additionally requires an open effective item deadline in every environment; review cannot add newly claimed units after expiry.
- `refundAmount`: **per-unit** base amount, positive, rounded to two decimals, capped at `unitPriceAtSale`. Actual changes to quantity **or** this amount require `agreement.confirmed:true` and a nonblank `agreement.note` (max 2,000 characters). The same rule applies whether editing during review or completing in one PATCH.
- `agreement` records the authenticated seller/admin's attestation that the buyer agreed. It is logged with the actor and before/after values. The backend does not read chat to infer consent, and this is not a separate buyer signature/confirmation endpoint. FE should require the reviewer to confirm the chat agreement before submitting an adjustment. Submit the attestation with the adjustment, not as a separate save step.
- `extraRefundAmount`: nonnegative total extra compensation, rounded to two decimals. Only admins/owning sellers can set it on pending/processing requests. A change to this field alone does not require the base-amount/quantity agreement object. There is no new compensation ceiling in this release.
- Existing `reason`, nullable `note`, log `message`, nullable `metadata` remain editable during review. These fields do not replace protected decision/audit fields. Review writes record the actor and audit; status changes retain the existing notification workflow.
- Merely changing quantity does not complete a request. Use `processing` while the agreed resolution is still being executed.

### Explicit rejection

```json
{
  "status": "rejected",
  "rejectionReason": "The parties could not agree on the requested refund."
}
```

`rejectionReason` is required, nonblank, max 2,000 characters. Do not combine rejection with `quantity`, `refundAmount`, `extraRefundAmount` or `agreement`; it returns 400. Rejection atomically records the decision, releases the request quantity and extends the affected item deadline. An optional `message` may accompany the decision; otherwise the reason is used as the log message.

Ordinary cancellation remains `{"status":"cancelled","message":"Cancelled by agreement"}` and gives no extension. There is no buyer cancellation endpoint.

## Response fields and FE display

Refund rows add:

| Field | Meaning |
| --- | --- |
| `originalRequest` | Immutable `{quantity,refundAmount,paidRefundAmount,coins,reason,note}` captured at creation; null for historical requests. Show alongside final `quantity`/amounts when adjusted. |
| `clientRequestId` | Optional buyer retry UUID; null if not supplied. |
| `rejectedAt`, `rejectedBy`, `rejectionReason` | Decision timestamp, authenticated deciding account ID, and reason; null until rejection. |
| `rejectionDeadlineBefore`, `rejectionDeadlineAfter` | Item deadline immediately before/after that decision. The item's current deadline may later advance again. |

Detail `logs[]` add nullable `actorAccountId` and nullable `audit`. Audit contains `before`/`after` values for status, quantity, base/extra amounts, reason, note and metadata, plus `agreement` when supplied. Rejection audit also includes the rejection fields above. Legacy logs may lack these fields. Client metadata is never authoritative decision evidence.

Order detail `data.items[]` and delivery detail `data.items[]` expose:

| Field | Meaning |
| --- | --- |
| `refundReceiptChecksBypassed` | True only for local/development; relaxes delivery/pickup, never the deadline. Use `canRefund` for action eligibility. |
| `refundWindowSource` | `receipt`, `payment_for_testing` (local/development only), or null. |
| `refundWindowStartsAt` | Trusted receipt observation, or payment confirmation for the local/development fallback; otherwise null. |
| `originalRefundDeadlineAt` | Start + 240 hours normally; 24 hours for newly established local/development windows. Historical stored values are preserved. Null if unknown. |
| `refundDeadlineAt` | Current effective deadline, or null. |
| `refundWindowStatus` | `not_started`, `open`, `expired`, `unknown`. |
| `refundBlockReason` | Null, `ORDER_NOT_PAID`, `NOT_RECEIVED`, `RECEIPT_TIME_UNKNOWN`, `PAYMENT_TIME_UNKNOWN`, `REFUND_WINDOW_EXPIRED`, or `NO_REFUNDABLE_QUANTITY`. |
| `canRefund` | Whether a **new buyer request** can currently be created; not whether an existing request can be reviewed. |
| `remainingRefundQuantity` | Available units for a new request; zero when blocked. |
| `unreservedRefundQuantity` | Purchased minus pending/processing/completed quantities, regardless of deadline. |
| `refundServerTime` | Server time used for the display calculation. |

Refund detail's nested `orderItem` includes the stored timestamps; use order detail for computed eligibility. Refresh detail after a review action to get the latest deadline/quantities. Render UTC ISO dates in the viewer's timezone; do not implement a calendar-day deadline calculation. List views are not a substitute for the detail eligibility check.

## Retries and errors

`completed`, `cancelled` and `rejected` are immutable. A matching terminal retry returns 200 without repeating inventory, coin, rejection-extension or notification effects. Different terminal values return **409 `REFUND_TERMINAL`**. If replaying `message` or `agreement`, keep them identical to the original decision's latest log; refreshing detail is preferable to blindly resubmitting edited forms. Semantic JSON object key order is ignored.

Other business errors:

| HTTP / code | FE handling |
| --- | --- |
| 409 `REFUND_AGREEMENT_REQUIRED` | Record buyer agreement before changing quantity/base amount. |
| 409 `REFUND_WINDOW_EXPIRED` | Quantity increase is outside the window. Existing accepted quantity can still be reviewed. |
| 409 `RECEIPT_TIME_UNKNOWN` | Historical receipt must be reconciled before rejection can extend a deadline. |
| 409 `PAYMENT_TIME_UNKNOWN` | Local/development has neither a receipt window nor recorded payment confirmation; contact backend support to reconcile the timestamp. |
| 400 | Invalid body, missing rejection reason, rejection mixed with financial changes, quantity or amount beyond allowed bounds. |
| 401 / 403 / 404 | Authentication, role, or ownership restriction; do not retry as another actor. |

Business errors use the existing JSON error envelope with `code` where listed; request validation uses the existing validation-error envelope.

## Receipt coverage, historical data and rollout

Trusted receipt is captured transactionally from signed logistics callbacks or provider polling. Supported CVS buyer-pickup codes are UNIMARTC2C `2067`, FAMIC2C `3022`, HILIFEC2C `2067`/`3022`, OKMARTC2C `3022`. Store-arrival codes normalize to `ready_for_pickup`, never start the clock, and remain eligible for polling. Older rows that recorded known store-arrival codes as delivered are also eligible for polling. Existing local/development automatic logistics polling remains disabled; use the integration tests for simulated pickup locally.

The timestamp is the first backend observation, marked `receiptEvidence.estimated:true`, because the integration does not supply a verified carrier event timestamp. Delayed callbacks/polls can therefore grant a later deadline. Repeated or older events cannot restart a known window or undo an extension. This release does not add carrier integrations: trusted home-delivery receipt can initialize the window when supplied through an integration, but ordinary seller status edits do not. Virtual items and unsupported/manual receipt flows have no automatic receipt window or new manual reconciliation endpoint.

Unknown historical receipt times are **not** filled with deployment time or mutable `updatedAt`. Prior delivered logs do not have enough provenance for automatic backfill. Existing requests remain reviewable/completable/cancellable. Outside the local/development exception, new requests and deadline-extending rejections require a known window; unknown cases need separately verified receipt reconciliation by backend operations. Do not relabel a rejection as cancellation to bypass this requirement.

Local migration `drizzle_local/0117_watery_oracle.sql` was generated, reviewed and applied. It adds the `rejected` enum value, receipt/window/decision/audit columns, a timestamp-consistency check and the optional retry-key unique index. Local verification found one historical delivered item without a window and 12 pending/processing historical requests without a window; no receipt dates or old decisions were fabricated. Development migration `drizzle_dev/0068_bitter_mandarin.sql` was subsequently generated, reviewed and applied on 2026-10-23; its SQL matches the local migration exactly. Staging remains unmigrated. Deploy these readers and writers together; coordinate Flutter's strict input change and retirement of the admin create UI.

This change preserves existing coin restoration/expiry, cash-remainder rounding and stock restoration. `completed` still records the platform's completion effects; it does **not** call a new card/bank payout API. Perform the existing cash payout procedure before recording completion. No expiry cron or appeal endpoint is required.

Validation: TypeScript build; isolated refund strategy, refund authorization, API end-to-end and coin-ledger integration suites. These tests use disposable databases and do not send real refunds or device pushes.

## Development migration verification — 2026-10-23

The feature was committed as `8bfdc83` and fast-forward merged into `development`. Development migration `0068_bitter_mandarin` is applied; all 69 development migration files match their database journal hash/timestamp records. The server was not deployed/restarted by this operation.

Live PostgreSQL catalog comparison found matching application definitions for 65 tables, 677 columns (types/defaults/nullability), 243 constraints, 166 indexes, 31 enums and one sequence. Neither database has public views, custom functions, user triggers or row policies. Local runs PostgreSQL 17.6 and development 18.6; PostgreSQL 18's separate NOT NULL constraint records are compared through column nullability. Owners, grants, server settings and business row contents are not asserted identical.

Development data checks evaluated all 112 foreign keys and 55 CHECK constraints with zero violations. The refund audit found 22 existing requests across 125 order-item rows, no over-claimed quantities, no invalid refund quantities, and no incomplete rejection decisions or retry keys.

**Legacy data:** 64 paid development orders lack `completedAt`, and no receipt windows are recorded yet. New requests for items without either timestamp will return `PAYMENT_TIME_UNKNOWN` in development. Use newly paid orders for testing or reconcile historical payment/receipt evidence separately. The 22 historical refund rows retain null `originalRequest`; initial request snapshots and receipt times were not fabricated. Environment-specific users/orders/refunds were not copied between databases.

Local's initial `0000_magenta_king_cobra` file has a pre-existing hash mismatch against its journal row. The latest local refund migration hash/timestamp matches, and live schema parity was verified independently. Historical local migration records were left unchanged.
