# Flutter handoff: per-variant refund windows in hours and delivery flows

Date: 2026-11-12
Status: implemented in backend source; **local and development migrations applied on 2026-11-12**; staging migrations remain pending. This is the consolidated Flutter contract for variant policies, hour units, manual delivery and unchanged CVS polling. Coordinate backend migration/deployment and client model/cache rollout.

## Whole-hour policy contract

Read `refundWindowHours` on the **selected variant**, not a product-wide setting. Each variant is independent; the unnamed simple-product variant has the same field. No inheritance exists.

| Value | Meaning / suggested copy |
| --- | --- |
| `0` | 不開放平台內退貨申請 |
| Whole number 1–87600000 | 確認取貨／交付後 N 小時內可申請 |
| Explicit JSON null | 符合資格後不限申請期限 |

New variants default to **192 hours (8 days)**. Fractions are unsupported. Daily UI is still fine: one day is 24 hours; show 192 as 8 days or 720 as 30 days. For nonmultiples of 24 such as 12 or 36, display the exact hours rather than rounding to whole days. A missing field in an older server/cache is unknown data, not default 192 or unlimited. Keep absent, null and 0 distinct.

## Response locations and selection

Existing API paths, methods, auth and success envelopes remain:

| API | Policy location |
| --- | --- |
| `GET /api/product/list` | `data.products[].variants[].refundWindowHours` |
| `GET /api/product/:id` | `data.variants[].refundWindowHours` |
| `GET /api/cart/list` | `data[].variant.refundWindowHours` for that row's selected variant; product variants also expose their own values |
| `POST /api/cart/validate-checkout` | Same policy fields inside existing `data.cartItems[]`; `success:true` with canCheckout:false remains a successful evaluation |
| Other full-variant payloads | Read the policy when a full variant is included; summary-only variants may omit it |

Product roots no longer expose a policy. The former `refundWindowDays` field is retired; never read an hour value as days or keep using a cached product policy for every variant. Changing selected productVariantId must recompute the visible policy. Before selection, use neutral “依所選規格” copy. An inactive/changed live variant does not hide purchased order/refund history.

Example excerpt:

```json
{
  "success":true,
  "data":{
    "id":"PRODUCT_UUID",
    "name":"線上外語學習課程",
    "variants":[
      {"id":"TRIAL_UUID","name":"體驗班","refundWindowHours":0},
      {"id":"ADVANCED_UUID","name":"進階班","refundWindowHours":720},
      {"id":"FULL_UUID","name":"完整課程","refundWindowHours":null}
    ]
  }
}
```

## Purchase snapshots and buyer refunds

`POST /api/order` keeps its body: submit the selected productVariantId, not an authoritative policy/snapshot/deadline/receipt field. The server locks/validates the variant and snapshots its hours at **order creation, before payment**. Later variant edits, ECPay checkout, successful payment and recovery do not replace that purchase policy.

Order/delivery/refund item payloads now expose **`refundWindowHoursAtSale`**, replacing `refundWindowDaysAtSale`. Existing purchase values are converted days × 24, preserving the purchased duration; original 10-day items become 240 hours. Existing receipt/deadline/extension timestamps are unchanged. Two variants in one product/order/delivery can have different policies. Purchase screens must use the order snapshot, while catalog/cart previews use live variant hours.

Continue to use computed item fields on order/delivery detail: `canRefund`, `refundBlockReason`, `refundWindowStatus`, `remainingRefundQuantity`, `unreservedRefundQuantity`, `refundWindowStartsAt`, `originalRefundDeadlineAt`, `refundDeadlineAt`, `refundWindowSource`, `refundServerTime`, `refundReceiptChecksBypassed`. Do not compute eligibility from a live variant, a status label, a null deadline, raw refund detail or list summary.

Null deadlines occur for disabled/unlimited/unknown timing. Unlimited still needs valid start, paid order and available quantity. Only committed verified payment is paid; payment-processing blocks new refunds. Timely accepted requests remain reviewable after expiry. Existing eligibility codes remain REFUNDS_DISABLED, ORDER_NOT_PAID, NOT_RECEIVED, RECEIPT_TIME_UNKNOWN, PAYMENT_TIME_UNKNOWN, REFUND_WINDOW_EXPIRED and NO_REFUNDABLE_QUANTITY.

