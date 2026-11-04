# Admin FE handoff: product-specific refund windows

Date: 2026-11-03
Last reviewed: 2026-11-04

Implemented in source. Local refund-window and payment-safety migrations are applied. Development/staging migrations are generated and still require application/deployment. Production requires its established migration baseline and deployment. Apply each environment's migrations before starting the updated server.

## Product editor and APIs

Use the existing admin bearer token and existing seller/admin permissions.

| API | Change |
| --- | --- |
| `POST /api/admin/product/create` | Optional `refundWindowDays` in the existing product body; omission defaults to **8**. All other required product fields and variants remain required. |
| `PUT /api/admin/product/:id` | Optional `refundWindowDays`; omission preserves the current value. |
| `GET /api/admin/product/list` | Product rows include `refundWindowDays`. |
| `GET /api/admin/product/:id` | Product detail includes `refundWindowDays`. |

`refundWindowDays` is a JSON integer from 0 through 3,650,000, or explicit JSON `null`. The upper bound keeps computed dates within the supported timestamp range. Negative values, fractions, strings and booleans return HTTP 400. It applies to the product and all its variants.

| Value | UI meaning |
| --- | --- |
| `0` | No refund requests |
| Positive integer, e.g. `3`, `7`, `8`, `10`, `50` | Refund requests within that many days after confirmed pickup/receipt |
| `null` | No expiration after confirmed pickup/receipt |

Suggested editor: options “No refunds”, “Within N days” and “No expiration”. Initialize new products to 8 days. Send `0` and `null` explicitly; do not drop them using truthiness checks or convert an empty input to zero. Do not put this setting on individual variants.

Example updates (separate requests):

```http
PUT /api/admin/product/PRODUCT_UUID
Content-Type: application/json
Authorization: Bearer ADMIN_TOKEN
```

```json
{"refundWindowDays":7}
```

```json
{"refundWindowDays":0}
```

```json
{"refundWindowDays":null}
```

The existing response envelope is unchanged: `{ "success": true, "data": { ...product, "refundWindowDays": null } }` for an unlimited product.

## Order, delivery and refund review

`GET /api/admin/order/:id` and `GET /api/admin/delivery/:deliveryId` return computed eligibility on `data.items[]`. Use `refundWindowDaysAtSale` for the purchased policy. The server snapshots it at `POST /api/order` creation from the locked product row, before payment; changing a product later does not change an existing order, including one still pending payment. ECPay checkout, payment confirmation and rejection extensions do not overwrite the purchase snapshot.

| Field | Contract |
| --- | --- |
| `refundWindowDaysAtSale` | Integer or null. `0` disables requests; null is unlimited; positive is the purchased number of days. |
| `refundWindowStartsAt` | ISO timestamp, or null when no applicable receipt/payment time is known. |
| `originalRefundDeadlineAt` | Initial finite deadline; null for unlimited, disabled, or unknown timing. |
| `refundDeadlineAt` | Effective finite deadline including rejection extensions; also nullable. |
| `refundWindowStatus` | `disabled`, `not_started`, `open`, `expired`, `unknown`. Unlimited items become `open` once started. |
| `refundBlockReason` | Adds `REFUNDS_DISABLED`; existing reasons remain supported. |
| `canRefund` | Authoritative eligibility for a **new buyer request**. |
| `remainingRefundQuantity` | Units eligible for a new request; zero when blocked. |
| `unreservedRefundQuantity` | Purchased quantity minus pending/processing/completed quantities, independent of eligibility. |
| `refundWindowSource` | `receipt`, `payment_for_testing`, or null. |
| `refundReceiptChecksBypassed` | True only in local/development. |
| `refundServerTime` | Server timestamp used for eligibility calculation. |

A null deadline does **not** establish eligibility. Check the policy, `canRefund`, status and block reason. Keep existing refund records visible even when no new request is allowed. Refund detail's raw nested order item includes the policy snapshot and stored timestamps; use computed order detail for action eligibility, not list views or live product settings.

Credit and ATM now both use `payment-processing` while payment is being confirmed or recovered. A new refund request requires the server's `paid` status; `payment-processing` returns `canRefund:false` and `ORDER_NOT_PAID`. Do not enable buyer refund actions from a payment result screen, an `open` window label, or a provider charge visible outside the saved order. Local/development fallback uses the first saved `orders.completedAt` after verified settlement; staging/production still require trusted receipt evidence. See [payment safety and operations](../PAYMENT_SAFETY_API_CHANGES.md) for callback recovery, reservation retention and the restricted app order-status endpoint.

The existing `PATCH /api/admin/refund/:refundItemId/status` endpoint and permissions remain unchanged. Finite rejection sets `max(currentDeadline, rejectionTime + 120 hours)` (12 hours in local/development). Unlimited rejection records reason, actor and time but keeps `rejectionDeadlineBefore` and `rejectionDeadlineAfter` null. Render those nulls as “No expiration”, not a missing-time error, when the purchased policy is unlimited. Quantity increases still require buyer agreement and an open effective window; unlimited windows support them after starting. Accepted requests remain reviewable after a finite deadline. Retrying a terminal decision does not repeat its effects.

