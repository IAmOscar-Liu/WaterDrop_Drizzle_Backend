# BE requirement 1001 — 回收廣告費, admin login integration, and internal statistics

Date: 2026-10-01

Status: implemented on `feat/be1001-implementation`, tested in disposable PostgreSQL databases. **Not deployed; local/development/staging migrations remain user-managed.** No environment files or existing database contents were changed. This implements sections 1 and 3. For section 2, the agreed direction on 2026-10-04 is to retain the existing token-refresh setup and have FE integrate automatic renewal; no new 24-hour idle-session policy is requested.

## Schema and rollout

Update `src/db/schema.ts` is included. Required database changes are:

- `transaction_type`: add `budget_withdrawal`.
- `account_wallet_transaction_type`: add `advertisement_budget_return`.
- Update the wallet transaction sign, advertisement-required, and actor-required checks. Return credits must be positive and identify both advertisement and actor.

No new tables, columns, indexes or data backfill are required. Existing wallet initialization and coin-ledger reconciliation must already be complete. The check expressions compare enum text, avoiding references to a newly added enum literal before its transaction commits.

Starting from the implementation worktree, provide the existing local environment configuration, then generate, inspect and apply your local migration:

```sh
npm run db:generate:local
npm run db:migrate:local
```

Review the generated SQL for the two enum additions and three check replacements. Apply the schema before running the updated writers/reports. The changes do not include generated migrations or claim to test the generated deployment SQL. Repeat environment-specific generation/review/application yourself as appropriate.

Tests apply the pending schema definitions **only to newly created disposable databases**, after applying existing test migrations; each suite gets a fresh database. They never migrate the configured `.env.test` database. This temporary schema setup can be removed after the equivalent test migrations exist.

## Existing API retirement

| Operation | Contract |
| --- | --- |
| `PUT /api/admin/advertisement/deposit/:id` | Retired; 404. No redirect or alias. |
| `PUT /api/admin/advertisement/budget/:id`, `increase` | Retained. Seller wallet debit and ad credit. |
| Same budget API, `decrease` | Validated but unsupported; authorized requests return 409. |
| Same budget API, `set` | Removed; 400 validation error. |

The retired standalone top-up API is **deposit**. The budget `increase` operation is still supported. Archived or financially closed ads cannot be topped up or reactivated.

## 回收廣告費

Only an **active owning seller or active platform admin** may preview or withdraw; employees, app users and other sellers cannot. The product's current seller receives the credit, including when an admin acts. The owning seller must also be active. Product ownership is locked and rechecked before writing.

1. Archive the ad and use the existing financial-close API after its grace/claim prerequisites are met.
2. Request a preview and show its balance and blocking reasons.
3. Send the chosen amount or `mode: "all"`, with the preview's expected balance and token.
4. Keep the same idempotency key and body on timeout/retry. After a conflict, obtain a fresh preview and a new key for a newly confirmed request.

### Preview

```http
GET /api/admin/advertisement/ADVERTISEMENT_UUID/budget-withdrawal-preview
Authorization: Bearer ACCESS_TOKEN
```

```json
{
  "success": true,
  "data": {
    "advertisementId": "ADVERTISEMENT_UUID",
    "sellerId": "SELLER_UUID",
    "eligible": true,
    "reasons": [],
    "balance": "1000.00",
    "withdrawableAmount": "1000.00",
    "walletBalance": "200.00",
    "currency": "TWD",
    "advertisementStatus": "archived",
    "financiallyClosedAt": "2026-10-01T00:00:00.000Z",
    "confirmationToken": "64-character-opaque-token"
  }
}
```

This is a consistent, read-only snapshot. An ineligible ad normally returns 200 with `eligible: false`, `withdrawableAmount: "0.00"`, and `reasons: [{code,message}]`. Invalid legacy monetary values require accounting reconciliation and return 409.

