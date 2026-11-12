# Flutter handoff: product-specific refund windows

Hour-unit update (2026-11-12): the authoritative [variant/hour handoff](FLUTTER_VARIANT_REFUND_WINDOWS.md) now uses `refundWindowHours` and `refundWindowHoursAtSale` (default 192 hours). Prior day-field examples below are historical and superseded. Whole-hour API values may be shown as daily UI presets via days × 24. Both variant and hour-conversion migrations were applied locally and in development on 2026-11-12; staging remains pending.

Variant update (2026-11-11): refund windows now belong to each variant. Use [the variant-policy handoff](FLUTTER_VARIANT_REFUND_WINDOWS.md) for the new API, migration and rollout contract; it supersedes product-level editor/policy-source instructions below. Migration status: applied locally and in development on 2026-11-12; staging remains pending. Existing purchase snapshots, eligibility, review and shared error rules remain in effect.

Date: 2026-11-03
Last reviewed: 2026-11-04

Implemented in source; local, development and staging refund-window and payment-safety migrations are applied (verified 2026-11-11); production needs its established migration baseline and deployment. This update changes the refund policy and adds response fields. Existing buyer request payloads remain compatible.

## APIs without the admin prefix

Use the existing app bearer token.

| API                     | Change                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/product/list` | Products include `refundWindowDays`.                                                                                                          |
| `GET /api/product/:id`  | Product detail includes `refundWindowDays`.                                                                                                   |
| `GET /api/order/:id`    | `data.items[]` includes the purchased `refundWindowDaysAtSale` and computed eligibility described below.                                      |
| `POST /api/refund`      | Existing creation body; disabled policies return HTTP 409 with code `REFUNDS_DISABLED`. Finite/unlimited policies use the purchased snapshot. |

Do not send the refund policy when creating an order or refund. The server saves it from the locked product row when `POST /api/order` creates the order, before ECPay checkout or payment confirmation. Display the current policy on the product page and the purchased snapshot on order/refund screens. Product changes never alter an existing purchase. Products share one policy across all variants.

## Payment state and the start of refund eligibility

Both Credit and ATM now enter `payment-processing` after pre-charge validation/reservation. Neither this state nor returning from ECPay means the order is paid. Refund requests still require `orderStatus: "paid"`; other order states return `canRefund:false` and `refundBlockReason:"ORDER_NOT_PAID"`. A displayed window status such as `open` does not override that block reason.

In local/development only, the fallback starts at the first saved `orders.completedAt`, set when verified payment settlement is committed. Opening the payment form, creating a payment attempt, ATM account issuance, the browser return and the provider's `PaymentDate` are not substitutes for this field. Until settlement is saved, do not start a client-side refund countdown from any of those events. The purchased `refundWindowDaysAtSale` was already saved at order creation and does not change when payment completes or the seller edits the product.

Flutter must also handle non-2xx validation responses from `/api/ecpay/new`; the app can no longer set an order to `paid` or `failed` through `PUT /api/order/:orderId`. See [payment safety and checkout integration](PAYMENT_SAFETY_API_CHANGES.md) for the cancellation restrictions, error codes and recovery behavior. Use a fresh order when testing the new checkout flow with an older still-pending order whose key predates the new binding.

## Model and display changes

Add nullable integer `refundWindowDays` to product models and nullable integer `refundWindowDaysAtSale` to order-item models. Missing fields from an older server should be treated as an unknown policy, not automatically unlimited. Once this server version is deployed, explicit null means unlimited.

| Purchased value  | Display                                     |
| ---------------- | ------------------------------------------- |
| `0`              | No refund requests                          |
| Positive integer | Refund requests within N days after receipt |
| `null`           | No expiration after receipt                 |

New products default to **8 days**. Products that existed when the refund-window migration ran also receive 8 days for future purchases. Order items that existed before that migration receive the legacy 10-day snapshot; later purchases retain their own saved policy. All previously stored deadlines/extensions are preserved. Do not substitute the product's current policy for an order-item snapshot.

Continue parsing existing eligibility fields:

- `canRefund`, `remainingRefundQuantity`, `unreservedRefundQuantity`
- Nullable `refundWindowStartsAt`, `originalRefundDeadlineAt`, `refundDeadlineAt`
- `refundWindowStatus`: `disabled` (new), `not_started`, `open`, `expired`, `unknown`
- Nullable `refundBlockReason`: adds `REFUNDS_DISABLED`; existing values are `ORDER_NOT_PAID`, `NOT_RECEIVED`, `RECEIPT_TIME_UNKNOWN`, `PAYMENT_TIME_UNKNOWN`, `REFUND_WINDOW_EXPIRED`, `NO_REFUNDABLE_QUANTITY`
- `refundWindowSource`: `receipt`, `payment_for_testing`, or null
- `refundReceiptChecksBypassed`, `refundServerTime`

Show “Apply for refund” or “Add request” only when `canRefund` is true, and cap quantity by `remainingRefundQuantity`. Existing refund history remains visible regardless of new-request eligibility. Re-read order detail after requests and seller decisions. Order detail's top-level `data.items[]` contains computed eligibility; raw nested delivery items, live product data, and refund-list data are not replacements.

An unlimited eligible item can have:

```json
{
  "refundWindowDaysAtSale": null,
  "refundWindowStartsAt": "2026-11-03T02:00:00.000Z",
  "originalRefundDeadlineAt": null,
  "refundDeadlineAt": null,
  "refundWindowStatus": "open",
  "refundWindowSource": "receipt",
  "refundReceiptChecksBypassed": false,
  "refundBlockReason": null,
  "canRefund": true,
  "remainingRefundQuantity": 2,
  "unreservedRefundQuantity": 2,
  "refundServerTime": "2026-11-03T03:00:00.000Z"
}
```

Null deadlines also occur for disabled items and unknown receipt timing. Never infer `canRefund` from a null deadline. For unlimited purchases, show “No expiration” rather than an empty countdown; before receipt still respect `canRefund` and the block reason. A `0` policy returns status `disabled`, `canRefund:false`, `remainingRefundQuantity:0`; paid orders receive block reason `REFUNDS_DISABLED`.

## Create request and error handling

The body remains:

```http
POST /api/refund
Content-Type: application/json
Authorization: Bearer APP_TOKEN
```

```json
{
  "orderItemId": "ORDER_ITEM_UUID",
  "quantity": 1,
  "reason": "Please refund",
  "clientRequestId": "CLIENT_GENERATED_UUID"
}
```

`reason`, `note` and `clientRequestId` retain their existing optional semantics. Keep one client request UUID when retrying the same payload. Do not send amount, status, policy, deadline, actor or audit fields. The existing success envelope and refund record shape remain unchanged.

New error example:

```json
{
  "success": false,
  "statusCode": 409,
  "message": "REFUNDS_DISABLED",
  "code": "REFUNDS_DISABLED"
}
```

Show a clear “This purchase does not allow refund requests” message and refresh order detail. Existing `REFUND_WINDOW_EXPIRED`, `NOT_RECEIVED`, unknown-time and quantity handling remain applicable. A successful new request is subject to remaining quantity; unlimited means no time expiry, not unlimited units. Flutter still cannot review/edit/cancel/complete refunds directly.

## Time, review and testing

In staging/production/test, finite policies start at trusted confirmed pickup/receipt and last exactly `N × 24` hours. Arrival at a pickup store does not start the clock. At the exact deadline, new requests are rejected. Different products in the same delivery may have different deadlines.

Local/development use one tenth of finite durations: 8 days = **19 hours 12 minutes**, 7 days = **16 hours 48 minutes**, 3 days = **7 hours 12 minutes**. The existing payment-confirmation fallback can allow requests before receipt in these two environments. `0` remains disabled and null remains unlimited. Persisted deadlines are preserved. Display returned timestamps in local time and rely on server eligibility rather than calculating your own deadline from days.

Finite rejection retains the existing `max(currentDeadline, rejectionTime + 5 days)` rule (12 hours in local/development). Unlimited rejection keeps deadlines null while recording actor, reason and decision time; requests may be made again if quantity remains. Accepted requests remain reviewable after finite expiry. A cancelled or partially completed request does not extend a finite deadline.

For an agreed partial completion, the existing refund record becomes `completed` with the final `quantity`; `originalRequest.quantity` preserves the original request. For example, an original request for 2 units completed for 1 should display as a partial refund, not as a newly introduced `partially_rejected` status. The other unit is released for a possible new request, without a separate rejection record or deadline extension. An explicit `rejected` request is different and can extend the effective item deadline.

Receipt update (2026-11-12): CVS uses trusted provider pickup; virtual products and seller-managed home delivery now require seller/admin setting status to delivered through the existing API. Setting virtual/home delivered now establishes receipt and is irreversible for these two methods only; chat, shipment and payment alone do not. CVS processing remains unchanged. The first confirmation starts the purchased window and remains stable on retries. A null/unlimited policy still requires that start and available quantity. See [the variant-policy handoff](FLUTTER_VARIANT_REFUND_WINDOWS.md).

Help center `GET /api/system/customer-support` and consent `GET /api/file/user-consent` keep their existing JSON IDs, content routing and `complete-reading` callback. Their content describes product-specific policies, the 8-day default, snapshots at order creation (including before payment), disabled/unlimited prerequisites, receipt/payment confirmation and status emails. Local/development content consistently uses accelerated finite windows and a 12-hour rejection extension; other environments use normal elapsed durations and a 120-hour extension. Existing FAQ IDs and response structure remain; additional FAQs cover policy changes, payment/receipt eligibility and status notifications.

QA: cover disabled, finite, unlimited, before receipt, unknown receipt, exhausted quantity, exact deadline, rejection/retry, policy edits after purchase, mixed deliveries, legacy purchases and both accelerated environments. Additional QA should cover `payment-processing` blocking refunds in Credit/ATM, delayed payment settlement, partial completion using `originalRequest.quantity`, and unsupported/manual receipt flows. Relevant backend checks are `npm run build`, `npm run test:refund-strategy`, `npx tsx src/tests/refundStatusNotification.test.ts`, and `npm run test:payment-safety`.

See [the existing buyer refund contract](FLUTTER_REFUND_STRATEGY_API_CHANGES.md) for the remaining unchanged behavior. Admin APIs and editor changes are in [the admin FE handoff](FE-confirmation/ADMIN_PRODUCT_REFUND_WINDOWS.md).

## Status email and rejection deadline

Actual refund status changes through the admin API send email to the buyer's registered address, in addition to the in-app notification and FCM push. Rejected messages include the rejection reason and the effective reapplication deadline as `yyyy-mm-dd hh:mm` in **Asia/Taipei**, for example `2026-11-04 12:10` (Taipei time). This is the deadline after applying rejection extension rules, not a fixed duration from notification delivery. Unlimited purchases say there is no expiration and reapplication still requires available quantity. Completion emails do not claim a new reapplication deadline.

Delivery is asynchronous and failures are logged; they do not roll back the review decision. Email and app delivery are attempted independently. An unchanged status or matching terminal retry does not resend. Direct repository updates bypass the service's delivery workflow. No API request or response fields were added for this notification change.

Status emails use the existing blue-header/white-card design and a table showing the product, order number, request reason, original/current quantities and applicable rejection reason or completed refund amounts. Partial-completion emails show the unrefunded quantity and explain that it was released rather than explicitly rejected. A pill-shaped **查看訂單** button uses the same environment-specific order deeplink as other order emails (`scheme:///order/:orderId` wrapped in the existing deeplink host). Flutter should reuse its existing order-link handling; no new route is needed. The email's minute-formatted deadline is display text; the full `refundDeadlineAt` and `canRefund` remain authoritative for actions in the app.


Shared error-contract update (2026-11-04): app and admin `/api/*` JSON failures add stable fallback codes, request references and optional safe field errors while preserving existing domain codes and payment/SSE protocols. See [the BE error-handling feedback](FLUTTER_ERROR_HANDLING_FEEDBACK.md).
