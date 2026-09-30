# Admin FE API update — missing API section 1

Date: 2026-09-16  
Swagger: `/api-docs`

Section 1 of
[`ADMIN_FE_CONFIRMATION_CHECKLIST.md`](ADMIN_FE_CONFIRMATION_CHECKLIST.md) is
implemented. All routes
below are under `/api/admin` and require an admin-side bearer token.

## Seller scope and permissions

- Platform admin: may query all sellers or select `sellerId` where documented.
- Seller: always limited to its own business data.
- Employee: inherits its account-group parent seller for operational reports.
- Employees cannot manage sub-accounts, finance ad budgets, or delete products.
- Inactive, banned, and soft-deleted accounts are rejected on every protected
  admin API request, including when an old access token has not expired.

## New and completed endpoints

| Feature | Endpoint | Notes |
| --- | --- | --- |
| Create employee | `POST /account/sub-account` | Seller creates under itself; admin supplies `parentId`; creates wallet atomically. |
| Delete employee | `DELETE /account/:id` | Soft delete; seller owner or platform admin. |
| Rename category | `PUT /product/categories/:id` | Platform admin; names are case-insensitively unique. |
| Delete category | `DELETE /product/categories/:id` | Detaches the category from associated products, preserves those products, and returns `detachedProductCount`. |
| Soft-delete product | `DELETE /product/:id` | Owner/admin; deactivates variants and pauses non-archived ads. |
| Permanently delete product | `DELETE /product/:id/permanent` | Platform admin; never-used products only. Blocker counts are included in the `409` message. |
| Adjust ad budget | `PUT /advertisement/budget/:id` | Supports `increase` and `set` at/above current balance. `decrease` and set-lower return `409 operation_not_supported`. |
| Wallet summary | `GET /account-wallet/me/summary` | Wallet cash-flow summary, not sales revenue. |
| Admin wallet summary | `GET /account-wallet/:accountId/summary` | Platform admin only. |
| Dashboard KPI | `GET /dashboard/kpi` | Seller scope, date range, and timezone. |
| Dashboard series | `GET /dashboard/time-series` | `metric=sales|orders|refunds|adViews|adSpend`; `interval=day|week|month`. |
| Pending tasks | `GET /dashboard/pending-tasks` | Counts plus FE route hints. |
| Recent activities | `GET /dashboard/recent-activities` | Reliable events from this feature cutover forward; cursor pagination. |
| Ad metrics | `GET /advertisement/metrics` | Views, spend, returns, coins, balance, platform advance/expense. |
| Product ad dashboard | `GET /advertisement/product/:productId/dashboard` | Includes archived and replacement advertisements. |
| Sidebar summary | `GET /sidebar-notifications/summary` | Actionable and new-since-seen counts. |
| Mark sidebar seen | `PUT /sidebar-notifications/:section/seen` | Sections: orders, deliveries, refunds, advertisements, chatrooms. |

Existing wallet operations remain canonical:

- `POST /account-wallet/:accountId/credit` — platform-admin confirmed/manual
  credit;
- `PUT /advertisement/deposit/:id` — atomic wallet-to-ad funding;
- `GET /account-wallet/me/transactions` and
  `GET /account-wallet/:accountId/transactions` — transaction history.

Do not use the old `/ad-revenue/*` route names. They were not recreated.

## Key request examples

Create an employee:

```json
{
  "parentId": "SELLER_UUID_FOR_ADMIN_CALLER",
  "name": "Store Operator",
  "realName": "王小明",
  "email": "operator@example.com",
  "password": "Password123!",
  "phone": "0912345678",
  "address": "optional"
}
```

Adjust an ad budget:

```json
{
  "operation": "increase",
  "amount": "200.00",
  "idempotencyKey": "stable-client-generated-key"
}
```

Wallet summary fields are decimal strings:

```json
{
  "openingBalance": "500.00",
  "adminCredits": "1000.00",
  "legacyOpeningCredits": "0.00",
  "advertisementFundingDebits": "-700.00",
  "closingBalance": "800.00",
  "transactionCount": 4,
  "startAt": "2026-09-01T00:00:00.000Z",
  "endAt": "2026-10-01T00:00:00.000Z"
}
```

## Intentional limitations

- Advertisement budget withdrawal is not supported. Existing ad balances may
  predate wallet provenance, so returning them would be able to mint wallet
  money.
- Ad reports do not expose CTR, impressions, or unique reach because the
  current database does not reliably record those facts.
- Recent activity does not fabricate historical state transitions before the
  new activity-event table was introduced.