For an agreed partial refund, use the existing quantity adjustment and buyer-agreement attestation, then complete the agreed quantity. Render the final `quantity` alongside `originalRequest.quantity` (for example, 1 completed of 2 requested). The record is `completed`; the other unit is released without a separate `rejected` row or rejection extension. There is no new partial-rejection status or request-splitting endpoint. Explicitly rejecting an entire request remains a separate action and requires `rejectionReason`.

Receipt coverage is also unchanged: an admin delivery-status edit or a delivery-follow-up chat message is not trusted receipt evidence. Virtual items currently have no automatic receipt-window initialization, and manual/seller-managed home delivery needs trusted receipt evidence before normal-environment refunds become eligible. Even unlimited policies must have a valid start; FE should show `NOT_RECEIVED` / `RECEIPT_TIME_UNKNOWN` and escalate for backend reconciliation rather than invent a deadline or timestamp. A successful local/development test via payment fallback does not demonstrate production receipt support.

## Environment and rollout

Finite windows use exact elapsed hours, never calendar-day midnight. Local/development divide the configured duration by ten:

| Configured days | Staging/production/test | Local/development |
| --- | --- | --- |
| 3 | 72 hours | 7 hours 12 minutes |
| 7 | 168 hours | 16 hours 48 minutes |
| 8 (default) | 192 hours | 19 hours 12 minutes |
| 50 | 1,200 hours | 120 hours |

`0` stays disabled everywhere. Unlimited stays unlimited but still requires payment, quantity and receipt eligibility. Local/development retain the payment-confirmation fallback before receipt; unknown payment/receipt time still blocks. Persisted receipt deadlines and extensions are never recalculated after deployment or an environment change.

Refund-window migration files and status:

- Local: `drizzle_local/0118_product_refund_windows.sql` — applied.
- Development: `drizzle_dev/0069_product_refund_windows.sql` — generated, not applied in this session.
- Staging: `drizzle_stg/0017_product_refund_windows.sql` — generated, not applied in this session.

The current backend additionally requires the payment-attempt table from `0119_payment_safety.sql` (local, applied), `0070_payment_safety.sql` (development, generated), or `0018_payment_safety.sql` (staging, generated). Apply the full intended migration sequence before deploying; the refund-window migration alone is not sufficient for the current source. See the [payment safety rollout](../PAYMENT_SAFETY_API_CHANGES.md).

Integration tests generate disposable databases directly from `schema.ts`; no test-environment migration is included because its tracked baseline contains unrelated pending schema changes.

Existing products receive 8 days for new purchases. Existing order items receive the legacy 10-day snapshot, including items awaiting receipt; stored deadlines/extensions stay unchanged. Backend and client updates should be coordinated because older clients may treat all null deadlines as unavailable. Production has no tracked migration baseline or configured database URL in this checkout; establish its migration history before generating/applying a production migration.

Swagger at `/api-docs` covers the admin changes. See [the Flutter handoff](../FLUTTER_PRODUCT_REFUND_WINDOWS.md) for buyer actions and [the existing refund review contract](ADMIN_REFUND_STRATEGY_API_CHANGES.md) for unchanged review fields and permissions.

## Acceptance checks

Create/update products with `0`, `3`, `7`, `8`, `50`, and null. Verify omitted create/update semantics, invalid input errors, mixed-policy deliveries, policy edits after order creation but before payment, unlimited rejection, disabled-action display, exact-deadline expiry, local/development durations and legacy orders. Include Credit/ATM `payment-processing` eligibility, partial completion versus explicit rejection, receipt-time block reasons and the redesigned status emails. Relevant backend checks are `npm run build`, `npm run test:refund-strategy`, `npx tsx src/tests/refundStatusNotification.test.ts`, and `npm run test:payment-safety`.

## Status email and rejection deadline

Actual refund status changes through the admin API send email to the buyer's registered address, in addition to the in-app notification and FCM push. Rejected messages include the rejection reason and the effective reapplication deadline as `yyyy-mm-dd hh:mm` in **Asia/Taipei**, for example `2026-11-04 12:10` (Taipei time). This is the deadline after applying rejection extension rules, not a fixed duration from notification delivery. Unlimited purchases say there is no expiration and reapplication still requires available quantity. Completion emails do not claim a new reapplication deadline.

Delivery is asynchronous and failures are logged; they do not roll back the review decision. Email and app delivery are attempted independently. An unchanged status or matching terminal retry does not resend. Direct repository updates bypass the service's delivery workflow. No API request or response fields were added for this notification change.


Status emails now match the order/refund-created email design: blue header, white card, a details table and a pill-shaped **查看訂單** button. The table includes request reason, original/current quantities, optional note, rejection reason for rejected requests, and cash/returned-coin amounts for completed requests. Partial completion shows the unrefunded quantity without representing it as a separate rejection. The button uses the existing environment-specific order deeplink; this adds no FE payload fields. Minute-formatted email deadlines are for display; use the full returned timestamp and computed eligibility for actions.


Shared error-contract update (2026-11-04): admin APIs now use the same safe failure envelope, request references and optional field errors as app APIs. Use the consolidated [admin FE handoff: error handling and refund windows](ADMIN_ERROR_HANDLING_AND_REFUND_WINDOWS.md) for the complete integration contract.
