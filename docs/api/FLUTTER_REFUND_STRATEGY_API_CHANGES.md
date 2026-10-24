# Flutter — buyer refund requests and deadlines

Date: 2026-10-23

Status: **Implemented; local and development migrations applied. Development deployment and staging migration/deployment remain required.** App endpoints remain outside admin Swagger.

## Allowed operations

| Endpoint | Use |
| --- | --- |
| `POST /api/refund` | Create a request for one order-item row owned by the authenticated app buyer. |
| `GET /api/order/:id` | Read the buyer's order, per-item eligibility, refund requests and logs. |

Use the existing app bearer token. There is no app refund status/quantity/amount edit, cancellation, completion or delete endpoint. Discuss adjustments/cancellation with the seller in chat; an authorized seller/admin records the decision. Admin/seller accounts cannot create requests through either the app route or the retired admin creation route.

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

## Environment-specific help and consent content

Existing URLs remain `GET /api/system/customer-support` (app bearer token) and `GET /api/file/user-consent` (HTML). The server selects content using `NODE_ENV`; Flutter does not supply an environment selector. JSON structure, existing FAQ IDs, support labels, and the consent page's `complete-reading` callback remain compatible.

| Runtime | Help-center JSON | Consent HTML |
| --- | --- | --- |
| `local`, `development` | `src/assets/json/local-development/customer-support-content.json` | `src/assets/html/local-development/user-consent.html` |
| Other environments, including staging/production/test or unset | `src/assets/json/customer-support-content.json` | `src/assets/html/user-consent.html` |

The testing versions retain the standard 240-hour/120-hour rules and examples, and clearly explain the 1/10 testing durations (24/12 hours), payment-time fallback and preservation of previously saved deadlines. The JSON adds a testing FAQ first in the refund section. Standard versions contain no testing exception. Maintain both versions when changing shared policy wording.

Deploy the additional asset files with the server code. Rebuild/restart once for the new selector; subsequent content-only edits are read from the selected files on requests, subject to client/HTTP caching. This content separation requires no database migration.

## Creation body — breaking input restriction

```http
POST /api/refund
Authorization: Bearer APP_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "orderItemId": "ORDER_ITEM_UUID",
  "quantity": 2,
  "reason": "Item received with damage",
  "note": "Discussed with the seller in the order chat.",
  "clientRequestId": "GENERATE_A_UUID_FOR_THIS_REQUEST"
}
```

| Field | Contract |
| --- | --- |
| `orderItemId` | Required UUID for the purchased **order-item row**, not product ID. |
| `quantity` | Required positive integer within available quantity. |
| `reason` | Optional nonblank string, max 2,000 characters. Omit if absent. |
| `note` | Optional string (max 5,000 characters) or null. No new attachment/evidence upload API. |
| `clientRequestId` | Optional UUID; strongly recommended for network retries. |
| `accountId` | Optional legacy seller-recipient hint; if supplied must match the product's seller. Prefer omitting it. It never identifies the acting user. |

**Remove `refundAmount`, `extraRefundAmount`, `metadata`, `status`, and other fields from the app body.** Unknown fields return 400, including `extraRefundAmount:0`. The server derives the initial unit amount from `unitPriceAtSale`, calculates coin/cash amounts using the purchase, sets `extraRefundAmount` to zero and creates status `pending`. Extra compensation belongs to seller/admin review.

Success remains HTTP 200 with `{success:true,data:<refund item>}`. Existing amount/quantity fields remain on the response, with the additions below.

For retries, keep the same `clientRequestId` and original quantity/reason/note. Within the same order item, a matching key returns the existing request's **current state**, even if the window later expires or the request was already reviewed; it does not create another chat message/notification. Different payload with that key returns 409 `REFUND_REQUEST_CONFLICT`. Use a **new** key for a deliberate new attempt after rejection/cancellation. Keys are retained with the refund row. Without a key, a retry may create another request if quantity remains; quantity checks are not deduplication.

## Eligibility and UI flow

Read `GET /api/order/:id`, then use **`data.items[]`** for the refund button and quantity picker. Items nested under `data.deliveries[]` are not the computed eligibility contract.

```json
{
  "refundReceiptChecksBypassed": false,
  "refundWindowSource": "receipt",
  "refundWindowStartsAt": "2026-10-22T02:00:00.000Z",
  "originalRefundDeadlineAt": "2026-11-01T02:00:00.000Z",
  "refundDeadlineAt": "2026-11-01T02:00:00.000Z",
  "refundWindowStatus": "open",
  "refundBlockReason": null,
  "canRefund": true,
  "remainingRefundQuantity": 2,
  "unreservedRefundQuantity": 2,
  "refundServerTime": "2026-10-23T02:00:00.000Z"
}
```

- Show the create button when `canRefund:true`; limit the picker to `remainingRefundQuantity`.
- Display `refundDeadlineAt` as the deadline for **new requests**. It is exactly elapsed hours, not midnight on a calendar date.
- `refundWindowStatus` is `not_started`, `open`, `expired`, or `unknown`. The three timestamps are nullable when no applicable window is known. In local/development, the payment fallback described above can supply the window.
- `refundBlockReason` is null or `ORDER_NOT_PAID`, `NOT_RECEIVED`, `RECEIPT_TIME_UNKNOWN`, `PAYMENT_TIME_UNKNOWN`, `REFUND_WINDOW_EXPIRED`, `NO_REFUNDABLE_QUANTITY`.
- `unreservedRefundQuantity` ignores time restrictions. Do not use it to enable a button when `canRefund:false`.
- A display can become stale. The backend rechecks ownership, payment, the database clock and available quantity under transaction locks when accepting a request. Refresh the order after success or a business failure.
- Use UTC ISO timestamps and display in the user's timezone. Use `refundServerTime` to help display remaining time; device time does not determine acceptance.
- Keep existing pending/processing requests visible and reviewable after the deadline; do not mark them expired or hide them just because `canRefund:false`.

