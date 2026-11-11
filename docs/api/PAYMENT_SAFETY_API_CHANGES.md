# Checkout validation and ECPay payment confirmation

Date: 2026-11-04

Implemented in source; local, development and staging migrations applied (verified 2026-11-11). Production migration/deployment requires its established migration baseline; this checkout does not contain one. Apply migrations before starting the updated server.

## Problem and resulting flow

Previously, `/api/ecpay/new` only checked that an order was pending. Credit-card coins were allocated after ECPay charged the buyer. Expired lots, concurrent spending or a database failure could prevent saving `paid`, and the callback still acknowledged `1|OK`, suppressing provider retries.

The flow is now:

1. Create the order and reserve stock as before.
2. Before returning an ECPay payment form, validate the buyer, payment key, saved amount/method, order age/state, products, variants, prices, inventory reservations, seller availability, delivery groups and totals.
3. Reserve the exact discount coins from non-expired ledger lots under transaction locks. An aggregate `users.coins` balance is not sufficient evidence of spendable funds. Discounted checkout fails closed if the coin ledger is disabled.
4. Save a unique server-issued payment attempt and mark the order `payment-processing`. Return the form only after that transaction commits. Credit and ATM both use this stage.
5. Verify the provider signature, merchant, attempt/trade number, order/key and exact cash amount on callback. Staging/production reject simulated payments. ATM account issuance is not payment success.
6. Persist the verified result independently, then atomically consume the reserved coins/stock, mark the order paid and finish its payment/idempotency records. Reservation expiry during payment does not invalidate held coins.
7. Return `1|OK` only when settlement is committed or the same result was already applied. Unexpected failures return a non-success response and remain recoverable. Logistics/email run after payment commit, so their failures cannot undo payment.

A browser return page, app-supplied status, account issuance, or the presence of an ECPay form does not establish payment success.

## Flutter integration

### `GET /api/ecpay/new`

Existing query fields remain `token`, `orderId`, `idempotencyKey`, `totalAmount`, `tradeDesc`, `itemName`, and `ChoosePayment` (`Credit` or `ATM`). The token must identify the order's buyer. `totalAmount` must equal the saved positive integer cash amount; it cannot choose what ECPay charges. Method must match the saved order. New order payment keys are bound to the specific order at creation.

The endpoint returns HTML on success. Validation errors now return a non-2xx JSON service error and **no payable form**. The WebView must handle HTTP errors; do not show “paid” based on navigation alone. Re-read `GET /api/order/:id` for the authoritative state.

| Code | Meaning / client response |
| --- | --- |
| `INSUFFICIENT_SPENDABLE_COINS` (409) | Available non-expired ledger lots do not cover the discount. Refresh profile/order; create a new checkout with a supported discount. |
| `PAYMENT_AMOUNT_MISMATCH` / `PAYMENT_METHOD_MISMATCH` (400) | Query differs from the order. Use its saved values. |
| `PAYMENT_KEY_MISMATCH` (403) | Wrong/missing key or an old pending checkout without the new order binding. Create a fresh order. |
| `ORDER_NOT_PAYABLE` (409) | Order is not pending or its 30-minute pre-checkout window elapsed. |
| `PAYMENT_ALREADY_STARTED` (409) | A completed/conflicting attempt exists. Refresh the original order; do not automatically create another charge. |
| `PRODUCT_UNAVAILABLE` / `PRODUCT_PRICE_CHANGED` (409) | Product state or price changed before payment. Refresh products and recreate checkout. |
| `ORDER_STOCK_UNAVAILABLE` / `ORDER_TOTAL_MISMATCH` (409) | Invalid reservation/totals. Refresh or recreate checkout. |
| `INVALID_SHIPPING_INFO` (400) | Missing/mismatched delivery, unsupported method, mixed-seller group, or invalid required CVS fields. Correct checkout information. |
| `COIN_LEDGER_REQUIRED` (503) | Discounted payments are disabled until ledger configuration is enabled. |

Repeated `/new` calls for the same still-prepared order/key reuse the same merchant trade number and coin reservation. They do not create independent payment attempts. The 30-minute pending-order timeout applies before payment preparation; an in-flight payment is not silently cancelled by that cleanup.

