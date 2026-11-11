# Admin FE handoff: error handling and product-specific refund windows

Date: 2026-11-04
Status: implemented in backend source. This is the consolidated FE handoff and supersedes the earlier app-only error scope. It includes the product refund-window contract from the previous handoff.

Admin APIs under `/api/admin` now use the same error policy as app APIs. Successful JSON payloads remain unchanged. Error handling itself needs no migration; the refund-window and payment-safety migrations below are still prerequisites for deploying the current backend. No FE implementation is included in this backend change.

## Shared failure contract

All API responses receive a server-generated UUID in `X-Request-ID`. JSON failures include the same UUID as `requestId`; supplied request IDs are ignored. CORS exposes `X-Request-ID` and `Retry-After` for the existing allowed origins. The request reference is for support and changes on every retry; it is not an authentication credential or idempotency key.

Example HTTP 409:

```json
{
  "success": false,
  "statusCode": 409,
  "code": "REFUND_AGREEMENT_REQUIRED",
  "message": "Buyer agreement is required before changing the refund",
  "requestId": "67f4318c-a57e-4e18-bb4e-b5fcc7c048ef"
}
```

`success`, `statusCode` and `message` remain. `code` and `requestId` are added, along with optional `fieldErrors`. Actual HTTP status and serialized `statusCode` agree. A direct JSON failure without a valid error status now becomes HTTP 500 instead of silently remaining HTTP 200. Existing explicit business codes take priority over generic status handling.

Staging, production and unknown/unset environments replace arbitrary exception/business text with approved safe messages; unknown exceptions use generic messages in every environment. Explicit local/development/test environments retain expected legacy validation/business messages for diagnostics. FE should localize by recognized code and field in every build, without displaying arbitrary server text or matching English reason strings.

### Validation fields

Example: invalid `refundWindowDays` on the product form, HTTP 400:

```json
{
  "success": false,
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": [
    {"field":"refundWindowDays","message":"The value is below the allowed minimum"}
  ],
  "fieldErrors": [
    {"field":"refundWindowDays","code":"VALUE_TOO_SMALL","message":"The value is below the allowed minimum"}
  ],
  "requestId": "67f4318c-a57e-4e18-bb4e-b5fcc7c048ef"
}
```

`message` is not always a string: legacy validation arrays and JSON-string `{error:[...]}` lists remain parseable. Public legacy item lists retain only approved identifiers/numbers and safe reasons; arbitrary submitted values and extra fields are removed. Use additive `fieldErrors` when present. It is optional, including for malformed JSON and ordinary business validation errors; handle its absence as a form-level failure.

Field paths follow the existing request schemas: `refundWindowDays`, `agreement.note`, or dot-indexed array paths such as `variants.0.price`. An empty path means form/item-level feedback. Free-form notification `data` errors collapse to `data` rather than exposing submitted record keys.

| Field code | Suggested FE behavior |
| --- | --- |
| `INVALID_TYPE` | Explain the expected type. |
| `VALUE_TOO_SMALL` / `VALUE_TOO_LARGE` | Show the field's known minimum/maximum. |
| `INVALID_FORMAT` / `INVALID_VALUE` | Show localized field feedback. |
| `UNRECOGNIZED_FIELDS` | Remove unsupported payload fields; keep the user's form state. |
| `INVALID_MULTIPLE` | Explain the permitted increment. |

Legacy item errors may additionally expose `PRODUCT_UNAVAILABLE`, `VARIANT_UNAVAILABLE`, `INSUFFICIENT_STOCK` or `INVALID_REFUND_QUANTITY`. Only display approved/localized messages; never assume an unknown code is safe to render verbatim.

### Fallback codes and recovery

| HTTP | Fallback code | FE recovery |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Preserve inputs and show field/form errors. |
| 401 | `UNAUTHENTICATED` | Follow the existing account/session recovery flow; avoid refresh loops. |
| 403 | `FORBIDDEN` | Explain access/action restrictions; do not log out on every 403. |
| 404 | `RESOURCE_NOT_FOUND` | Show unavailable/removed state and offer back/list navigation. |
| 409 | `CONFLICT` | Fetch authoritative detail and reconcile before retrying a write. |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce data/attachments. |
| 429 | `RATE_LIMITED` | Honor `Retry-After` if supplied. |
| 500 | `INTERNAL_ERROR` | Generic feedback and optional support request reference. |
| 502/503/504 | `SERVICE_UNAVAILABLE` | Bounded read retries; reconcile uncertain writes. |