## Normal-environment decisions, retrying requests and examples

The first trusted buyer pickup/receipt observation grants **240 hours**. Store arrival does not start that clock. All units in one order-item row share the deadline; other items/deliveries can have different deadlines. Review time does not pause or extend it.

| Situation | Outcome |
| --- | --- |
| Submit on day 5; still reviewing on day 11 | The accepted request remains valid. A new request is blocked after day 10 unless rejection has extended the item deadline. |
| Explicit rejection on day 3 | Deadline stays day 10 because it already leaves more than five days. |
| Explicit rejection on day 8 | Deadline becomes day 13. |
| Timely request rejected on day 12 | Deadline becomes day 17. |
| Request two, agree in chat to refund one, complete on day 8 | Completed request covers one. Remaining unit can be requested before day 10; no automatic extension. |
| Same partial completion on day 12 | Accepted refund can finish, but remaining unit cannot start a new request unless an earlier explicit rejection extended its deadline. |
| Cancellation | Releases quantity without extending the deadline. |

Rejection sets `max(currentDeadline, rejectedAt + 120 hours)` on the affected item. Every distinct rejected request can extend it again; no request-count cap. Replaying the same decision does not extend time. New requests must always satisfy current eligibility. No separate appeal endpoint is needed: use the normal create flow with a new UUID.

Quantities in `pending`/`processing` reserve units, `completed` consumes units, and `rejected`/`cancelled` consumes zero. Reducing an active request by agreement immediately releases the difference. This does not permit claiming/refunding the same units twice.

## Refund display fields

`items[].refundItems[]` retains existing fields/logs and adds:

- `originalRequest`: immutable initial `{quantity,refundAmount,paidRefundAmount,coins,reason,note}`, or null on historical rows. Current top-level quantity/amounts describe the agreed final values.
- `clientRequestId`: the optional retry key or null.
- `rejectedAt`, `rejectedBy`, `rejectionReason`: explicit decision details or null. Show the rejection reason to the buyer.
- `rejectionDeadlineBefore`, `rejectionDeadlineAfter`: deadline recorded for that decision. Use the **item's current `refundDeadlineAt`** for the next request because later decisions may extend it further.

Handle all statuses: `pending`, `processing`, `completed`, `cancelled`, **`rejected`**. Terminal requests are not editable/reopened. Logs add nullable actor/audit fields for history; they are read-only and are not creation input. Do not expose an editable monetary field merely because it appears on the response.

Existing status notifications continue to link to order detail. Refresh that order after opening a notification, returning from chat/review, or submitting a request. This release does not introduce a dedicated refund SSE feed. Notification failure does not undo a recorded decision or change its deadline.

## Errors

| HTTP / code | Meaning / action |
| --- | --- |
| 400 | Invalid/unknown fields, mismatched legacy accountId, quantity unavailable or out of bounds. Refresh quantity after a conflict with another request. |
| 401 / 403 | Missing/invalid app identity or account principal used on app creation. |
| 404 | Unknown item or another buyer's item/order. |
| 409 `ORDER_NOT_PAID` | Order is not paid. |
| 409 `NOT_RECEIVED` | No trusted pickup window yet. |
| 409 `RECEIPT_TIME_UNKNOWN` | Historical or unsupported receipt evidence; show contact-support guidance. |
| 409 `PAYMENT_TIME_UNKNOWN` | Local/development has neither a receipt window nor recorded payment confirmation; contact backend support to reconcile the timestamp. |
| 409 `REFUND_WINDOW_EXPIRED` | New-request deadline reached. Existing accepted requests stay valid. |
| 409 `REFUND_REQUEST_CONFLICT` | Reused UUID with different content; restore the original payload or use a new UUID for a deliberate new request. |

Business errors retain the JSON error envelope and add `code` for the listed 409 cases. Input errors use the existing validation-error envelope. A network timeout is not a rejection: retry with the same request key before allowing a duplicate submission.

## Deployment and receipt limits

Local migration `0117_watery_oracle` and development migration `0068_bitter_mandarin` are applied and verified. Staging is not migrated by this change. Flutter must deploy the stricter body and new status handling with the backend rollout. The local/development testing exception above is enabled by `NODE_ENV`; the paid-order requirement remains enforced.

Receipt time is the first trusted backend observation from a logistics callback/poll, marked as estimated rather than the carrier's exact event time. Repeated/out-of-order updates never reset it. Known CVS pickup codes are supported. Seller-edited delivery status alone, virtual items and unsupported/manual receipt flows do not establish a window. Historical timestamps are not fabricated from deployment time; outside the local/development exception, unknown cases require backend reconciliation. Automatic logistics polling remains disabled locally/in development, as before.

Coin restoration, original coin expiration and cash-remainder calculations remain unchanged. The refund deadline extension does not extend coin validity or add a new automatic cash payout API. See the [admin handoff](FE-confirmation/ADMIN_REFUND_STRATEGY_API_CHANGES.md) for review actions and operations.

Development verification on 2026-10-23 found 64 legacy paid orders without a payment-confirmation timestamp and no recorded pickup windows. Their items need verified historical evidence before new requests can use the local/development fallback; they may return `PAYMENT_TIME_UNKNOWN`. Use a newly paid order for testing. No historical timestamps or original request snapshots were fabricated. See the [admin verification notes](FE-confirmation/ADMIN_REFUND_STRATEGY_API_CHANGES.md#development-migration-verification--2026-10-23) for schema/data checks. The development server still needs deployment/restart with this code.