`payment-processing` now also covers card authorization and recovery after a verified charge. Display “付款確認中” while this state is returned. Reuse/poll the original order instead of immediately inviting another payment. Cart entries are removed when payment preparation reserves resources, matching the existing ATM processing flow.

### `PUT /api/order/:orderId`

The app can only submit `{ "status": "canceled" }` for its own still-pending order (or repeat its own cancellation). Unknown body fields and attempts to set `paid`, `failed`, `payment-processing`, etc. fail validation. Another buyer's order returns 404. Once payment has begun, cancellation returns 409 `PAYMENT_CONFIRMATION_PENDING`; closing the WebView is not proof that the provider cannot charge.

There are no new order response fields or status enum values. Client-side “付款成功” must follow the server's `paid` status.

## Admin FE and operations

Existing `/api/admin/order/list`, `/api/admin/order/:id` and chat summaries keep their response shapes. `payment-processing` may represent Credit as well as ATM. A successful provider charge followed by a settlement error remains processing, rather than being labelled a failed payment. Signed success evidence is in `order_payment_attempts.provider_data` for investigation. Never release reservations or mark such an order failed merely because a webhook/DB call timed out.

A new minute-based reconciliation job:

- Retries captured `succeeded`/`failed` results that did not finish settlement, including after server restarts or provider retries end.
- Queries prepared attempts after ten minutes using ECPay's signed `QueryTradeInfo` response. Matching paid results are settled even if the original webhook was lost.
- Keeps resources held when provider state is uncertain, unpaid, unreachable or untrusted. “Unpaid” is not evidence that an already-issued payment form/account can no longer receive payment. Such orders require provider confirmation/review before cancellation; automatic expiry is deliberately disabled for unresolved attempts. Abandoned payment attempts can therefore retain stock/coins pending review.

The task runs when the server is running and `NO_CRON` is not `true`; it uses a PostgreSQL advisory lock across instances. Provider-query failures retry without marking the order failed. Legacy processing orders without an attempt retain the previous calendar expiry behavior.

Already-open legacy ECPay checkouts may return callbacks after deployment. Matching signed results are captured; legacy success can settle automatically when its original resources are still valid. A legacy discounted payment with no coin reservation, or a payment whose stock was already released, stays processing for manual reconciliation. The change cannot retroactively reserve resources before those older charges.

Logistics and notification failures are logged separately after settlement. The payment reconciler repairs financial settlement, not post-payment logistics/email failures. Existing payment notifications and delivery integration still require monitoring and operational retry where appropriate.

The unmanaged real-money `/api/ecpay/test?realAccount=true` path is disabled. Sandbox test checkout is unavailable in staging/production.

## Migration and validation

- Local: `drizzle/local/0119_payment_safety.sql` (applied).
- Development: `drizzle/dev/0070_payment_safety.sql` (applied 2026-11-04).
- Staging: `drizzle/stg/0018_payment_safety.sql` (applied 2026-11-11).
- Integration suites construct disposable databases from the current schema; no catch-up migration was generated from the stale test baseline.

The new table stores one attempt per order, unique merchant trade numbers, expected amount/method/key and captured provider result. No existing order data is rewritten by the migration. Enable `COIN_LEDGER_ENABLED=true` for discounted payments and keep provider credentials/host configured before checkout. Production needs a reviewed migration based on its actual history.

Regression commands: `npm run build`, `npm run test:payment-safety`, `npm run test:api`, `npm run test:order-chatroom`, `npm run test:order-expiry`, `npm run test:coin-ledger`, `npm run test:refund-strategy`.

Tests cover expired-lot rejection before checkout, owner/key/amount/price checks, concurrent spending, expiry after reservation, authenticated callbacks, duplicate/late callbacks, ATM issuance/success, simulated payments, missed-webhook query recovery and a database failure after provider success with durable reconciliation.

Provider references: [payment result notifications and acknowledgement/retries](https://developers.ecpay.com.tw/9058/), [AIO payment status query](https://developers.ecpay.com.tw/2890/). External charging and the application database cannot share one atomic transaction; the protection is pre-charge reservations plus recoverable processing for post-charge infrastructure failures.


Shared error-contract update (2026-11-04): app and admin `/api/*` JSON failures add stable fallback codes, request references and optional safe field errors while preserving existing domain codes and payment/SSE protocols. See [the BE error-handling feedback](FLUTTER_ERROR_HANDLING_FEEDBACK.md).