Refund bodies/idempotency are unchanged: uncertain retry uses the same clientRequestId and exact payload; an intentional new request after rejection uses a new UUID. Rejection extends finite windows to max(current deadline, decision + **120 hours**), or **12 hours** in local/development; the extension unit/rule has not changed. Partial completion/cancellation does not extend the window. Existing records stay visible when new requests are blocked. Unknown payment results require re-reading the original order, not a second payment/new order.

## Virtual/home delivery completion (2026-11-12)

Seller/admin uses the existing `PUT /api/admin/delivery/:deliveryId` with `{"status":"delivered"}`. For virtual products and seller-managed home delivery, saving this status automatically records actual fulfillment and starts each linked item's purchased refund window. There is no separate confirmation endpoint. Flutter buyers do not call the admin API or confirm receipt themselves.

Delivery means the digital product has been handed over or the home-delivery goods have arrived, not merely shipped. Payment or a chat message does not establish receipt in staging/production. Original checkout method/variant associations and a paid order are required. Missing/mismatched historical associations need seller/support reconciliation.

The first completion records `receivedAt` and immutable receipt evidence; `refundWindowSource` remains `receipt`. Evidence sources additionally accept `seller_confirmation`/`admin_confirmation` alongside provider values and include server actor/time. Update strict evidence-source parsers and tolerate future unknown values. Existing order/delivery APIs and computed eligibility fields are unchanged; refresh their detail after updates/resume. Chat summaries are not a substitute for computed refund eligibility.

For virtual/home delivery only, delivered blocks status resets. Repeated delivered updates preserve the first time, purchased snapshot and rejection extensions. CVS processing is unchanged: retain its existing callback/polling and status handling; its receipt window starts at trusted pickup, not store arrival. Do not apply the new virtual/home terminal UI rules to CVS.

Finite policies use the purchased variant duration; 0 remains disabled and null still needs valid start/payment/quantity. In staging/production the full N-hour duration starts at completion; local/development retain the accelerated duration and existing payment fallback. Historical delivered manual records lacking evidence can be saved as delivered again by seller/admin to confirm **now**, never backdated. Until valid evidence exists, show backend `NOT_RECEIVED`/`RECEIPT_TIME_UNKNOWN` feedback rather than deriving eligibility from a status label alone. Label virtual/home start times as delivery/fulfillment confirmation, rather than CVS pickup time.

These delivery-state changes need no additional migration. The variant-policy migrations below are applied locally and in development; staging remains pending.

## CVS polling and status meanings

CVS processing remains unchanged. The normal provider flow is shipped → ready_for_pickup (store arrival) → delivered (actual pickup). Arrival does not start the refund clock; trusted pickup does. Do not apply the new virtual/home terminal-state rules to CVS.

Ready-for-pickup **continues polling for actual pickup**. The existing scheduler runs every 30 minutes in staging/production unless cron is disabled; explicit local/development skip polling. Eligible rows need merchant trade number plus ECPay logistics ID. Pending/shipped/ready-for-pickup are selected when roughly 30 minutes is due, returned/exception when roughly 2 hours is due. Normal delivered/picked-up rows stop being selected. Legacy delivered rows still carrying store-arrival codes 2073/3029/2063/3018 continue until pickup. Cancelled/unknown are not selected. Callbacks can update before the next poll; existing timestamp buffers and subsequent/out-of-order-event behavior are unchanged.

Shared delivery statuses are pending, shipped, ready_for_pickup, delivered, returned, cancelled, exception and unknown. Processing belongs to refunds; payment-processing belongs to orders. Virtual normally uses pending → delivered (optional shipped for handoff); home delivery uses pending → shipped → delivered. Only the latter two methods get the new irreversible delivered status. Flutter buyers do not edit seller delivery state.

## Timing, errors, support and notifications

Normal finite duration is **H × 60 minutes**, never a calendar-day midnight. Explicit local/development divide by ten and retain payment-confirmation fallback before receipt. Examples: 1 hour becomes 6 minutes; 12 hours becomes 1h12m; 24 hours becomes 2h24m; default 192 hours becomes 19h12m; 720 hours becomes 72 hours. Other environments use full durations and require receipt/fulfillment evidence. Exact deadline means expired; always display the backend's effective timestamp. Null and 0 retain their meanings everywhere.