Fallback codes fill missing codes. Preserve existing domain identifiers, including account codes `ADMIN_ACCESS_TOKEN_REQUIRED`, `ACCOUNT_CREDENTIALS_CHANGED`, `ACCOUNT_SESSION_INVALID`, `REFRESH_TOKEN_INVALID`, `ACCOUNT_PROFILE_INCOMPLETE`, `ACCOUNT_EMAIL_UNVERIFIED`, `EMAIL_VERIFICATION_TOKEN_INVALID`, `EMAIL_CHANGE_PASSWORD_INVALID` and `ACCOUNT_EMAIL_UNAVAILABLE`. Incomplete profile/email verification errors should lead to the existing onboarding/verification flow, not a generic sign-out. A failed refresh must not recursively trigger another refresh.

Known cooldowns remain endpoint-specific, such as 15 seconds for applicable stream limits, 60 seconds for logistics verification and 3600 seconds for applicable account cooldowns. `Retry-After` is optional and can be seconds or an HTTP-date; no universal cooldown is invented. SSE keeps its existing cursor/reset/reconnect protocol. Before streaming starts failures are JSON; after headers, handle `stream.reset`/close using the existing controller recovery, rather than parsing an HTTP failure envelope.

Normalize failures in the API client and let each screen decide presentation. Keep form inputs and existing list/detail data on refresh failures. Do not automatically retry mutations after timeouts: re-read the original resource first. During mixed-version deployment accept missing `code`/`requestId`, legacy HTTP 200 `success:false`, validation arrays and non-JSON proxy failures. Unknown codes use a safe status fallback. HTTP 200 `success:true` with negative eligibility remains a successful evaluation.

`GET /api/admin/delivery/helper/printTradeDocument` still returns HTML on success. Invalid/missing print parameters now return the shared JSON failure with HTTP 400; invalid/expired query tokens return HTTP 401. Provider callback plain-text acknowledgement protocols are preserved.

Swagger `/api-docs` includes `ApiFailure`, `ApiFieldError`, the compatible `ErrorResponse` reference, request/cooldown headers and a shared default failure response for admin operations. Existing specific error descriptions remain; success schemas stay intact.

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

Verification on 2026-11-04: local and development have no pending migrations, and all 1,206 compared public-schema definitions match (66 tables, columns/defaults/nullability, constraints, indexes, enums, views, triggers and sequence definitions). PostgreSQL 17 local versus PostgreSQL 18 development NOT NULL catalog representation is normalized using column nullability. Both environment migration snapshots also match `schema.ts`; their historical migration counts differ. This checks schema synchronization; application data was not copied.

Verification on 2026-11-11 extends schema parity to staging: local, development and staging now match across all compared public-schema definitions with no pending migrations. See [the release and schema audit](../../operations/DEVELOPMENT_STAGE_SYNC_2026-11-11.md), including the pre-existing local historical migration-hash discrepancy.

Refund-window migration files and status:

- Local: `drizzle/local/0118_product_refund_windows.sql` — applied.
- Development: `drizzle/dev/0069_product_refund_windows.sql` — applied 2026-11-04.
- Staging: `drizzle/stg/0017_product_refund_windows.sql` — applied 2026-11-11.

The current backend additionally requires the payment-attempt table from `0119_payment_safety.sql` (local, applied), `0070_payment_safety.sql` (development, applied 2026-11-04), or `0018_payment_safety.sql` (staging, applied 2026-11-11). Apply the full intended migration sequence before deploying; the refund-window migration alone is not sufficient for the current source. See the [payment safety rollout](../PAYMENT_SAFETY_API_CHANGES.md).

Integration tests generate disposable databases directly from `schema.ts`; no test-environment migration is included because its tracked baseline contains unrelated pending schema changes.

Existing products receive 8 days for new purchases. Existing order items receive the legacy 10-day snapshot, including items awaiting receipt; stored deadlines/extensions stay unchanged. Backend and client updates should be coordinated because older clients may treat all null deadlines as unavailable. Production has no tracked migration baseline or configured database URL in this checkout; establish its migration history before generating/applying a production migration.

