# BE requirement 1001 — advertisement funding, withdrawal, and internal statistics

Date: 2026-10-01

Status: **implemented and integration-tested in `feat/be1001-implementation`; not deployed**.
The user approved implementation of sections 1 and 3 and will generate/apply database
migrations themselves, starting with local. No environment migration was generated
or applied by this implementation. Tests use newly created disposable databases.

The detailed design below records the planning decisions. The authoritative implemented
contract, limitations, and validation are in [the FE handoff](../api/FE-confirmation/BE_REQUIREMENT_1001_API_CHANGES.md).
The selected ratio is current outstanding coin pool in TWD / current remaining ad balance.
All retained app-user rows are counted; unreconstructable historical stocks remain unavailable.

Source: [BE-requirement-1001.md](../../BE-requirement-1001.md), sections 1 and 3,
plus the user's subsequent decisions. Section 2 (login inactivity/session expiry)
remains outside scope. Withdrawal concerns ad funds returned to the seller's
account wallet, not seller revenue settlement or bank payouts.

This document replaces `ADVERTISEMENT_BUDGET_WITHDRAWAL_PLAN.md` and retains its
withdrawal plan while adding the internal long-term statistics assessment.

## Existing API retirement and canonical top-up contract

The retired standalone increase/top-up API is **deposit**, not the remaining
budget operation named `increase`.

| API / operation | Current source contract |
| --- | --- |
| `PUT /api/admin/advertisement/deposit/:id` | Removed; returns `404`, with no alias or redirect. Unmatched routes need not return a JSON error body. |
| `PUT /api/admin/advertisement/budget/:id`, `operation: "increase"` | Supported; debits the product seller wallet and credits the ad atomically. |
| Same budget endpoint, `operation: "decrease"` | Retained in validation; authorized requests for an existing ad return `409 operation_not_supported`. |
| Same budget endpoint, `operation: "set"` | Removed from validation and implementation; returns `400`. |
| Separate budget-withdrawal endpoint | Implemented; only partial/full return from an archived, financially closed ad. |

Existing top-up callers must replace `/deposit/` with `/budget/` and add the
operation. The advertisement ID, amount, and idempotency key retain their meaning.

```http
PUT /api/admin/advertisement/budget/ADVERTISEMENT_UUID
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "operation": "increase",
  "amount": "200.00",
  "idempotencyKey": "fund-ad-20261001-0001",
  "metadata": {}
}
```

Only the owning seller or a platform admin may fund an ad. The product seller's
wallet supplies the money in both cases. Amounts must be positive with at most
two decimal places; prefer decimal strings. Reuse the same idempotency key for
retries of the same intended transfer, including an in-flight retry migrated
from deposit. A different key could cause a second debit.

Funding an archived/financially closed ad remains prohibited. The new withdrawal
operation will not change that rule or enable `budget/decrease`.

Swagger has been updated for retirement, and the build/API suite previously
passed checks for the removed deposit route, budget funding/retries, unsupported
`decrease`, rejected `set`, and unchanged balances on rejection. This is existing
validation evidence, not a claim that the planned features below have passed.

See the detailed [frontend funding API migration guide](../api/FE-confirmation/ADMIN_ADVERTISEMENT_DEPOSIT_RETIREMENT.md).

## Confirmed scope and changes to the original requirement

1. Withdrawal is allowed **only after the advertisement is archived and
   financially closed**.
2. The seller may withdraw a specified amount or explicitly choose the entire
   remaining balance. Partial withdrawal is allowed.
3. Funds go to the product seller's wallet, including when a platform admin
   performs the operation. The frontend label is **回收廣告費**.
4. The source advertisement remains archived and financially closed. Withdrawal
   does not reopen it, refund user purchases, or cancel issued user coins.
5. Remaining funds may be withdrawn later or transferred to the source ad's
   direct replacement through the existing balance-transfer API.
6. `budget/increase` remains the top-up operation. `budget/decrease` continues to
   return `409`; `set` remains invalid and returns `400`. The retired deposit API
   is not restored.

These decisions supersede section 1's original full-withdrawal-only restriction
and its requirement to avoid archive/financial-close UI dependencies. The FE must
provide access to those prerequisites or explain why withdrawal is unavailable.
They also supersede the earlier proposal to pause a live ad during withdrawal
and allow that same ad to be topped up and reactivated.

