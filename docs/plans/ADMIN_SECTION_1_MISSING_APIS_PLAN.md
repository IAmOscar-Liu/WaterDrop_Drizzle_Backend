# Admin section 1 missing APIs plan

Date: 2026-09-16  
Source: `docs/api/FE-confirmation/ADMIN_FE_CONFIRMATION_CHECKLIST.md`

Status: implemented on 2026-09-16. The FE handoff is
`docs/api/FE-confirmation/ADMIN_SECTION_1_UPDATE_2026-09-16.md`; rollout instructions are in
`docs/operations/ADMIN_SECTION_1_ROLLOUT.md`.

## Section 2 completion audit

Section 2 is complete. The current implementation, Swagger, and disposable-DB
API tests cover all ten items:

| Item | Result | Evidence |
| --- | --- | --- |
| Login/refresh/logout | Complete | Admin access token is 1 day locally and 1 hour elsewhere; refresh token and cookie are 30 days; logout clears the cookie with matching options. |
| Registration | Complete | `name`, `realName`, `email`, `password`, and `phone` are validated and documented. |
| Password change | Complete | Self-only, old-password verification, and new-password complexity validation are tested. |
| Account/avatar update | Complete | `avatarUrl` and legacy `avatar_url` accept a URL or `null`. |
| Account/sub-account filters | Complete | `/account/list` is platform-admin-only and supports `sellerId`, `accountGroupId`, and `parentId`. |
| Advertisement deposit | Complete | Wallet-backed, atomic, authorized, balance checked, idempotent, and documented. |
| Advertisement status | Complete | Owner/admin authorization plus product, variant, balance, and archive checks. |
| Advertisement view counts | Complete | Owner check on the single-ad endpoint; separate platform-admin endpoint with optional seller filter. |
| Refrigerated shipping fee | Complete | Middleware and repository use `HOME_DELIVERY_REFRIG_FEE`. |
| Push notification | Complete | Admin-only app-user/group targeting; all-user broadcast remains intentionally unsupported. |

The section 2 handoff is in:

- `docs/api/FE-confirmation/ADMIN_SECTION_2_UPDATE_2026-09-16.md`
- `docs/api/FE-confirmation/ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md`
- Swagger at `/api-docs`

## Current section 1 coverage

Section 1 is not entirely greenfield. Reuse the following APIs instead of
recreating old route names:

| Old requirement | Current replacement | Remaining work |
| --- | --- | --- |
| Wallet account | `GET /account-wallet/me`, `GET /account-wallet/:accountId` | None for current balance. |
| Wallet transactions | `GET /account-wallet/me/transactions`, admin account transaction endpoint | Add a period summary only. |
| Wallet credit | `POST /account-wallet/:accountId/credit` | None; keep platform-admin-only and provider-confirmed/manual-correction semantics. |
| Increase ad budget | `PUT /advertisement/deposit/:id` | None for increases. Decrease/set-lower conflicts with the accepted no-withdrawal decision. |
| Seller ad views | Existing seller and platform view-count endpoints | Add richer financial/reward metrics and product dashboard. |
| Product sales summary | `GET /product/:id/sales-summary` | Reuse inside dashboards; it is not a complete dashboard by itself. |

Do not add compatibility aliases under `/ad-revenue` unless FE cannot migrate.
One canonical route for each operation avoids two contracts for the same money.

## Shared authorization foundation

Implement this before the individual section 1 endpoints.

Create one reusable admin-side scope resolver:

```text
platform admin -> may select any seller scope
seller         -> seller scope is its own account ID
employee       -> seller scope is its account-group parent
```

Recommended employee permissions:

- may read and perform ordinary operational work in the parent seller scope;
- may not create/delete sub-accounts;
- may not credit wallets, fund/return ad budget, permanently delete data, or
  perform other financial/destructive operations;
- platform admin may override seller scope only through a documented
  `sellerId` query/body field.

Every product, advertisement, order, delivery, report, and dashboard query must
derive its seller scope on the server. Never trust an unrestricted seller ID
from an ordinary seller/employee request.

Also make admin authentication reject inactive, banned, or soft-deleted
accounts on every protected request. Otherwise a deleted employee's existing
JWT remains usable until it expires.

## 1. Create and delete sub-accounts

### APIs

```http
POST   /api/admin/account/sub-account
DELETE /api/admin/account/:id
```

`POST /account/sub-account` accepts the normal account registration fields but
always creates role `employee`:

```json
{
  "parentId": "SELLER_UUID",
  "name": "Store Operator",
  "realName": "王小明",
  "email": "operator@example.com",
  "password": "Password123!",
  "phone": "0912345678",
  "address": "optional"
}
```

- Seller callers are forced to use themselves as `parentId`.
- Platform admins may select an active seller parent.
- Employees cannot create sub-accounts.
- Account, zero-balance wallet, account group, and membership are created in
  one transaction.
- Duplicate email returns `409`.