The shared error envelope/code catalogue and recovery remain in [the error handoff](FLUTTER_ERROR_HANDLING_FEEDBACK.md). Message may be string/array/legacy structure; failures include code/requestId and optional safe fieldErrors. X-Request-ID is a support reference, not an idempotency key. Domain code takes priority over HTTP fallback; handle unknown codes, missing new fields during rollout and non-JSON errors safely. A successful negative eligibility/evaluation is not a transport failure. Existing auth refresh, SSE cursor/reset/backoff and mutation reconciliation rules remain.

Help `GET /api/system/customer-support` and consent `GET /api/file/user-consent` explain per-variant hours with optional daily display. Existing FAQ IDs, response structure, environment-specific routing and complete-reading callback remain compatible. Status emails/notifications still use purchased eligibility and effective rejection deadline in Taipei time; 查看訂單 links to the order. Minute-formatted email text is display-only; actions use full server timestamps.

## Migration and rollout

Local and development completed both steps on 2026-11-12. Staging remains pending and requires deployment authorization. Migration sequence:

| Environment | Variant step | Hour step |
| --- | --- | --- |
| Local (applied 2026-11-12) | `drizzle/local/0120_variant_refund_windows.sql` | `drizzle/local/0121_refund_window_hours.sql` |
| Development (applied 2026-11-12) | `drizzle/dev/0071_variant_refund_windows.sql` | `drizzle/dev/0072_refund_window_hours.sql` |
| Staging | `drizzle/stg/0019_variant_refund_windows.sql` | `drizzle/stg/0020_refund_window_hours.sql` |

The first backfills every existing variant from its former product day policy; the second renames/converts variant and order-snapshot values to hours and sets defaults to 192. It preserves 0/null, inactive variants, purchased durations and existing receipt/deadline/rejection timestamps. Only the private old product-day column remains as backfill reference; it is not the live policy.

Backend source requires both steps and a coordinated client release; old day-column code cannot run after the rename. Clear/refresh old cached models. Do not silently treat missing hours as null/default, reinterpret an old day number as hours, or multiply an already-hour response again. A daily UI converts units at its boundary, not in the generic API parser.

## QA

Cover 0/1/12/24/168/192/720/null, exact hour/day display, unnamed simple variants, selection switching, separate cart rows, mixed policies in one order/delivery, policy edits before/after order creation, old snapshot conversion and unchanged deadlines. Verify disabled/unlimited/start/payment/quantity rules, local acceleration, refund retries/rejection/partial completion/emails, virtual/home irreversible completion and the unchanged CVS polling/pickup flow. Backend validation runs on disposable databases; local/development migrations are applied; configured staging migrations remain deferred.

## Related notifications and verified status

Paid virtual/home orders still create their existing fulfillment follow-up chat message once, with the original paragraph and purchased product/variant, unit price, quantity and subtotal. Home delivery includes 配送方式：宅配到府; virtual omits that row. Subtotal excludes coin deductions/shipping/other fees. These reminders happen at payment, do not themselves confirm delivery or start normal-environment refund windows, and keep the existing plain-text message/SSE payload shape. Delivery completion uses the status API described above. Email/notification delivery does not change eligibility timestamps.

Verified 2026-11-12: build, shared error-contract checks and all 19 disposable-database suites pass. The upgrade rehearsal covers finite/zero/null policy conversion, inactive variants, 192-hour defaults and unchanged historical/extended deadlines. Local migration and post-migration checks confirm both steps are applied with no pending migrations: all 34 variant policies and 373 order-item snapshots converted correctly, defaults are 192 hours, constraints are validated, and existing receipt/deadline timestamps and all 28 refund records are preserved. Development migration checks also confirm all 55 variant policies and 165 order-item snapshots converted correctly, with 192-hour defaults, validated constraints, preserved receipt/deadline timestamps and all 30 refund records unchanged. Local and development have no pending migrations and identical public schemas (66 tables, 690 columns, 250 constraints, 170 indexes, 31 enums and one sequence; no views, application functions, triggers or policies). Latest migration SQL hashes match their journals. Staging was not migrated and remains pending. Git merge alone does not deploy/restart the running backend; use the matching hour-based backend source with these migrated databases.