The following sections describe requirement 1. Requirement 3 is planned in the
internal statistics section later in this document; requirement 2 remains out of
scope.

## Lifecycle and eligibility

```text
Archive ad
  → archive grace ends and outstanding treasure-box claims are processed
  → call financial-close
  → choose partial/full withdrawal to seller wallet
     or balance-transfer to the direct replacement ad
```

Archiving is already irreversible: an archived ad cannot become active, paused,
or depleted again, even before financial-close. The default archive grace is
24 hours; the stored `archiveGraceEndsAt` determines the actual deadline.
Financial-close rejects pending treasure-box allocations in `demand` status.
Maintenance processes expired claims; it does not call financial-close itself.

The new withdrawal operation will require:

- An authenticated, active platform admin or the active owning seller. Employees
  and unrelated sellers cannot withdraw.
- An existing source ad with archived status, archive timestamp, and
  `financiallyClosedAt`.
- An existing seller wallet and a positive, valid remaining currency balance.
- A current confirmation of the balance and financial state.
- Consistent closed funding state where a funding account exists. Unexpected
  pending demands, unresolved advances, or inconsistent records block withdrawal
  with a reason rather than triggering silent corrections or partial payment.

Withdrawal does not perform archive or financial-close implicitly and introduces
no additional 24-hour wait after successful closure.

Financial-close has already handled unused funding surplus and outstanding
platform advances. Withdrawal moves only the resulting available ad currency
balance; it does not subtract coin funding pools, reward allocations, or user
coin lots again. Existing user coins continue their normal lifecycle.

Later coin-expiry/refund settlement may credit the closed ad again. Such funds
remain on that ad until a new withdrawal or transfer is requested. They are not
automatically swept into the wallet, and they do not reactivate the ad.

## Proposed API contract

The paths and fields in this section are proposed, not currently callable.

```http
GET /api/admin/advertisement/:id/budget-withdrawal-preview
POST /api/admin/advertisement/:id/budget-withdrawal
```

The preview is read-only and uses the same authorization as withdrawal. It returns
the exact ad balance, seller wallet balance, ad status, financial-close timestamp,
eligibility/blocking reasons, and an opaque `confirmationToken`. A preview does
not reserve funds; the POST must revalidate everything transactionally.

Partial withdrawal:

```json
{
  "mode": "amount",
  "amount": "300.00",
  "expectedBalance": "1000.00",
  "confirmationToken": "TOKEN_FROM_PREVIEW",
  "idempotencyKey": "ad-withdrawal-20261001-0001"
}
```

Full withdrawal:

```json
{
  "mode": "all",
  "expectedBalance": "1000.00",
  "confirmationToken": "TOKEN_FROM_PREVIEW",
  "idempotencyKey": "ad-withdrawal-20261001-0002"
}
```

- `id` is the advertisement UUID. The server derives the destination wallet.
- `mode: "amount"` requires a positive decimal-string `amount` with at most two
  decimal places, no greater than the confirmed available balance. An amount
  equal to the balance is valid.
- `mode: "all"` must omit `amount`; the server determines the whole amount under
  lock. It must not silently use a newly changed balance after confirmation.
- `expectedBalance` is a decimal string. `confirmationToken` binds the ad and its
  confirmed financial state. Both modes reject stale confirmation.
- `idempotencyKey` is required, 8–200 characters after trimming.
- Reject unknown fields and contradictory modes instead of ignoring them.

Example response for withdrawing 300 TWD from an ad with 1,000 TWD into a wallet
with 500 TWD:

```json
{
  "success": true,
  "data": {
    "advertisementId": "ADVERTISEMENT_UUID",
    "mode": "amount",
    "withdrawnAmount": "300.00",
    "advertisementBalanceBefore": "1000.00",
    "advertisementBalanceAfter": "700.00",
    "walletBalanceBefore": "500.00",
    "walletBalanceAfter": "800.00",
    "walletId": "SELLER_WALLET_UUID",
    "walletTransactionId": "WALLET_TRANSACTION_UUID",
    "advertisementTransactionId": "AD_TRANSACTION_UUID",
    "advertisementStatus": "archived",
    "financiallyClosedAt": "2026-10-01T01:00:00.000Z",
    "idempotentReplay": false
  }
}
```