`DELETE /account/:id` should be a soft delete for employees only. Add
`deletedAt` and `deletedByAccountId`, set status inactive, and immediately deny
future authenticated requests. Seller callers may delete only their own
employees; platform admins may delete any employee. Preserve the account and
wallet history for audit. Physical account deletion is not recommended.

Restrict public/admin registration to seller creation; employees should be
created only through the protected sub-account workflow.

## 2. Rename and delete product categories

### APIs

```http
PUT    /api/admin/product/categories/:id
DELETE /api/admin/product/categories/:id
```

Category taxonomy is platform-wide, so create, rename, and delete should all be
platform-admin-only. Listing remains available to authenticated admin-side
accounts.

- Rename accepts `{ "name": "New name" }`.
- Trim names and enforce case-insensitive uniqueness.
- Missing category returns `404`; duplicate name returns `409`.
- Delete atomically removes all matching `products_to_categories` rows,
  updates the affected products' `updatedAt`, and then deletes the category.
  Products and their other categories remain unchanged.
- Return `detachedProductCount` so the FE can report how many products were
  updated.

## 3. Soft-delete and permanently delete products

### APIs

```http
DELETE /api/admin/product/:id
DELETE /api/admin/product/:id/permanent
```

Add nullable `deletedAt` and `deletedByAccountId` to products.

Soft delete is the normal operation:

- owning seller or platform admin only;
- set product and variants inactive;
- pause a non-archived advertisement so it is no longer newly distributed;
- preserve orders, refunds, chat, ad accounting, and product history;
- exclude deleted products from normal/admin lists unless an explicit
  `includeDeleted=true` admin filter is used;
- make repeated deletion idempotent.

Permanent deletion is exceptional and should be platform-admin-only. Permit it
only for a never-used product with no order items, advertisement, cart,
collection, chatroom, refund-derived history, or other business reference.
Return `409` with blocker counts otherwise. Do not cascade-delete financial or
order history.

## 4. Advertisement budget adjustment

Current safe increase path:

```http
PUT /api/admin/advertisement/deposit/:id
```

The requested old contract is:

```http
PUT /api/admin/advertisement/budget/:id
```

```json
{
  "operation": "increase | decrease | set",
  "amount": "200.00",
  "idempotencyKey": "stable-client-key"
}
```

`increase` can delegate to the existing atomic wallet-to-ad funding workflow.
`set` above the current balance can fund only the difference.

`decrease` and `set` below the current balance currently contradict the
accepted decision that ad funds cannot be withdrawn to the wallet. They are
also unsafe for grandfathered balances that were never debited from a wallet:
returning those funds would mint wallet money.

Recommendation for the first section 1 delivery:

- keep the canonical deposit endpoint for increases;
- do not expose decrease or set-lower;
- continue using replacement-ad balance transfer for archived ads;
- return `409 operation_not_supported` if a compatibility budget endpoint is
  temporarily required by FE.

If this decision is reversed later, first add funding provenance and an exact
withdrawable amount. Existing/grandfathered balance starts non-withdrawable;
wallet funding increases withdrawable value; views reduce it; qualifying seller
returns restore it. Add paired `advertisement_funding_refund` wallet credit and
`wallet_withdrawal` ad debit transactions in one locked, idempotent transaction.

## 5. Wallet account, transaction, and summary queries

Keep the existing account-wallet APIs as replacements for the old
`/ad-revenue/account` and `/ad-revenue/transactions` paths.

Add:

```http
GET /api/admin/account-wallet/me/summary?startAt=&endAt=
GET /api/admin/account-wallet/:accountId/summary?startAt=&endAt=
```

The second route is platform-admin-only. Return exact decimal strings:

```json
{
  "openingBalance": "500.00",
  "adminCredits": "1000.00",
  "advertisementFundingDebits": "-700.00",
  "closingBalance": "800.00",
  "transactionCount": 4,
  "startAt": "2026-09-01T00:00:00.000Z",
  "endAt": "2026-10-01T00:00:00.000Z"
}
```

Call this a wallet cash-flow summary, not seller sales revenue. The existing
`totalRevenueCash` and `totalRevenueCoin` columns are not maintained by current
workflows and must not be presented as authoritative revenue.

## 6. Wallet credit and budget funding

Use the already implemented APIs:

```http
POST /api/admin/account-wallet/:accountId/credit
PUT  /api/admin/advertisement/deposit/:id
```

Do not recreate the old client-authoritative `POST /ad-revenue/charge` behavior.
Wallet credits remain platform-admin-only and represent an already confirmed
payment or manual correction. A future online charge must be credited only by
a verified payment-provider webhook.

The remaining budget limitation is described in item 4.

## 7. Admin dashboard

### APIs

```http
GET /api/admin/dashboard/kpi
GET /api/admin/dashboard/time-series
GET /api/admin/dashboard/pending-tasks
GET /api/admin/dashboard/recent-activities
```

Shared filters:

```text
startAt, endAt, timezone, sellerId (platform admin only)
```

Default timezone should be `Asia/Taipei`; validate all timezone names. Seller
and employee calls are server-scoped to their seller.

Recommended definitions:

