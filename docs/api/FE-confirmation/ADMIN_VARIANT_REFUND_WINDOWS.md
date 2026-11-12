# Admin FE handoff: variant refund windows in hours and delivery completion

Date: 2026-11-12
Status: implemented in backend source; **local migrations applied on 2026-11-12**; development/staging migrations remain pending. This is the authoritative consolidated contract for the variant/hour, delivery-status and CVS-polling changes. Coordinate migration, backend, admin FE and Flutter deployment.

## Policy editor and units

Each variant owns `refundWindowHours`. There is no product policy/default inheritance. A simple product's unnamed default variant owns the same setting. The default is **192 hours = 8 days**.

| Value | Meaning |
| --- | --- |
| `0` | No platform refund requests. |
| Integer `1` through `87600000` | Refund window in whole elapsed hours. |
| Explicit JSON `null` | No expiration once other eligibility requirements pass. Never means inheritance. |
| Omitted on a new variant | Default 192 hours, independent of the former product policy. |
| Omitted on an existing variant update | Preserve that variant's value. |

Negative numbers, fractional hours (including 0.5), strings, booleans and values above the maximum return HTTP 400. The upper bound preserves the former 3,650,000-day range after conversion. Keep 0/null/omission distinct; do not use truthiness or `value ?? 192` to serialize unlimited policies.

A daily editor/preset UI is supported: **send days × 24** and display hours ÷ 24 when exactly divisible. Examples: 1 day → 24, 3 → 72, 7 → 168, 8 → 192, 30 → 720. The API value 1 now means one hour, not one day. If an existing value is 12 or 36 hours, display hours or provide an explicit hours editor; never silently round it to whole days. No unit flag is needed because the field name identifies the unit.

## Admin APIs

Existing paths, methods, permissions and success envelopes remain. Other required product/variant fields and variant-mode constraints remain required.

| API | Policy location/behavior |
| --- | --- |
| `POST /api/admin/product/create` | `variants[].refundWindowHours`; new rows default to 192 when omitted. |
| `PUT /api/admin/product/:id` | Existing variant `id` plus optional `refundWindowHours`; omitted preserves. New rows without id retain required price/optionValues/stock and default to 192. |
| `GET /api/admin/product/list` | Each `data.products[].variants[]` includes nullable integer `refundWindowHours`. |
| `GET /api/admin/product/:id` | Each `data.variants[]` includes it, including inactive variants. |

The setting belongs in each variant row, including the unnamed simple-product variant. Offer disabled / finite hours (or daily presets) / unlimited. Sibling variants are independent. Do not put the policy in metadata.

Create example:

```json
{
  "sellerId":"SELLER_UUID",
  "name":"線上外語學習課程",
  "description":"課程說明",
  "variants":[
    {"name":"體驗班","price":500,"stock":20,"optionValues":{},"refundWindowHours":0},
    {"name":"進階班","price":2000,"stock":20,"optionValues":{},"refundWindowHours":720},
    {"name":"完整課程","price":4000,"stock":20,"optionValues":{},"refundWindowHours":null}
  ]
}
```

Update a selected variant (12 hours):

```json
{"variants":[{"id":"VARIANT_UUID","refundWindowHours":12}]}
```

Create/update responses remain `{success:true,data:{...product,variants:[...]}}`. Product root has neither policy field. Existing product permissions/lifecycle constraints still apply: seller ownership, employee write restrictions, exactly one active unnamed variant or multiple active named variants, and inactive history.

## Retired fields, validation and shared failures

Top-level `refundWindowDays` **and** `refundWindowHours` are rejected on create/update. Nested `variants[].refundWindowDays` is also rejected rather than silently becoming a default. All return HTTP 400 `VALIDATION_FAILED`, including explicit 0/null and requests that otherwise have correct nested hours. Remove old keys from serializers; do not send a fetched product object wholesale.

Invalid hours produce safe field errors such as `variants.0.refundWindowHours`; retired fields identify their own path. Keep inputs on validation failure. Shared failure fields remain `success`, `statusCode`, string/array/legacy `message`, `code`, `requestId` and optional `fieldErrors`. `X-Request-ID` matches the support reference; known cooldowns use optional `Retry-After`. Prefer domain code then safe status fallback, never English-text matching. Unknown codes, legacy deployments without code/requestId and non-JSON proxy errors must remain safe.