All monetary fields in this contract use precise decimal strings. No withdrawal
is treated as an administrator's manual credit, seller sales revenue, viewing
expense, or coin-settlement return.

## Confirmation, atomicity, and retries

Implement authorization and one transaction covering the ad balance, seller
wallet, linked ledger entries, and an admin activity event.

1. Validate the actor and ownership; serialize the idempotency key using the
   existing advisory-lock mechanism and database uniqueness constraints.
2. Look for an already committed withdrawal. Compare the normalized request,
   including actor, source ad, mode, amount where supplied, and confirmation.
   A matching retry returns the original financial result without another debit.
   A mismatched request or key used by another operation returns `409`.
3. Only for a new operation, acquire the necessary locks and revalidate closure,
   confirmation, available funds, wallet, and accounting consistency.
4. Debit the full requested amount from the ad and credit exactly that amount to
   the seller wallet. If any condition fails, roll back everything.
5. Insert linked immutable ad/wallet transactions and retain the normalized
   request and original response fields for retries. Keep the ad archived.

Replay lookup must precede current-balance/confirmation checks: a successful
withdrawal changes the balance, but its retry must still return its original
result. Every retry must still pass current authorization.

Confirmation should detect intervening financial activity even if the balance
changes and later returns to the same number. Prefer deriving a token from
existing immutable ledger state plus balance, without adding a version column.
The implementation must establish a consistent snapshot and verify that every
relevant balance-changing path contributes to that state. A timestamp rounded to
JavaScript milliseconds, or expected balance alone, is insufficient for that
stronger guarantee.

Review shared lock ordering with balance-transfer, settlement returns,
financial-close, funding, and view completion. Coordinate all balance mutations;
locking only the new endpoint is insufficient. In particular, the current spend
helper lacks a sufficient-funds guard and ledger view completion can bypass
inactive status checks. Ensure a closed ad cannot be charged and an insufficient
balance cannot become negative. Preserve the existing pre-close archive grace
behavior.

Unlike the earlier live-ad proposal, this design does not need withdrawal-time
cancellation/reissue of assignments or pausing/reactivation logic. Closure is the
lifecycle boundary. Concurrent withdrawal versus late return or balance-transfer
must either serialize successfully or produce a clear conflict, never lose funds.

## Interaction with balance-transfer and future advertisements

Both withdrawal and balance-transfer consume the same source ad balance:

- Withdrawal credits the seller wallet.
- Balance-transfer credits the source ad's direct replacement, subject to the
  existing same-product/seller and destination-status rules.
- Neither activates an ad automatically.
- A partial withdrawal leaves the rest available for either operation.
- A full withdrawal leaves no transferable funds unless later returns arrive.
- Concurrent operations must never spend the same funds twice.

For example: closed ad A has 1,000 TWD. Withdraw 300 TWD to the wallet, then
transfer 700 TWD to replacement B. A ends at zero; the wallet gains 300 and B
gains 700. To advertise again using withdrawn funds, fund B through
`budget/increase` and activate B explicitly after meeting activation rules.

## Minimal schema changes — approved for implementation

No new tables or columns are currently proposed. Existing ledgers provide
idempotency keys, metadata, before/after balances, actor identity, and a unique
ad-transaction-to-wallet-transaction link.

The existing wallet enum and sign check cannot represent a budget return as its
own credit type. Proposed changes:

| Area | Proposed change |
| --- | --- |
| Wallet transaction enum | Add `advertisement_budget_return`. |
| Advertisement transaction enum | Add `budget_withdrawal`. |
| Wallet sign constraint | Permit a positive amount for the new return type. |
| Wallet ad/actor constraints | Require the advertisement and acting account for the new type. |

Existing rows need no backfill for these additive changes. Generate/review the
appropriate environment migrations before applying them, including PostgreSQL
enum-value availability across migration transaction boundaries.

The zero-schema alternative is to store wallet returns as `admin_credit` and ad
debits as `manual_adjustment`, distinguished by metadata. This would misclassify
the financial operation and require every reader/report/filter to reinterpret
those types. It is not recommended and does not satisfy a distinct stored
transaction type without changing the requirement.