- KPI: paid order count/gross merchandise value, completed refund amount, net
  sales, pending orders, pending deliveries, active/depleted ads, ad spend, and
  current wallet balance.
- Time series: `interval=day|week|month` and
  `metric=sales|orders|refunds|adViews|adSpend`.
- Pending tasks: actionable counts with route/deep-link hints, not full records.
- Recent activities: normalized order, refund, delivery, ad-status, wallet, and
  account events with cursor pagination.

For accurate future activity history, add `admin_activity_events` rather than
trying to infer every state transition from each table's latest row. Store
actor, seller scope, event type, entity type/ID, small metadata, and timestamp.
Do not backfill invented historical transitions; optionally seed only events
that can be proven from immutable logs.

## 8. Advertisement reports

### APIs

```http
GET /api/admin/advertisement/metrics
GET /api/admin/advertisement/product/:productId/dashboard
```

Support date range, pagination, status, product, and platform-admin `sellerId`
filters. Seller/employee scope is derived server-side.

Per-ad metrics should include:

- completed view count;
- gross view spend, seller-returned amount, and net settled spend;
- current balance and status;
- funded/rewarded coin amounts;
- platform advance outstanding/promotional expense where applicable;
- daily time-series buckets for views, spend, and funded coins.

Use `ad_view_counts`, advertisement transactions/stats, funding transactions,
and settlement cohorts. Do not publish CTR, impressions, or unique reach because
the current schema does not record reliable impression data.

The product dashboard must verify product ownership and return the product plus
its current/replacement advertisement chain; archived history must not disappear.

## 9. Sidebar notification counts

### APIs

```http
GET /api/admin/sidebar-notifications/summary
PUT /api/admin/sidebar-notifications/:section/seen
```

Add an `admin_sidebar_read_states` table keyed by `(accountId, section)` with
`lastSeenAt`. Keep read state per human account, while counting business records
inside the resolved seller scope.

Initial sections:

```text
orders, deliveries, refunds, advertisements, chatrooms
```

The summary should return both actionable totals and `newSinceLastSeen`, plus
the stored timestamp. The seen endpoint advances time monotonically and is
idempotent. Platform admins may optionally select a seller for counts, but their
read state remains attached to their own account and selected scope; include
seller scope in the read-state key if admin per-seller badges are required.

At cutover, initialize existing accounts' seen time to the deployment timestamp
so the FE does not show every historical record as new.

## Schema and indexes

Expected schema additions:

- `accounts.deletedAt`, `accounts.deletedByAccountId`;
- `products.deletedAt`, `products.deletedByAccountId`;
- case-insensitive category-name uniqueness;
- `admin_activity_events`;
- `admin_sidebar_read_states`;
- seller/time indexes needed by dashboard and ad-report queries;
- budget-provenance columns/tables only if the no-withdrawal decision is
  explicitly reversed.

Generate migrations independently for test, local, and development. Audit the
existing staging migration-history gap before generating staging changes.

## Implementation order

1. Add the shared seller-scope resolver and active-account enforcement.
2. Add schema migrations and backfill/cutover scripts.
3. Implement sub-account and category APIs.
4. Implement product soft/permanent deletion.
5. Add wallet summary and finalize the budget compatibility decision.
6. Add ad metrics and product ad dashboard.
7. Add dashboard APIs and activity events.
8. Add sidebar state and count APIs.
9. Update Swagger and produce one dated Admin FE handoff.
10. Extend `npm test`; keep all fixtures in the disposable database.

## Required test coverage

- seller/admin/employee scope and cross-seller denial for every new route;
- soft-deleted account tokens stop working immediately;
- sub-account creation creates exactly one wallet and correct parent membership;
- category reference conflict and name uniqueness;
- product soft-delete side effects and permanent-delete blocker matrix;
- wallet summary opening/period/closing balance reconciliation;
- budget idempotency, insufficient funds, and unsupported withdrawal behavior;
- dashboard and report totals against known orders/refunds/ad views;
- timezone bucket boundaries;
- sidebar seen-time monotonicity and seller isolation;
- existing account-wallet, coin-ledger, order/refund, and cron tests remain green.

## Implemented decisions

Recommendations are listed first:

1. **Ad budget decrease/set-lower:** keep unsupported, preserving the accepted
   no-withdrawal policy. Reversing this requires the provenance design in item 4.
2. **Employee permissions:** inherit seller operational scope, but exclude
   finance, sub-account management, and destructive operations.
3. **Permanent product deletion:** platform-admin-only and only for a
   never-used product with zero blockers.
4. **Wallet “revenue” wording:** expose a cash-flow summary; do not call unused
   aggregate columns or wallet top-ups seller sales revenue.
5. **Dashboard timezone:** default to `Asia/Taipei`, while accepting a validated
   query timezone for presentation buckets.
6. **Sidebar cutover:** initialize `lastSeenAt` at deployment, avoiding a badge
   containing all historical records.
7. **Activity history:** record reliable events from cutover onward; do not
   fabricate a full historical activity feed.