Swagger at `/api-docs` covers the admin changes. The review request/response details and error recovery are included below; [the Flutter handoff](../FLUTTER_PRODUCT_REFUND_WINDOWS.md) covers buyer integration.

## Acceptance checks

Create/update products with `0`, `3`, `7`, `8`, `50`, and null. Verify omitted create/update semantics, invalid input errors, mixed-policy deliveries, policy edits after order creation but before payment, unlimited rejection, disabled-action display, exact-deadline expiry, local/development durations and legacy orders. Include Credit/ATM `payment-processing` eligibility, partial completion versus explicit rejection, receipt-time block reasons and the redesigned status emails. Relevant backend checks are `npm run build`, `npm run test:refund-strategy`, `npx tsx src/tests/refundStatusNotification.test.ts`, and `npm run test:payment-safety`.

## Status email and rejection deadline

Actual refund status changes through the admin API send email to the buyer's registered address, in addition to the in-app notification and FCM push. Rejected messages include the rejection reason and the effective reapplication deadline as `yyyy-mm-dd hh:mm` in **Asia/Taipei**, for example `2026-11-04 12:10` (Taipei time). This is the deadline after applying rejection extension rules, not a fixed duration from notification delivery. Unlimited purchases say there is no expiration and reapplication still requires available quantity. Completion emails do not claim a new reapplication deadline.

Delivery is asynchronous and failures are logged; they do not roll back the review decision. Email and app delivery are attempted independently. An unchanged status or matching terminal retry does not resend. Direct repository updates bypass the service's delivery workflow. No API request or response fields were added for this notification change.


Status emails now match the order/refund-created email design: blue header, white card, a details table and a pill-shaped **查看訂單** button. The table includes request reason, original/current quantities, optional note, rejection reason for rejected requests, and cash/returned-coin amounts for completed requests. Partial completion shows the unrefunded quantity without representing it as a separate rejection. The button uses the existing environment-specific order deeplink; this adds no FE payload fields. Minute-formatted email deadlines are for display; use the full returned timestamp and computed eligibility for actions.

## Refund review requests and error recovery

| API | FE behavior |
| --- | --- |
| `POST /api/admin/refund` | Removed; returns 404. Only the app buyer creates a request. |
| `GET /api/admin/refund/list` | Existing `page`, `limit`, `userId`, `productId`, `merchantTradeNo`, `startAt`, `endAt`, `status` filters. Dates filter request creation time. List data remains `{refunds,total,page,limit,totalPages}`. |
| `GET /api/admin/refund/:refundItemId` | Read current request, original request, decision fields, nested order item and logs. |
| `PATCH /api/admin/refund/:refundItemId/status` | Review or adjust an existing request. Strict body; unknown keys return 400. |

Statuses are `pending`, `processing`, `completed`, `cancelled`, `rejected`. Active admins manage all sellers; sellers manage their own products; employees retain scoped reads and cannot write. Foreign-seller detail/update returns 404. App tokens cannot manage admin refunds. Existing account onboarding requirements still apply.

Start review:

```json
{"status":"processing","message":"Review started"}
```

Complete one agreed unit from a larger request:

```json
{
  "status":"completed",
  "quantity":1,
  "refundAmount":100,
  "extraRefundAmount":20,
  "agreement":{"confirmed":true,"note":"Buyer agreed in the order chat to one unit and NT$20 extra compensation."},
  "message":"Agreed refund completed"
}
```

`quantity` is a positive integer. `refundAmount` is a positive **per-unit** base amount, rounded to two decimals and capped at `unitPriceAtSale`. Changes to quantity or base amount require `agreement.confirmed:true` and a nonblank agreement note (max 2000 characters), submitted with the adjustment. This is the reviewer attesting to buyer agreement; BE does not infer consent from chat. `extraRefundAmount` is nonnegative total compensation, rounded to two decimals; changing that alone does not require the agreement object. Pending/processing/completed quantities together cannot exceed purchased quantity. An increase additionally needs an open effective window.

Reject a whole request:

```json
{"status":"rejected","rejectionReason":"The parties could not agree on the requested refund."}
```