Ad balances and transaction amounts currently use floating-point columns. Avoid
a broad numeric-column migration unless a preflight proves it necessary. Use
exact minor-unit arithmetic within a supported range, exact ledger snapshot
strings, and guarded database writes; reject unsupported precision/ranges rather
than silently rounding or losing money. Any additional schema need must first be
reported with its necessity and alternatives.

## Wallet APIs, reports, and frontend behavior

- `/account-wallet/me` and authorized account lookup reflect the credited
  `walletBalance`; existing `lockedBalance` is unchanged, so available funds
  increase by the returned amount.
- Add `advertisementBudgetReturns` to the wallet summary, respecting its date
  filters. Do not include returns in `adminCredits` or revenue totals.
- Add `advertisement_budget_return` to transaction filters and response enums;
  display it as **回收廣告費**, including related advertisement/transaction IDs.
- Add lifetime/period withdrawal totals to advertisement metrics as appropriate.
  Keep them separate from `totalSpent`, net viewing spend, seller coin returns,
  and transfers between ads.
- Show the archive/close prerequisites, partial/all choice, exact amount, wallet
  destination, and confirmation. On stale confirmation, reload and ask the user
  to confirm again; do not retry automatically with a larger amount.
- Preserve current product-offline behavior: the reviewed product code has no
  zero-ad-balance gate. Permanent deletion remains governed by its existing
  reference checks, not by this operation.
- Update admin Swagger and the frontend handoff with the implemented contract.
  Do not add Flutter routes to admin Swagger.

## Proposed errors