Eligibility requires archived status, archive and financial-close timestamps, a seller wallet, and no demand reward allocations. If a funding account exists, it must be closed with zero available seller funding and zero outstanding platform advance. A legacy financially closed ad without a funding account is allowed. Withdrawal does not take funds from coin lots or cancel user coins.

### Submit

```http
POST /api/admin/advertisement/ADVERTISEMENT_UUID/budget-withdrawal
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

Partial withdrawal:

```json
{
  "mode": "amount",
  "amount": "300.00",
  "expectedBalance": "1000.00",
  "confirmationToken": "TOKEN_FROM_PREVIEW",
  "idempotencyKey": "withdraw-ad-20261001-0001"
}
```

To withdraw everything, use `mode: "all"` and **omit `amount`**. Other fields stay the same. All money inputs are decimal strings with at most two fractional digits, no signs/exponents/grouping separators; amount must be positive. Input permits up to 14 whole digits, further bounded by safe cent representation in the existing floating-point ad balance. Unsupported legacy precision/range returns `WITHDRAWAL_BLOCKED`.

```json
{
  "success": true,
  "data": {
    "advertisementId": "ADVERTISEMENT_UUID",
    "mode": "amount",
    "withdrawnAmount": "300.00",
    "advertisementBalanceBefore": "1000.00",
    "advertisementBalanceAfter": "700.00",
    "walletBalanceBefore": "200.00",
    "walletBalanceAfter": "500.00",
    "walletId": "WALLET_UUID",
    "walletTransactionId": "WALLET_TRANSACTION_UUID",
    "advertisementTransactionId": "AD_TRANSACTION_UUID",
    "advertisementStatus": "archived",
    "financiallyClosedAt": "2026-10-01T00:00:00.000Z",
    "idempotentReplay": false
  }
}
```

Money is returned to `walletBalance`, not revenue, locked funds or a bank payout. Both ledger entries and the admin activity event commit with the balances. No successful partial execution is possible.

The confirmation token binds caller, advertisement, seller, closure/status, balance and ledger count. An intervening debit/credit invalidates it even when the resulting balance is identical. It is a change-detection token, not an authorization credential. Persistent wallet-ledger metadata stores the request fingerprint and original response. A matching retry returns the original result with `idempotentReplay: true`, even after later balance changes; current authorization is checked first. Key reuse with a different actor, body or operation returns 409. Failed transactions do not consume the key.

Balances are locked against concurrent withdrawals/transfers/settlement returns. Transfers now lock both statistics rows before reading balances; a closed ad cannot receive a new view charge. A remaining partial balance or later coin-settlement return can be withdrawn with a fresh preview or transferred to the ad's direct replacement. Withdrawal never reopens the old ad.

| HTTP | Code | FE handling |
| --- | --- | --- |
| 400 | Existing validation envelope (`validationErrors`) | Fix shape, mode, decimal format or key/token. |
| 400 | `INVALID_WITHDRAWAL_REQUEST` | Amount must be positive. |
| 403 | `WITHDRAWAL_FORBIDDEN` | Require an active admin or owning seller. |
| 404 | `ADVERTISEMENT_NOT_FOUND` | Refresh list. |
| 409 | `ADVERTISEMENT_NOT_FINANCIALLY_CLOSED` | Complete archive and financial close first. |
| 409 | `BALANCE_CHANGED` | Fetch a fresh preview and ask the user to reconfirm. |
| 409 | `ZERO_BALANCE` | No funds remain. |
| 409 | `INSUFFICIENT_AD_BALANCE` | Choose an amount within the confirmed balance. |
| 409 | `WITHDRAWAL_BLOCKED` | Read message; wallet/funding/precision/range reconciliation required. |
| 409 | `IDEMPOTENCY_CONFLICT` | Do not retry a changed request with the same key. |

Business errors preserve `{success:false,statusCode,message}` and add `code`. Validation and authentication middleware retain their existing envelopes; a disabled-account rejection from authentication may omit the operation-specific code.

Wallet transaction filters accept `advertisement_budget_return`; display **回收廣告費**. Wallet summaries add `advertisementBudgetReturns`, the positive sum within the supplied dates. Existing `me` and admin-selected-account paths reflect the credited balance. Ad metrics and product dashboards add exact positive `budgetWithdrawnAmount` and `periodBudgetWithdrawnAmount` strings. These totals do not change gross view spend or settlement-return totals. Product deactivation/deletion policies remain as implemented: a full withdrawal satisfies a zero-ad-balance prerequisite, but does not bypass other dependencies or restrictions.

## Admin login and token refresh — FE integration

Reviewed: 2026-10-04. Sources: [token configuration](../../../src/lib/token.ts), [account controller](../../../src/controller/account.ts), [authentication middleware](../../../src/middleware/isAuth.ts), and [password changes](../../../src/repository/account.ts).

**Agreed FE approach: keep the current access-token + refresh-cookie setup and use Axios interceptors (or an equivalent fetch wrapper) to renew access automatically.** The original section 2 proposal for a new server-enforced 24-hour inactivity policy is not being adopted in this change. Token refresh lets the user continue working while the refresh credential remains valid; it does not measure time since the last user operation.

### Verified lifetime and renewal behavior

| Item | Current backend behavior |
| --- | --- |
| Admin access token | Valid for 1 day in `local`, 1 hour in every other environment, measured from token issuance. Sent as `Authorization: Bearer TOKEN`. |
| Refresh token | JWT valid for 30 days; stored in an HttpOnly cookie with a 30-day Max-Age. FE cannot read it through JavaScript. |
| Successful refresh | Revalidates the account, issues a new access token and sets another refresh cookie valid for 30 days from issuance. The old refresh JWT is not tracked or explicitly invalidated server-side. |
| Ordinary protected API request | Verifies JWT expiry and active/non-deleted admin account status; does not renew the JWT/cookie or record a session activity deadline. |
| `/account/me` | Returns the account profile; does not renew tokens or expose an idle-expiry timestamp. `lastLogin` is login bookkeeping, not session activity. |
| No user activity / background polling | No 24-hour inactivity check exists. A valid refresh cookie can renew access even after more than 24 hours without user interaction; background refresh can extend the refresh-cookie lifetime. |

The local 1-day access-token lifetime is a fixed expiry after issuance, not a sliding 24-hour session. For example, outside local, an access token issued at 10:00 expires at 11:00. A refresh at 11:00 issues another token expiring at 12:00. It does not create a “last user operation + 24 hours” deadline.

### Endpoints and response fields

All paths below are under `/api/admin/account`.

| Request | FE action / response |
| --- | --- |
| `POST /login`, body `{email,password}` | Use credentials-enabled requests so the browser accepts the cookie. Success is `{success:true,data:{user,token}}`; store `data.token` in the FE auth store. |
| `POST /refresh-token`, no request body | Browser sends the refresh cookie; no Bearer token is required. Success is `{success:true,data:{token}}` plus a new cookie. Replace the stored access token. |
| `GET /me` | Send the access token. Success is `{success:true,data:<account profile>}`. |
| `POST /logout` | Send credentials so the cookie is cleared. Success is `{success:true,data:"OK"}`. Also clear FE access-token/profile state. |

Use `withCredentials: true` for Axios, or `credentials: "include"` for fetch. Cookies use `SameSite=Strict`, `Path=/`, `HttpOnly`, and `Secure` in production. Production sets the cookie domain to `waterdropping.com`; other environments use the issuing host. Credentials settings do not override browser SameSite rules: FE and API must use a compatible deployment origin/site, and cross-origin requests must satisfy the backend's configured CORS allowlist.

### Recommended Axios pattern

Use a shared Axios instance for protected admin requests, with a request interceptor to attach the access token and a response interceptor to handle expired access tokens. Keep login/refresh/logout on a separate instance without the refresh response interceptor, preventing recursive refresh calls. Axios supports custom instances and request/response interceptors; its credentials option controls credentialed cross-origin requests. [Axios interceptors](https://axios-http.com/docs/interceptors), [Axios request configuration](https://axios-http.com/docs/req_config).

```javascript
import axios from "axios";