`INVALID_TYPE`, `INVALID_VALUE`, `VALUE_TOO_SMALL`, `VALUE_TOO_LARGE`, `INVALID_FORMAT`, `UNRECOGNIZED_FIELDS` and `INVALID_MULTIPLE` remain approved field codes. Existing auth/onboarding/session recovery applies; a business 403 is not automatically session expiry. Re-read authoritative resources after uncertain writes before retrying. IDs used for HTTP support references are not mutation idempotency keys.

## Order snapshots and refund review

The server locks/validates the chosen variant at order creation, **before payment**, and stores `orderItem.refundWindowHoursAtSale`. It no longer returns `refundWindowDaysAtSale`; existing purchases convert their day snapshot × 24 without changing their purchased duration. Edits before or after payment cannot re-snapshot an existing order. ECPay preparation/confirmation/recovery does not refresh it. Client-supplied policy/deadline fields are not authoritative.

Use computed `data.items[]` on `GET /api/admin/order/:id` or `GET /api/admin/delivery/:deliveryId`: snapshot hours, `canRefund`, `refundWindowStatus`, `refundBlockReason`, `remainingRefundQuantity`, `unreservedRefundQuantity`, `refundWindowStartsAt`, `originalRefundDeadlineAt`, `refundDeadlineAt`, `refundWindowSource`, `refundReceiptChecksBypassed` and `refundServerTime`. Products/cart previews use live variants; purchase screens use the frozen order snapshot. Raw refund-detail nested order items/list views are not replacements for computed eligibility.

A null deadline is not proof of unlimited eligibility: it can also mean disabled or timing unknown. Paid state, valid receipt/fulfillment start and available quantity remain prerequisites. `payment-processing` is not paid. Different variants of one product in one delivery can have different policies/deadlines. Keep existing requests visible even when new requests are blocked.

Finite periods use exact elapsed hours, not midnight/calendar days. A timely accepted request stays reviewable after expiry. Explicit rejection sets max(current deadline, rejection time + **120 hours**), or **12 hours** in local/development. This extension is unchanged by the new policy unit. Unlimited remains unlimited and 0 remains disabled. Partial completion/cancellation gives no extension. Quantity/base amount adjustments still require buyer agreement; quantity increases require an open effective window. Completed/cancelled/rejected requests are terminal; matching retries preserve prior effects and changed terminal decisions conflict.

Existing refund-review endpoints, original-request/audit display, agreed partial completion versus explicit rejection, registered-email/app notifications and 查看訂單 deeplinks remain as documented in the [combined admin handoff](ADMIN_ERROR_HANDLING_AND_REFUND_WINDOWS.md); its old product/day editor instructions are superseded here. Rejection emails use the effective deadline in Taipei time; minute-formatted email copy is not authoritative for exact eligibility.

## Delivery completion through the existing status API (2026-11-12)

Use the existing seller/admin delivery-status editor. Setting `status:delivered` now **confirms fulfillment and automatically starts the refund window** for virtual products and seller-managed home delivery. No separate confirmation endpoint or new request field is needed. Show an irreversible-action explanation before the user saves delivered: this means actual digital handoff or physical delivery, not merely shipment or payment.

```http
PUT /api/admin/delivery/DELIVERY_UUID
Content-Type: application/json
Authorization: Bearer ADMIN_TOKEN
```

```json
{"status":"delivered"}
```

For virtual/home delivery, only an active owning seller or platform admin can update; employees/app users cannot. Existing CVS permissions and update handling are unchanged. A seller must own all linked items; foreign deliveries return 404. First virtual/home completion requires a `paid` order, nonempty consistent linked items, a seller-managed method without an ECPay logistics ID, and product/variant associations matching the original checkout `nonCvsPickupGroup` selection (`HOME` is accepted as the legacy home-delivery selection). The prior state must be pending, shipped or an older delivered row missing evidence. Missing/mismatched historical associations need support reconciliation.

The existing `{success:true,data:...}` delivery-detail response sets `status:delivered`, records the server's first `receivedAt` and initializes each linked item's purchased variant policy. Evidence source is `seller_confirmation` or `admin_confirmation` and includes actor account/role, `confirmedAt`, `observedAt` and `estimated:false`. `delivery.confirmed` audit, status log, receipt/windows and applicable chat updates commit atomically. Existing delivery notifications run after commit when appropriate; failures cannot roll back saved delivery. Receipt timestamps/evidence remain server-owned and cannot be overwritten by request fields. Metadata remains editable; it is not authoritative receipt evidence.