Preserve the existing error envelope and add explicit machine-readable `code`
values for the withdrawal endpoint.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_WITHDRAWAL_REQUEST` | Invalid mode/amount, unknown fields, malformed confirmation or key. |
| 401 | Existing authentication error | Missing or invalid authentication. |
| 403 | `WITHDRAWAL_FORBIDDEN` | Inactive/unauthorized actor, employee, or unrelated seller. |
| 404 | `ADVERTISEMENT_NOT_FOUND` | Source advertisement does not exist. |
| 409 | `ADVERTISEMENT_NOT_FINANCIALLY_CLOSED` | Source is not archived and financially closed. |
| 409 | `BALANCE_CHANGED` | Confirmation no longer matches; refresh and reconfirm. |
| 409 | `ZERO_BALANCE` | No available funds. |
| 409 | `INSUFFICIENT_AD_BALANCE` | Requested partial amount exceeds available funds. |
| 409 | `IDEMPOTENCY_CONFLICT` | Key was used for a different operation/request. |
| 409 | `WITHDRAWAL_BLOCKED` | Wallet/funding state is missing or inconsistent; return a specific reason. |

Reject blocked requests without balance changes. If a rollout gate is introduced,
document its `503` response separately; successful retries must retain their
defined behavior.

## Withdrawal implementation and acceptance plan

1. Agree the minimal schema proposal. Follow the source requirement's separate
   checkout/worktree and feature-branch workflow; preserve existing uncommitted
   changes and do not modify/push protected branches or merge the PR.
2. Add the endpoint, preview, validation, actor checks, exact money handling,
   transactional ledger entries, and persistent retry response.
3. Coordinate the shared mutation/lock paths and add closure/insufficient-funds
   guards where needed.
4. Update wallet summaries/filters, ad reporting, Swagger, and FE examples.
5. Generate/review migrations and test in a disposable database. Deploy schema
   before enabling writers that use the new enum values. Do not apply live
   migrations as part of planning.
6. Deliver the PR, changed paths, migration impact, contract, and test results.

Required tests:

- Existing top-up: 1,000 + 200 ad balance, with a matching 200 wallet debit.
- Open/unclosed ad rejected; no archive/close performed implicitly.
- Partial withdrawal: ad 1,000 → 700, wallet +300, linked entries, archived status.
- Full withdrawal and explicit amount equal to balance: ad → 0, wallet credited.
- Invalid amount, excess amount, zero balance, forbidden actor, missing wallet,
  stale confirmation, and inconsistent funding produce no financial changes.
- Same-key retry after timeout returns original IDs/amounts; changed mode,
  amount, actor, source, or confirmation with the same key is rejected.
- Two tabs, withdrawal versus transfer, settlement return, close, and attempted
  view/top-up races do not duplicate credit, lose updates, or create negatives.
- Failure between ledger writes rolls back the entire operation.
- Late settlement return can be withdrawn with new confirmation/key, without
  changing user coin lots or reopening the source ad.
- Wallet summaries/filters and ad metrics distinguish withdrawal from revenue,
  manual credits, viewing spend, coin returns, and inter-ad transfers.
- Existing product-offline flow remains compatible.
- `budget/decrease` still returns `409`, `set` returns `400`, and deposit remains
  retired. Existing pre-close ad-view/treasure-box behavior remains compatible.

No implementation or acceptance tests are claimed to have run for the proposed
withdrawal feature.

## Requirement 3 — 公司內部長期統計 API

### Feasibility and scope

Most current totals and many daily financial flows can be calculated from the
existing tables. Complete historical daily balances cannot be promised from
current mutable rows or incomplete older ledgers. The existing dashboard APIs
need extending; they do not already expose the requested company statistics.

Start with a release that requires **no new statistics tables or columns**:
current platform totals, registration growth, supported daily financial flows,
and explicitly defined ratios. Return unavailable history as unavailable, never
as zero. The separate withdrawal feature still has its own schema proposal above.

This is a repository/data-model assessment, not a new live database audit. Before
publishing coverage dates, audit and reconcile the actual target environment's
records. Development and staging have different ledger cutover histories; one
environment's date must not be reused for another.

### Metric availability and definitions

| Metric | Existing source | Proposed definition / limitation |
| --- | --- | --- |
| Current app-user count | `users` | Count retained user-account records. This is not a deduplicated count of people across OAuth providers. |
| New users and daily growth | `users.created_at` | Registrations among retained records, grouped by Taipei date. Historical deletion or test-user exclusions cannot be inferred. |
| Unclaimed reward coins | `treasure_boxes`, `treasure_box_reward_allocations` | Rewards still claimable at the observation time. Exclude passed claim deadlines even if cron has not updated status. Count the box amount or its allocations, never both; identify legacy coverage separately. |
| Acquired, available coins | `user_coin_lots.available_amount` | Reconcile recorded balances with `users.coins`. Distinguish spendable-at-observation amounts from expired-but-not-yet-processed balances. |
| Reserved coins | `user_coin_lots.reserved_amount`, `order_coin_allocations` | Separate pending-payment commitments from available and consumed coins; retain the existing reservation/expiry policy. |
| Consumed coins | Coin lots, order allocations, coin/funding transactions | Separate cumulative gross consumption from reversals/refunds and current net consumption. A mutable current total is not a daily event series. |
| Expired coins | Coin lots and expiry/reversal/return events | Distinguish acquired coins that expired from unopened rewards that lapsed. Include expiry on reservation release; summing only transactions named `expiry` is insufficient. |
| Platform advances | Funding accounts and funding transactions | Report outstanding advances separately from created, repaid, cancelled, and written-off amounts. Promotional expense is not an outstanding advance. |
| Unallocated seller coin funding | `advertisement_coin_funding_accounts` | Report separately from user rewards and available ad currency; it represents money already charged into coin funding. |
| Ad funding inflows | `advertisement_transactions` | Count `wallet_funding`; include legacy `deposit` only where its meaning and coverage are verified. Do not count both wallet debit and ad credit as two inflows. |
| Ad-budget withdrawals | Planned `budget_withdrawal` / `advertisement_budget_return` | Available after withdrawal is implemented. Count the linked pair once. Before then, report feature/coverage unavailability rather than claim a supported historical metric. |
| Remaining ad balance | `advertisement_stats.balance` | Current balance across all ads, including archived/closed ads that still hold funds. Historical closing balances need a verified baseline and complete subsequent changes. |
| Ad viewing spend | `ad_view_counts.view_charge_amount`, `view_debit` ledger entries, current stats | Count each charge once. Keep gross spend, coin-settlement returns, and net settled spend separate. Older null charge amounts are missing data, not zero spend. |
| Inter-ad transfers | Transfer records and `balance_transfer_in/out` | Internal movement; excluded from platform-wide new funding and withdrawal totals. Each ad's balance reconciliation still includes its transfers. |
| Coin/ad-fee ratios | Verified metrics above | Require explicit stock/flow scope, dates, unit conversion, and denominator policy. Unsupported inputs propagate unavailable coverage. |

Current `users` rows have no test-account, disabled, or deleted flag. Do not infer
these classifications from names or email patterns. The initial policy should
count all retained app-user records and declare that test accounts are included.
If exclusions are required, first agree an authoritative classification source;
a new field/history mechanism may then be needed. Hard-deleted historical users
cannot be reconstructed without retained audit data or external evidence.

### Coin pool and ratio semantics

Recommended outstanding reward pool:

```text
outstandingRewardCoins
  = unclaimedRewardCoins
  + acquiredAvailableCoins
  + reservedOrderCoins
