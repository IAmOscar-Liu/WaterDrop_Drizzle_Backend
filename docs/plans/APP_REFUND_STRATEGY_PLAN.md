# App refund strategy — implemented design

Date: 2026-10-22

Branch: `feat/refund-strategy`

Status: **Implemented and tested; additive migrations applied to local and development.** Development deployment and staging migration/deployment remain pending.

Handoffs: [Flutter buyer flow](../api/FLUTTER_REFUND_STRATEGY_API_CHANGES.md) and [地平線 review flow](../api/FE-confirmation/ADMIN_REFUND_STRATEGY_API_CHANGES.md). These describe the shipped request/response contract and replace the draft choices below with the decisions recorded here.

## Agreed policy

1. Only the authenticated app buyer creates requests for their own paid order items. Admin/seller creation is retired. Active admins and owning active sellers manage existing requests; employees remain read-only.
2. Each purchased order-item row has a **240-hour window after confirmed pickup/receipt**. All units in that row share it. Different delivery rows can have different windows; split pickup dates within one item row would require a separate shipment-quantity model.
3. Review does not pause the clock. A timely accepted request remains reviewable/refundable after the new-request deadline.
4. Explicit rejection releases the request quantity and sets `refundDeadlineAt = max(currentDeadline, rejectedAt + 120 hours)`. Extension applies to remaining units in that order-item row, not unrelated items.
5. Every distinct rejected request can extend the window. **No request-count, rejection-count or cumulative-extension cap.** A duplicate rejection does not extend again.
6. An agreed partial refund completes that request for the final agreed quantity once executed. The unrefunded units retain their current deadline and may be requested again only while eligible. No implicit rejection or extension.
7. Pending/processing quantities reserve units, completed quantities consume them, rejected/cancelled quantities consume zero. No separate disputed-quantity reservation or appeal system.
8. Completed/cancelled/rejected requests are immutable. New attempts use new records. Inventory/coin completion effects run once.
9. The app cannot set `refundAmount`, `extraRefundAmount`, status or arbitrary metadata. Initial amount comes from the sale and extra compensation starts at zero. Only admins/owning sellers can grant extra compensation.

Examples in elapsed time:

| Event | New-request deadline / result |
| --- | --- |
| Pickup | Day 10. |
| Rejection on day 3 | Still day 10. |
| Rejection on day 8 | Day 13. |
| Timely request rejected on day 12 | Day 17. |
| A later timely request is rejected again | At least five days from that distinct decision, without a count cap. |
| Request two, agree to one, complete on day 8 | One consumed; remaining unit can be requested before day 10 unless an earlier rejection already extended it. |
| Same partial completion on day 12 | Accepted request can finish; no new claim for the remainder unless the effective deadline is still open. |
| Cancel or retry an already recorded decision | No additional time. |

At exactly the deadline the window is expired. UTC timestamps represent elapsed hours, independent of timezone/DST. Notification delivery time does not move the decision timestamp or deadline.

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

## Agreement and monetary decisions

Original request values are stored once in `refund_items.original_request`; changing the final quantity/amount does not overwrite them. New admin updates record the authenticated actor and before/after values in refund logs.

Actual quantity or base-unit-amount changes require `agreement: {confirmed:true,note:"..."}`. This is the seller/admin's recorded attestation of a chat agreement, not a separate buyer signature or automatic chat interpretation. A reviewer must not record an unaccepted partial offer as a completed settlement. In every environment, a quantity increase also requires an open effective deadline and available quantity; review cannot add claims after expiry.

The base unit amount remains capped at sale price. Extra compensation stays a separate nonnegative amount; no new ceiling was introduced. No mixed “complete part and formally reject part” outcome exists within one request: complete the agreed amount, or explicitly reject the request. Future quantity-specific settlements would require another model.

Existing coin restoration, original coin expiry, cash-remainder conversion and stock restoration remain in place. This work does not add ECPay/card/bank payout execution, seller earnings settlement, withdrawal logic, new shipping/fee policy, or extended coin validity. Reviewers continue the existing payout procedure before recording completion.

## Architecture and concurrency

- Shared eligibility helper drives order detail, delivery detail and refund creation, applying the explicit local/development receipt-check exception consistently.
- Receipt capture and refund mutations acquire a transaction-scoped per-order PostgreSQL advisory lock before related row locks. Creation checks database time after acquiring locks. This serializes quantity claims, review changes and receipt/window initialization for an order.
- Rejection, quantity release, effective deadline and audit commit together. Requests are accepted only when paid, owned, received, within the effective window and within available quantity.
- Optional `clientRequestId` UUID scopes retries to an order item. A canonical payload fingerprint distinguishes retries from conflicting reuse. Matching retries return the existing request's current state even after expiry; they do not recreate messages/notifications. A unique index backs the transaction check. New deliberate attempts use new keys.
- Terminal update retries compare saved fields/latest decision log and produce no additional financial, stock or extension effects; conflicting terminal changes return 409.
- New `rejected` status is excluded from quantity consumption everywhere the shared refund eligibility is calculated.
- Admin creation route/controller/service/validator/Swagger operation are removed. The shared creation repository also rejects account actors. App creation accepts only its dedicated strict schema, and management preserves account/ownership checks on every write.