**Delivered is terminal for virtual and home delivery only.** Later status changes—including pending, shipped, ready-for-pickup, cancelled or returned—and changes to logistics identity are rejected with 409 `DELIVERY_TERMINAL`. Remove/disable those choices once completion is saved; do not offer a reset action. Editable metadata or harmless descriptive fields remain editable. A return/refund is handled through the existing refund workflow instead of resetting delivery. Re-sending `delivered` preserves the first receipt/evidence, does not add confirmation audit/log/notification effects when unchanged, and never resets original/effective deadlines or rejection extensions.

CVS is unchanged: existing callbacks/polling normalize store arrival to `ready_for_pickup` and actual pickup to `delivered`; trusted pickup initializes the existing refund window. Existing CVS status-edit permissions and handling of subsequent/out-of-order events are preserved. The new virtual/home terminal guard and automatic seller-confirmation logic do not run for CVS. Manual CVS status labels still do not create trusted receipt evidence; known receipt timestamps/deadlines remain preserved by the original receipt logic.

An older virtual/home record already labelled delivered but missing evidence can be saved as delivered again to confirm at the current server time. Nothing is backdated from old logs, payment time or `updatedAt`. Existing receipt timestamps are never replaced. The first real completion starts the full purchased N hours in staging/production; local/development retain 1/10 durations and payment fallback. `0` remains disabled and `null` is unlimited only after other prerequisites pass. `refundWindowSource` remains `receipt`.

| HTTP / code | FE recovery |
| --- | --- |
| 400 `VALIDATION_FAILED` | Correct fields/ID; do not submit receivedAt or receiptEvidence. |
| 401 / 403 | Existing session/role recovery; employees cannot update delivery. |
| 404 | Missing delivery or outside seller scope; refresh the list. |
| 409 `DELIVERY_TERMINAL` | Reload saved virtual/home delivered state and remove reset/status/identity edits. |
| 409 `ORDER_NOT_PAID` | Await verified committed payment before marking delivered. |
| 409 `DELIVERY_ITEMS_REQUIRED` | Reconcile missing/inconsistent linked order items. |
| 409 `DELIVERY_CONFIRMATION_NOT_SUPPORTED` | For virtual/home: provider-managed method or checkout selection mismatch; do not bypass via type edits. |
| 409 `DELIVERY_NOT_CONFIRMABLE` | Cannot complete the current cancelled/returned/exception/unknown record. |

After an uncertain PUT outcome, re-read this delivery and retry delivered if needed; never reset status or create another delivery to restart a window. Refresh order/refund detail for authoritative eligibility. There is no `/confirm-delivery` endpoint. Completion/terminal-state handling needs no additional migration; the variant-policy migrations below are applied locally and remain pending in development/staging.

## Seller status choices and CVS polling

Delivery statuses accepted by the shared API are:

| Value | Meaning / normal use |
| --- | --- |
| `pending` | 待處理 |
| `shipped` | 已出貨／交付中 |
| `ready_for_pickup` | 到店待取; normal UI use is CVS |
| `delivered` | 已送達／已交付 (actual pickup for CVS provider flow) |
| `returned` | 已退回 |
| `cancelled` | 已取消 |
| `exception` | 配送異常 |
| `unknown` | 狀態未知 |

`processing` is a refund status, not a delivery status. `payment-processing` is an order/payment status, not delivery. Before manual completion the shared enum accepts the above values, but the recommended virtual flow is pending → delivered (optional shipped for handoff in progress); home delivery is pending → shipped → delivered. Complete virtual/home only from pending/shipped or a historical delivered row lacking evidence. After completion, disable resets and logistics-identity edits for these two methods. Do not apply those new terminal UI restrictions to CVS.

**CVS processing is unchanged.** ECPay callback/polling normalizes store arrival to ready_for_pickup, then actual pickup to delivered. Store arrival does not start the window; trusted pickup does. Existing CVS update permissions, later/out-of-order event handling and preservation of stored receipt deadlines remain unchanged.

Polling runs on the existing 30-minute scheduler in staging/production unless cron is disabled. Only CVS rows with both merchant trade number and ECPay logistics ID qualify. Eligibility by stored state:

| State | Poll selection |
| --- | --- |
| pending / shipped / ready_for_pickup | Continue when the approximately 30-minute polling interval is due. |
| returned / exception | Continue when the approximately 2-hour interval is due. |
| normal delivered/picked-up | Not selected for further polling. |
| old delivered with store-arrival code 2073/3029/2063/3018 | Continue as a legacy waiting-for-pickup record, not completed pickup. |
| cancelled / unknown | Not selected by the current polling query. |