```

These categories must be disjoint and measured at the same observation time.
Where cron lag matters, expose recorded balance and pending-expiry amounts so the
user-wallet reconciliation and economic eligibility remain explainable. Confirm
the final field names and boundary rules before implementation.

Do not add consumed coins, expired coins, platform advances, or unused seller
funding to this pool. Consumed/expired are separate lifecycle measures; platform
advances describe the financing of rewards already counted. Legacy and manually
credited coins need explicit source categories and must not be attributed to
advertisements without evidence.

The current accounting convention is 10 coins per TWD. Use recorded rates for
historical transactions where available. If rates differ, convert the relevant
components before summing instead of applying today's rate to all history.

The selected first-release ratio is **current outstanding reward pool in TWD / current remaining ad balance**. The original alternatives considered were:

- Current outstanding reward value in TWD divided by current remaining ad funds:
  a comparison of two stocks at the same time.
- Rewards issued in a period, valued in TWD, divided by that period's gross ad
  viewing spend: a comparison of two flows.

These answer different questions and must have different metric names. Do not
silently compare today's coin pool to spend from an arbitrary historical window.
For a zero denominator return `null` with `ZERO_DENOMINATOR`; for incomplete inputs
return `null` with `INCOMPLETE_COVERAGE`. Do not report infinity or invent a ratio.

### Historical coverage and reconstruction

1. **Backfill is an opening balance.** Legacy lots and opening wallet entries are
   not rewards earned or new ad investment on the migration day. Separate them
   from growth/issuance/funding charts.
2. **Daily flow is not closing balance.** Current lots, funding accounts, ad stats,
   and monthly totals cannot be grouped by their creation timestamps to recreate
   old day-end balances. `user_daily_stats` is reset/reused, not a daily archive.
3. **Ledger coverage must be verified by metric.** For example,
   `consumeOrderReservationsWithTx` updates reserved/consumed amounts without
   always adding a user-ledger `spend` transaction; its funding events only cover
   lots with a funding account. A reservation debit is not itself proof of a
   completed purchase.
4. **Refund/release semantics matter.** A `reversal` marked
   `creditedToUser: false` must not be counted as spendable coins restored to the
   user. Gross usage and net usage after refunds need separate calculations.
5. **Old spend may be partial.** Current `totalSpent` and known old view counts do
   not establish complete daily charges. Do not assume a fixed historical view
   price to fill missing charge fields without an agreed, evidenced policy.
6. **Earliest row is not a coverage guarantee.** Use reconciled migration
   checkpoints, write-path history, and ledger continuity to establish valid
   ranges. Return a coverage boundary per metric/environment.
7. **Recorded time and effective time differ.** Cron processing can happen after
   a deadline. Define event charts as recorded accounting events, or explicitly
   implement effective-date accounting. Do not silently backdate events.

Reconstruct historical stocks only where an authoritative opening balance plus
all intervening movements can be proven. Otherwise return unavailable values,
with the known range and reason. Never substitute today's stock for a past date.

### Dashboard API extension proposal

Prefer extending:

```http
GET /api/admin/dashboard/kpi
GET /api/admin/dashboard/time-series
```

Add an explicit opt-in internal-report mode, provisionally `report=internal`,
with a separate validated query contract. Legacy requests retain their existing
seller-scoped behavior and response shapes. Example proposed requests:

```http
GET /api/admin/dashboard/kpi?report=internal&startDate=2026-10-01&endDate=2026-10-31
GET /api/admin/dashboard/time-series?report=internal&dataset=ad-finance&startDate=2026-10-01&endDate=2026-10-31
```

These parameters/datasets are proposals, not available API features. Suggested
batched datasets are `users`, `coin-flows`, and `ad-finance`. Do not require one
frontend request per metric or per date.

- Internal mode requires an active platform admin. Explicitly reject sellers and
  employees with `403`; never append platform aggregates to their legacy KPI
  responses. Reject incompatible seller filters in internal mode.
- Use fixed `Asia/Taipei` accounting dates for internal reports. Define an
  inclusive date range as `[start-date 00:00, day-after-end-date 00:00)` in that
  timezone. Reject conflicting legacy timestamp/timezone parameters rather than
  silently selecting one interpretation.
- Start with a maximum 366-day daily-series request; allow larger histories via
  sequential bounded ranges or a separately defined coarser aggregation.
- Query and group data on the backend. Aggregate each ledger/source before joins
  to avoid multiplying amounts by related rows. Fill zero-activity dates only
  inside verified complete coverage; unknown dates remain null.
- Read related totals from one consistent snapshot. Return exact decimal strings
  for money/coins and do not route numeric aggregates through JavaScript `Number`.
  Audit float-backed legacy ad amounts separately; exact output formatting cannot
  restore precision already lost in storage.
- Return `asOf`, timezone, range boundaries, units, definitions, and coverage.
  Label current stocks as observed at `asOf`, even when the requested range ends
  in the past. A requested historical stock must be reconstructed or unavailable.

Illustrative per-metric metadata:

```json
{
  "value": null,
  "unit": "coin",
  "basis": "end_of_day_stock",
  "coverage": {
    "status": "unavailable",
    "from": null,
    "reason": "HISTORICAL_BALANCE_NOT_RECONSTRUCTABLE"
  }
}
```

Use coverage states such as `complete`, `partial`, and `unavailable`. Partial
observations must be clearly named as covered-subset totals, not presented as the
complete platform total. Distinguish `FEATURE_NOT_IMPLEMENTED`,
`PRE_LEDGER_HISTORY`, and missing baseline/transition evidence where applicable.

### Delivery stages and schema implications

**Stage 1: existing-schema statistics.** Audit the target environment, reconcile
sources, settle definitions, and implement current totals plus supported daily
flows. Include ad withdrawals once the separate withdrawal feature is present.
No statistics schema migration is initially required. Validate query plans on
representative volume; propose any necessary indexes separately with evidence.

**Stage 2: reliable historical daily stocks, if required.** Where replay is
incomplete or too expensive, propose additional immutable transition recording
and/or dated aggregate snapshots with a defined source watermark, reconciliation,
and retry/correction policy. Obtain agreement on that schema proposal first.
A snapshot taken late cannot simply use the then-current balance and label it
midnight; accurate boundary state needs complete replay or an explicit observation
policy. New snapshots establish coverage going forward and do not recover missing
past history.

Retain source financial events and documented opening baselines for the promised
reporting period. A future cleanup policy must not delete evidence needed for
historical reconstruction.

### Statistics validation and open decisions

Acceptance tests should cover:

- Fixed-fixture user counts and registration dates, with the declared inclusion
  policy and no unsupported claim to reconstruct deleted users.
- Available/reserved/consumed/refunded/expired coins and unclaimed reward deadlines,
  including cron lag, legacy openings, manual credits, and cash-refund conversions.
- Platform advance creation/repayment/write-off without double-counting the coin
  pool; cash equivalents at the recorded rate.
- Ad funding, partial/full withdrawal, late coin returns, and inter-ad transfers;
  zero net platform funding from a transfer pair.
- Current balances reconciled to authoritative source totals and historical stocks
  returned only where reconstruction is proven.
- Taipei midnight boundaries, month changes, inclusive end dates, zero-filled known
  days, unknown days, zero denominators, and partial coverage propagation.
- Platform-admin authorization and unchanged seller/employee legacy dashboards.
- Exact decimal serialization, bounded queries, representative-volume query plans,
  and no per-user/per-day N+1 aggregation.

Implementation decisions: count all retained app-user rows; use the current-stock ratio
selected above; return unavailable historical stocks and gross daily consumption.
Recorded financial-flow subtotals are explicitly partial until environment coverage
is audited. No production coverage boundary is inferred from the earliest row.
See the FE handoff for the implemented contract and completed tests.