The rejection reason is nonblank, max 2000 characters. Do not combine rejection with `quantity`, `refundAmount`, `extraRefundAmount` or `agreement`. Optional `message` is the audit log message; it does not replace `rejectionReason`. Ordinary cancellation uses `{"status":"cancelled","message":"Cancelled by agreement"}` and gives no deadline extension.

Optional editable review fields also include `reason`, nullable `note`, log `message` and nullable `metadata`. Server-owned decision/actor/timestamp/audit fields cannot be edited. There is no partial-rejection status; agreed partial completion uses the final agreed quantity as described above.

Refund detail includes immutable `originalRequest` (`quantity`, `refundAmount`, `paidRefundAmount`, `coins`, `reason`, `note`; null for historical rows), nullable buyer `clientRequestId`, `rejectedAt`, `rejectedBy`, `rejectionReason`, `rejectionDeadlineBefore` and `rejectionDeadlineAfter`. Render original and final quantities together. Decision deadlines describe that rejection, while the item's effective deadline can advance later. Logs contain nullable `actorAccountId` and `audit` with before/after values and agreement when recorded; legacy rows may omit these. Client metadata is not decision evidence.

Terminal states `completed`, `cancelled`, `rejected` are immutable. Matching terminal retries return 200 without repeating money/coin/inventory/deadline/email effects. Changed decisions return 409. Preserve an identical original decision payload for an uncertain retry; refreshing detail is preferable to blindly resubmitting a modified form. If replaying `message`/`agreement`, they must match the original decision's latest log. Do not reuse request IDs as mutation keys.

| Domain code / status | FE recovery |
| --- | --- |
| `REFUND_TERMINAL` / 409 | Reload refund detail and show the saved terminal decision. |
| `REFUND_AGREEMENT_REQUIRED` / 409 | Obtain/record buyer agreement before changing quantity/base amount. |
| `REFUND_WINDOW_EXPIRED` / 409 | Stop quantity increases; accepted quantities remain reviewable. |
| `RECEIPT_TIME_UNKNOWN` / 409 | Reconcile historical receipt before extending a rejection deadline. |
| `PAYMENT_TIME_UNKNOWN` / 409 | Local/development lacks both receipt and saved payment confirmation; escalate for reconciliation. |
| `VALIDATION_FAILED` / 400 | Show safe field/form feedback; check rejection/financial combinations and quantity/amount bounds. |
| `UNAUTHENTICATED` / 401, `FORBIDDEN` / 403, `RESOURCE_NOT_FOUND` / 404 | Apply session, role or ownership recovery; do not retry as another actor. |

Computed eligibility block reasons remain `REFUNDS_DISABLED`, `ORDER_NOT_PAID`, `NOT_RECEIVED`, `RECEIPT_TIME_UNKNOWN`, `PAYMENT_TIME_UNKNOWN`, `REFUND_WINDOW_EXPIRED`, `NO_REFUNDABLE_QUANTITY`. They are successful detail-response data when returned on items, not transport failures. Refresh `GET /api/admin/order/:id` or `GET /api/admin/delivery/:deliveryId` for computed eligibility. A buyer retry-key conflict (`REFUND_REQUEST_CONFLICT`) is separate from the review decision protocol.

## Combined FE acceptance checklist

- Product form: create default 8; omitted update preserves; explicit `0`/`null`; integer bounds and field errors.
- Snapshot display: edit a product after order creation, including before payment, and confirm existing order policy stays unchanged.
- Eligibility: finite/disabled/unlimited, mixed-policy deliveries, exact expiry, payment-processing, missing receipt and local/development acceleration.
- Reviews: agreement validation, rejection with finite/unlimited policy, partial completion, terminal retries and stale/conflicting detail recovery.
- Errors: masked staging/production messages, stable domain codes, field arrays, malformed JSON, unknown codes, request references, exposed CORS headers and optional cooldowns.
- Protocols: unchanged successful payloads/print HTML, JSON print failures, existing SSE reset/reconnect and no duplicate decision side effects.
- Rollout: apply required refund/payment migrations before deploying the backend; keep mixed-version error fallbacks until all deployments are updated.

Backend verification: `npm run build`, `npm run test:error-handling` (app/admin parity and Swagger), and `npm test` (error contract plus 19 disposable-database integration suites). Error handling adds no database migration.