Ready-for-pickup therefore continues polling until pickup is confirmed; a callback can arrive before the next poll. Existing timestamp buffers apply to interval selection. Polling is disabled in explicit local/development. This documents the existing CVS process; it is not a new monotonic-status policy for CVS.

## Migration, timing and rollout

Local completed both steps on 2026-11-12. Development/staging remain pending; **do not apply there until deployment is authorized**. Both steps are required, in order:

| Environment | Variant backfill step | Hour conversion step |
| --- | --- | --- |
| Local (applied 2026-11-12) | `drizzle/local/0120_variant_refund_windows.sql` | `drizzle/local/0121_refund_window_hours.sql` |
| Development | `drizzle/dev/0071_variant_refund_windows.sql` | `drizzle/dev/0072_refund_window_hours.sql` |
| Staging | `drizzle/stg/0019_variant_refund_windows.sql` | `drizzle/stg/0020_refund_window_hours.sql` |

The first step copies each product's former day policy into every existing variant, including inactive variants/inactive or deleted parents, preserving 0/null. The second renames variant/order-snapshot columns to hours, converts every stored day value × 24 (10-day snapshot → 240 hours), and sets future defaults to 192. It leaves receipt times, original/effective deadlines, rejection extensions and refund records unchanged. New variants do not inherit from old product defaults. The old product day column remains private backfill/rollback reference, not a live API setting. Older code cannot safely run against renamed hour columns; stop/coordinately replace old API processes during rollout. Reverting units requires a deliberate rollback, especially once non-day-multiple hour policies exist.

Local/development divide the configured hour duration by ten and keep their first-confirmed-payment fallback when receipt is unknown. Normal/test/staging/production use the full duration and require receipt/fulfillment evidence. Examples:

| API hours | Normal duration | Local/development duration |
| ---: | --- | --- |
| 1 | 1 hour | 6 minutes |
| 12 | 12 hours | 1 hour 12 minutes |
| 24 | 1 day | 2 hours 24 minutes |
| 192 (default) | 8 days | 19 hours 12 minutes |
| 720 | 30 days | 72 hours |

Consent/help content now describes per-variant hour policies and optional day display; existing URLs, FAQ IDs, JSON structure and complete-reading callback remain. Their delivery rules distinguish manual virtual/home completion from original CVS pickup handling.

Coordinate FE, Flutter and backend models/caches. A missing hours field on an old deployment is unknown legacy data, not null/unlimited or default 192. Clear/refresh cached day contracts; avoid reinterpreting cached day values as hours or multiplying already-hour values again. No production/test-baseline migration was generated from the unestablished/stale baselines in this checkout. Applying migration files is deferred; no configured environment database is migrated by disposable tests.

## Acceptance and verification

Cover hours 0/1/12/24/168/192/720/null, maximum bounds, fractional rejection, simple products, new-row defaults, omitted existing updates, sibling independence, root/old-day rejection, nested paths, inactive variants and live product/cart previews. Verify snapshot conversion, unchanged historical deadlines/extensions, variant edits before payment, exact-hour expiry, local 1/10 timings, refund reviews and emails. Delivery tests cover ownership/paid prerequisites, manual completion/retry/rollback/terminal restrictions and unchanged CVS status/callback/poll behavior. Test the documented polling selection separately from the new manual-delivery rules.

Use `npm run build`, `npm run test:refund-strategy` and `npm test`. Upgrade SQL is rehearsed only inside rollback transactions in disposable databases; this does not apply migrations to configured local/development/staging databases.

## Related notifications and verified status

Paid virtual/home orders still create their existing fulfillment follow-up chat message once, with the original paragraph and purchased product/variant, unit price, quantity and subtotal. Home delivery includes 配送方式：宅配到府; virtual omits that row. Subtotal excludes coin deductions/shipping/other fees. These reminders happen at payment, do not themselves confirm delivery or start normal-environment refund windows, and keep the existing plain-text message/SSE payload shape. Delivery completion uses the status API described above. Email/notification delivery does not change eligibility timestamps.

Verified 2026-11-12: build, shared error-contract checks and all 19 disposable-database suites pass. The upgrade rehearsal covers finite/zero/null policy conversion, inactive variants, 192-hour defaults and unchanged historical/extended deadlines. Local migration and post-migration checks confirm both steps are applied with no pending migrations: all 34 variant policies and 373 order-item snapshots converted correctly, defaults are 192 hours, constraints are validated, and existing receipt/deadline timestamps and all 28 refund records are preserved. Development/staging were not migrated and remain pending.