// Example with a same-origin proxy; use your configured API origin if needed.
const authHttp = axios.create({ baseURL: "/api/admin", withCredentials: true });
const adminHttp = axios.create({ baseURL: "/api/admin", withCredentials: true });

adminHttp.interceptors.request.use((config) => {
  const token = authStore.getAccessToken(); // FE-provided auth store
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  else config.headers.delete("Authorization");
  return config;
});
```

Implement the response interceptor with these rules (the auth store, refresh coordinator and navigation belong to the FE):

1. On a confirmed **expired-access-token** 401, mark the request as retried and obtain a fresh token through `authHttp.post("/account/refresh-token")`. The current expiry response has `success:false`, `statusCode:401`, and message `Token validation error -  jwt expired`; there is no machine-readable auth error code yet. Do not treat every 401 as expiry: an incorrect old password on the change-password API also returns 401.
2. Use one shared in-flight refresh promise per FE instance. Concurrent expired requests await it instead of issuing multiple refreshes. If the store already has a newer token than the one sent by a delayed failed request, reuse it rather than refreshing again.
3. Replace the stored token from `response.data.data.token`, then retry the original request **once**, preserving method, URL, query, body and any existing idempotency key. Never generate a new payment/withdrawal key for that retry. A second authentication failure must not enter a refresh loop.
4. If refresh returns 401 (missing cookie) or 403 (invalid/expired cookie or unavailable account), clear auth state and return to login. A network error or 5xx is a transient failure, not proof of logout: show a retryable error. Do not automatically replay mutations after a network timeout; use their documented idempotency contract.
5. A regular API 403 can mean insufficient permissions or an inactive account. Do not refresh or log out indiscriminately on every 403; show the relevant error. Account-disabled/deleted responses should end the FE session.
6. On page reload or waking a suspended tab, if there is no usable access token, the app may attempt one cookie refresh before loading `/account/me`. Avoid timer-driven keepalive refresh merely because a tab is open. Optional expiry-based refresh should happen when authenticated work is needed, not as evidence of user activity.

The setup snippet illustrates Axios wiring, not a complete FE session manager. Stop/cancel pending refresh/retry work on logout or account switching and discard late results using an auth-state generation counter so an old response cannot restore a logged-out session. The retry coordinator must exclude login/refresh/logout and must not send the stored admin token to unrelated origins.

### Tabs, devices, logout and account changes

- Tabs sharing the same browser cookie scope share the refresh cookie; in-memory access-token stores are separate. A shared promise only coordinates one tab. Coordinate logout/account-switch state across tabs (for example, through `BroadcastChannel`); optionally coordinate refresh requests as well.
- Different browser profiles/devices have separate cookie stores. There is no server-side session ID, device-session registry or per-session activity deadline in this implementation.
- Logout clears the requesting browser's refresh cookie. It does not revoke already-issued JWTs or sign other devices out. FE must discard its own access token and notify sibling tabs.
- Protected admin requests and refresh reject accounts that are inactive or deleted. Password changes update the password hash but do not revoke previously issued access/refresh JWTs.
- This documents the admin/seller-side login flow. It does not change Flutter authentication or prescribe these refresh endpoints for the APP.

### Scope and validation

FE should describe this as automatic login renewal, not “every operation extends the session by 24 hours.” There is no activity-notification endpoint, `idleExpiresAt` field or session-idle error code to integrate. Do not add a 24-hour FE inactivity timer as a substitute for the current backend contract.

The existing API suite verifies non-local access-token lifetime, 30-day refresh JWT/cookie lifetime, renewal and logout cookie clearing. No authentication runtime code or Flutter behavior was changed for this documentation update; the Axios integration remains FE work.

## Company internal statistics

### Recommended FE integration

**Use the dedicated internal endpoints for new company-wide statistics screens:**

- `GET /api/admin/dashboard/kpi/internal`
- `GET /api/admin/dashboard/time-series/internal`

Send `startDate` and `endDate` as calendar dates; the backend calculates the Taipei day boundaries. For time-series requests, also select a `dataset`. No `report` query parameter is needed or accepted.

The existing `/kpi` and `/time-series` endpoints remain supported for operational and seller/employee dashboards. The internal endpoints are admin-only and have a different response shape.

| Feature | Endpoints (under `/api/admin/dashboard`) | Date fields | Format and requirements |
| --- | --- | --- | --- |
| Company statistics — recommended for this feature | `/kpi/internal`, `/time-series/internal` | `startDate`, `endDate` | Both required; `YYYY-MM-DD`; inclusive Taipei calendar days; maximum 366 days. |
| Existing operational dashboard | `/kpi`, `/time-series` | `startAt`, `endAt` | Optional exact timestamps, e.g. `2026-09-01T00:00:00Z`; either bound may be supplied alone. |

Each Swagger operation now shows only its own query fields. Internal requests reject `startAt`, `endAt` and other operational filters with 400. Operational requests reject `startDate`, `endDate`, `dataset` and `report` with 400 instead of silently returning the wrong report. Internal response metadata still includes `startAt` and `endExclusive`; these are backend-calculated boundaries, not additional request parameters.

In internal reports, the selected dates filter period activity. Current balances, the outstanding coin pool and the coin/ad ratio still describe the current `asOf` snapshot, not the historical closing balance at `endDate`.

**2026-10-04 routing change:** replace `/kpi?report=internal&...` with `/kpi/internal?...`, and `/time-series?report=internal&...` with `/time-series/internal?...`. Remove `report=internal`; keep the same calendar dates and dataset. The former selector-based URLs now return 400; there is no alias or redirect. The internal response shapes and statistics calculations are unchanged. This routing change requires no database migration.

### Requests and responses

```http
GET /api/admin/dashboard/kpi/internal?startDate=2026-09-01&endDate=2026-09-30
GET /api/admin/dashboard/time-series/internal?dataset=users&startDate=2026-09-01&endDate=2026-09-30
GET /api/admin/dashboard/time-series/internal?dataset=coin-flows&startDate=2026-09-01&endDate=2026-09-30
GET /api/admin/dashboard/time-series/internal?dataset=ad-finance&startDate=2026-09-01&endDate=2026-09-30
```

**Active platform admins only.** Sellers and employees get 403. Both dates are required, real `YYYY-MM-DD` dates, in ascending order, inclusive, at most 366 days. `Asia/Taipei` is fixed: September 1 starts at August 31 16:00 UTC; September 30 ends exclusively at September 30 16:00 UTC. Do not send `report`, `sellerId`, `startAt`, `endAt`, `timezone`, `metric` or `interval` to the internal endpoints. Missing/invalid dates or unsupported fields get 400. Use the original endpoints for operational reports.

Responses use `{success:true,data:{...}}`. Every metric uses this form:

```json
{
  "value": "123.45",
  "unit": "TWD",
  "basis": "recorded_flow",
  "coverage": {
    "status": "partial",
    "reason": "Recorded ledger entries only; historical completeness has not been audited."
  }
}
```

`value` is an exact decimal/count string or `null`. Metadata includes `asOf`, timezone, range boundaries, definitions, coverage and `historicalStocks`. KPI stocks always describe the current consistent database snapshot, even when the selected flow period is historical.

| KPI section | Fields / meaning |
| --- | --- |
| `users` | `total`, `periodRegistrations`: all retained app-user rows, including test accounts; no deduplication into people. Deleted rows are absent. No reliable disabled/test flags exist for exclusions. |
| `coins` | `unclaimed`: unopened, active, claimable boxes before deadline. `available`: active, unexpired lot amounts. `reserved`: reserved lot amounts. `recordedAvailable` and `pendingExpiry` explain cron lag. |
| `coins` lifecycle | `recordedNetConsumed`, `recordedExpired`: mutable lot totals, marked partial for pre-ledger history; not gross lifetime event counts. |
| `coins` financing | `platformAdvanceOutstanding`, `platformPromotionalExpense`, `sellerFundingAvailable` in coins; `platformAdvanceTwd` converts each account at its recorded rate. They are not added again to the outstanding pool. |
| `coins` pool | `outstandingPool = unclaimed + available + reserved`; `poolTwd = pool / 10`. Mismatched user balances or unclassified/missing-deadline boxes make the combined pool unavailable. Reconciliation counts are returned. |
| `advertisements` | Current `remainingBalance`, `recordedGrossViewSpend`, `settlementReturns`; separate `lifetimeRecorded` and `period` flow objects. |
| `ratio` | **Current outstanding coin pool TWD / current remaining ad balance**, decimal string with eight places. Current valuation convention is 10 coins/TWD. Incomplete pool coverage or nonpositive denominator returns null with a reason. |

Ad flow fields: `fundingInflows` (wallet funding only), `legacyDeposits` (separate unverified older deposits), `budgetWithdrawals`, `viewSpend`, `settlementReturns`, `transfersIn`, `transfersOut`. Transfers and returns are never counted as new platform funding; the wallet/ad linked withdrawal pair is counted once.

Coin flow fields: `acquiredCoins`, `cashRefundConvertedCoins`, `refundedCoins` actually credited to the user, `expiredRefundCoins` not credited due to expiry, `expiredCoins`, `manualNetCoins`, plus `advanceCreatedCoins`, `advanceRepaidCoins`, `advanceCancelledCoins`, `advanceWrittenOffCoins`. Recognized migration-opening credits are excluded from new acquisition/manual issuance. Legacy and manual balances are not attributed to ads without evidence.

Series return `dataset` and `points: [{date,metrics}]`; users have `registrations`, other datasets use the corresponding flow fields above. Queries aggregate in batches, not per user/day. Known no-registration dates return `"0"` under the retained-record definition. Financial days with no recorded source rows return null/unavailable because coverage has not been audited; values on recorded days are partial ledger subtotals, including recorded zero subtotals. Cron events use recorded timestamps, not retrospectively rewritten effective dates.

Historical stock snapshots and complete gross daily `spentCoins` remain unavailable. Reservation debits are not treated as completed spending. No earliest-row date is advertised as a verified coverage boundary. Audit the intended environment before treating financial history as complete; migration completion alone does not prove historical event coverage. Representative production-volume latency/query plans remain a deployment check.

## Validation and OpenAPI

`npm test` passed the new withdrawal/statistics suite and all existing suites: API, coin accounting, order date filters, chatroom/refund authorization, wallets, coin ledger and cron. The new suite covers authorization, partial/all withdrawal, immutable retry replay, changed-body conflicts, stale/round-trip confirmations, concurrent keys, rollback between ledger writes, late returns, transfer competition, closed-ad charges, financial-close checks, wallet/report fields, Taipei midnight, invalid ranges/mixed filters, null history, cron-lag stocks, reconciliation, the selected ratio, zero-denominator handling, opening-credit exclusion, expired refund classification, and 10,000 users across a 366-day batch.

`npm run build` passed. Generated Swagger was checked for both new withdrawal endpoints/internal components and absence of app routes. OpenAPI remains available at `/api-docs` and in the admin router JSDoc; Flutter endpoints remain excluded. No staging deployment, live-data coverage audit or generated environment-migration validation is claimed.