## Receipt evidence

Only trusted signed logistics callbacks or provider polling establish receipt. Supported CVS codes distinguish actual pickup from store arrival. Arrival normalizes to `ready_for_pickup`; older delivered rows with known arrival codes remain eligible for polling. Callback persistence failures return an error instead of acknowledging an uncommitted receipt.

The integration lacks a verified carrier event timestamp, so the first backend observation is stored with `receiptEvidence.estimated:true`. Delayed observation may grant a later window. Duplicate/out-of-order callbacks and polls do not restart a known base deadline or reverse an extension. New items attached to a delivery with an established receipt inherit that original time.

Home-delivery receipt capture is supported for a trusted integration reporting delivery; no new carrier integration or seller-controlled receipt endpoint was added. Ordinary seller edits cannot manufacture receipt fields. Virtual products, unsupported/manual receipt flows and unknown historical evidence do not automatically receive a window. Existing automatic logistics polling remains disabled in local/development.

Historical logs lack sufficient provenance for automatic receipt backfill. A previously confirmed-delivered log prevents a repeated poll from inventing a fresh pickup time. Historical unknown windows remain null rather than using mutable `updatedAt`, order creation, or deployment time. Existing requests can still be reviewed/completed/cancelled; outside the local/development testing exception, new requests and deadline-extending rejection require verified receipt reconciliation. No general-purpose manual timestamp correction API ships in this change.

## Additive database changes and rollout

| Table | Addition |
| --- | --- |
| `deliveries` | Nullable `received_at`, `receipt_evidence`. |
| `order_items` | Nullable `refund_window_starts_at`, `original_refund_deadline_at`, `refund_deadline_at`; check requires all-null or consistent populated values. |
| `refund_items` | Nullable original request snapshot, retry UUID/fingerprint, rejection timestamp/actor/reason and deadline-before/after. Unique `(order_item_id,client_request_id)` index. |
| `refund_logs` | Nullable authenticated actor FK and audit JSON. |
| `refund_status` | Add terminal `rejected`. |

`drizzle_local/0117_watery_oracle.sql` was generated/reviewed/applied. The applied migration hash/journal timestamp, enum, columns, FKs, check and unique index were verified against local PostgreSQL. Existing local data includes one delivered item without a known window and 12 pending/processing historical requests without a window. They were not assigned invented timestamps. Historical `cancelled` records were not reinterpreted as rejections.

Development migration `0068_bitter_mandarin` was generated and applied on 2026-10-23 after merging the feature; its SQL matches local `0117_watery_oracle`. Live application schemas match, with PostgreSQL-version-specific NOT NULL catalog differences normalized. Staging/test databases were not migrated. Deploy receipt writers, refund writers and eligibility readers together. The [admin handoff](../api/FE-confirmation/ADMIN_REFUND_STRATEGY_API_CHANGES.md#development-migration-verification--2026-10-23) records verification and legacy payment-timestamp limitations. Coordinate the Flutter request-body restriction and removal of the admin creation UI. No expiry cron or one-off deadline reset script is needed.

## Verification

The new isolated refund-strategy suite covers actual-pickup versus arrival, window initialization, duplicate/out-of-order updates, exact cutoff, app/admin separation, strict monetary input rejection, concurrent retry deduplication, quantity limits, agreement requirements, rejection after expiry, repeated distinct extensions, idempotent terminal decisions, partial completion, stock retry safety, cancellation, unknown history and Swagger separation.

Existing refund authorization, API end-to-end and coin-ledger suites validate role/ownership behavior and preserved cash/coin completion calculations. Suites create disposable databases from the current schema; they do not migrate configured test/dev/staging databases or send real refunds/pushes. Environment tests also cover paid pre-delivery requests in local/development, unchanged unpaid/ownership/quantity checks, payment-confirmation fallback with a 24-hour cutoff and 12-hour rejection extension, accelerated pickup windows, persisted rejection extensions without fabricated receipt evidence, expired-window rejection, missing payment timestamps and duplicate payment callbacks, and strict staging/production/test/unknown-environment behavior. Build and diff checks are required before handoff. Actual carrier delivery timing, frontend rendering and payout operations still require environment testing.
