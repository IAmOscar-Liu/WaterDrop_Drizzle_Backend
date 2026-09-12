# Coin Ledger and Seller Return Plan

## Status

Revised on 2026-09-11 after reviewing the treasure-box, order, refund,
advertisement, and scheduled-job implementations.

Implementation is in progress on the test branch. The schema, APIs, accounting
repositories, maintenance jobs, and disposable-database test suite described
below have begun landing; deployment/backfill steps remain gated by test review.

## Confirmed Business Decisions

The following points are now treated as requirements rather than open questions.

1. `$1.00 = 10.00 coins`; one coin is worth `$0.10`.
2. Each valid completed ad view currently charges its advertisement `$1.50` and
   creates `15.00 coins` of seller-funded capacity.
3. Reward calculation remains group-based. An individual reward may exceed the
   15 coins funded by that user's view and must not be reduced or delayed.
4. A box created from two different advertisements is attributed equally. Any
   two-decimal rounding remainder goes to the second allocation.
5. The funding boundary is one advertisement. Surplus from Ad Y must not fund or
   repay a shortage belonging to Ad X, even if both ads have the same seller.
   The resulting platform expense is accepted.
6. The seller-funded pool must not become negative. The platform advances the
   exact shortage, with no business-configured maximum, and records it separately.
7. Future same-ad surplus repays the oldest outstanding platform advance before
   any remaining surplus is returned to the seller.
8. Seller returns go back to the source advertisement. The ledger and seller API
   show coins; the existing currency-denominated ad balance receives the cash
   equivalent at the snapshotted `10 coins = $1` rate.
9. A seller return does not automatically reactivate a depleted advertisement.
10. `advertisement_stats.totalSpent` remains gross view spend. Returned value and
    net settled spend are stored/exposed separately.
11. There are two separate clocks. User-facing daily state follows the user's
    timezone: treasure-box expiry, daily ad-count reset, and end-of-next-month
    acquired-coin expiry occur at that user's local midnight. System-level
    funding/accounting dates and fund resets use `Asia/Taipei`.
12. Users may own and spend fractional coins to two decimal places.
13. Coins reserved by a `payment-processing` order remain reserved until the
    bounded payment process becomes paid, failed, expired, or cancelled.
14. An expired refunded coin is never restored to the user. Its order consumption
    is reversed and the amount is immediately returned to the lot's current
    funding source.
15. Pre-deployment balances without provable provenance become
    `legacy_unattributed` platform-funded lots.
16. An advertisement cannot move to another seller/account. The current product
    update path must enforce that rule because ad ownership is indirect through
    `product.sellerId`.
17. `paused` and `depleted` advertisements remain eligible to repay their platform
    advances indefinitely. `archived` is permanent and terminal; any advance
    remaining at financial close becomes a platform promotional expense.
18. A product may have multiple historical advertisements but only one current,
    non-archived advertisement. A replacement ad may be created after the prior
    ad is archived.
19. An archived ad keeps its immutable accounting history. Its available and
    subsequently returned balance may be explicitly transferred by the seller to
    the current ad for the same product without reactivating the archived ad.
20. Archiving removes an ad from the get-ad-list response immediately. An
    assignment issued before `archivedAt` may still submit ad completion until
    `archivedAt + 24 hours`; an assignment issued at or after `archivedAt` is
    invalid.
21. The 24-hour archive grace never extends a treasure box. A box involving that
    ad may be opened only before the earlier of its normal user-local-midnight
    expiry and the applicable archived-ad grace deadline. If either deadline has
    passed, the box cannot be opened.
22. Preserve the current bounded payment-processing policy: the expiration job
    resolves qualifying orders after two days. The present implementation
    measures this from `order.createdAt`; changing it to two days from entry into
    `payment-processing` would be a separate behavior change.
23. Do not reserve `$1.50` when get-ad-list issues an assignment. Retain the
    existing minimum ad-balance eligibility buffer and charge only at successful
    completion. A valid pre-archive assignment remains completable during its
    grace window.
24. Configure the historical-ledger cutoff independently per runtime environment
    through `COIN_LEDGER_CUTOVER_AT` in `.env.local`, `.env.development`,
    `.env.stg`, and `.env.production` as applicable.
25. Treat a missing or invalid user timezone as `Asia/Taipei`. Snapshot the
    effective timezone onto every newly created reward cycle, box, and coin lot;
    a later profile change affects only newly created assets.
26. Reuse one advertisement assignment per user, advertisement, and user-local
    date. Repeated get-ad-list requests do not replace it. `/video-complete`
    accepts only an `issued` assignment whose snapshotted local date is still
    current. Maintenance marks leftovers `expired` after local midnight,
    retains completed assignments for a configurable audit period, and purges
    expired/cancelled assignments on a separately configurable shorter period.

The design therefore has two related levels:

```text
Advertisement funding account
  - lives across Taipei accounting cohorts
  - carries outstanding platform advance forward
  - never shares funding with another advertisement

Taipei accounting cohort
  - records funding events under an Asia/Taipei business date
  - is sealed for new events at 00:00 Asia/Taipei
  - does not replace or extend any user's local deadline
  - financially settles only after its linked user obligations resolve
  - repays prior platform advances before returning remaining surplus
```

## Goal and Final Reconciliation

The seller's gross advertisement spending should ultimately match the value of
seller-funded coins that users consume, with all unacquired and unused value
returned to the seller.

Illustrative example:

```text
Seller gross ad spend:                         $1,000
Seller-funded capacity:                     10,000 coins

Coins acquired by users:                     8,000 coins = $800
Unacquired seller return:                     2,000 coins = $200

Coins consumed before expiry:                 5,000 coins = $500
Acquired but unused seller return:            3,000 coins = $300

Total returned to seller:                     5,000 coins = $500
Seller's final net cost:                                      $500
Final user-consumed seller-funded value:                      $500
```

The `$1,000` figure is an aggregate illustration. With an exact `$1.50` charge
per completed view, event-level spending will normally be a multiple of `$1.50`.

When the advertisement finishes with no remaining platform advance:

```text
seller-funded coins
  = net consumed seller-funded coins
  + unacquired seller returns
  + expired-unused seller returns
```

If an advertisement finishes with an unrepaid platform advance:

```text
total user-consumed value
  = seller-funded net value
  + final platform-funded expense
```

The unrepaid portion must never be hidden inside a negative advertisement pool.

## Terminology

- **Seller funding**: coin capacity created by completed ad-view charges.
- **Reward attribution**: the advertisement/seller to which a portion of a box
  reward belongs.
- **Reserved demand**: an attributed box reward that has not yet been opened. It
  is not yet an actual platform advance.
- **Acquired**: coins credited when the user opens the box.
- **Platform advance**: the acquired amount not covered by currently available
  funding from the attributed advertisement.
- **Advance repayment**: later same-ad funding replacing platform-funded value.
- **Consumed**: acquired coins successfully used by a paid order, net of
  reversals and refunds.
- **Unacquired surplus return**: seller capacity remaining after expired
  user-local reward opportunities and advance repayment are reconciled.
- **Expired-unused return**: an acquired lot's unused seller-funded amount
  returned at the end of the next month.

## Funding Rules

### Advertisement boundary

Every reward allocation is attributed to exactly one advertisement and its
seller snapshot. Each advertisement has an independent funding account.

```text
Ad X funding and surplus
  -> can fund Ad X rewards
  -> can repay Ad X platform advances
  -> cannot fund Ad Y

Ad Y funding and surplus
  -> can fund Ad Y rewards
  -> can repay Ad Y platform advances
  -> cannot fund Ad X
```

This preserves per-advertisement reconciliation.

### Individual rewards are not capped

Suppose one completed view adds 15 coins, but a group owner earns 20 coins:

```text
Available Ad X seller funding:   15 coins
Reward acquired immediately:     20 coins
Seller-funded portion:           15 coins
Platform advance:                 5 coins
```

Do not reduce the reward to 15, delay the user, or make the seller pool negative.

### Future surplus repays the platform first

Continuing the example, another Ad X view later adds 15 coins:

```text
New Ad X seller funding:          15 coins
Repay platform advance:           5 coins
Remaining Ad X surplus:          10 coins
Return to seller:                10 coins
Outstanding platform advance:     0 coins
```

The repayment must be represented by immutable ledger entries. It should
reclassify the oldest outstanding platform-funded allocations for the same
advertisement as seller-funded, rather than editing or deleting history.

### Rolling settlement formula

Reconcile an advertisement whenever a user-local obligation becomes terminal,
and produce a control snapshot at each Taipei accounting close:

```text
netRequirement
  = openingPlatformAdvance
  + acquiredRewardAttributedToAd
  - newSellerFunding
  - platformAdvanceCancelledByUnusedExpiry
```

If `netRequirement > 0`:

```text
closingPlatformAdvance = netRequirement
sellerReturn = 0
```

If `netRequirement <= 0`:

```text
closingPlatformAdvance = 0
sellerReturn = abs(netRequirement)
```

Implementation may calculate advance creation and repayment as separate events,
but the result must match this net position.

Example with full repayment:

```text
Opening platform advance:         5 coins
Today's acquired rewards:        30 coins
Today's seller funding:          45 coins

5 + 30 - 45 = -10

Closing platform advance:         0 coins
Seller return:                   10 coins
```

Example with partial repayment:

```text
Opening platform advance:         5 coins
Today's acquired rewards:        18 coins
Today's seller funding:          20 coins

5 + 18 - 20 = 3

Closing platform advance:         3 coins
Seller return:                    0 coins
```

### What counts as unacquired surplus

When the relevant user-local claim deadline passes, seller funding not needed
for acquired rewards includes:

- a positive box that was not opened;
- a zero-value box;
- a single/unmatched qualifying view that never formed a box;
- calculated reward demand that never became an acquired user balance;
- any other seller capacity never assigned to an acquired reward.

This surplus first repays the same advertisement's prior platform advance. Only
the remainder is returned to the seller.

Example:

```text
Today's seller funding:                  60 coins
Today's acquired rewards:                35 coins
Unopened-box reward demand:              15 coins
Unallocated capacity:                    10 coins
Opening platform advance:                 0 coins

Seller return at cutoff:                 25 coins
```

The unopened demand does not become a user balance or platform advance.

### Seller return and advertisement balance

Seller returns retain both coin and currency values:

```text
returnedCoinAmount = 20.00 coins
coinToCurrencyRate = 10.000000 coins per $1
currencyCredit = 20.00 / 10.000000 = $2.00
```

The seller-facing API displays the 20-coin return, while the existing source
advertisement balance receives `$2.00`. A return never changes a depleted ad to
`active`; reactivation remains an explicit seller/admin action subject to the
normal balance rule.

Keep gross and net figures distinct:

```text
grossViewSpend = sum(completed-view debits)
returnedAmount = sum(seller-return credits)
netSettledSpend = grossViewSpend - returnedAmount
```

Do not reduce or rewrite historical gross `totalSpent` rows.

### Advertisement lifecycle, archive grace, and replacement ads

A product may have many historical advertisements but at most one current,
non-archived advertisement. `archived` is terminal.

```text
Product P
  Ad A: archived
  Ad B: archived
  Ad C: current (paused/depleted/active)
```

`paused` and `depleted` accounts retain their platform advances indefinitely.
Future funding for that same advertisement repays them before seller return.

Archiving has two effects that must not be confused:

```text
archivedAt
  -> exclude from every new get-ad-list response immediately
  -> keep only assignments issued before archivedAt eligible

archiveGraceEndsAt = archivedAt + 24 hours
  -> reject incomplete pre-archive assignments after this instant
  -> reject box opens after this instant even if their local expiry is later

effectiveBoxDeadline
  = min(userLocalMidnightDeadline, all applicable archiveGraceEndsAt values)
```

The public advertisement is terminally `archived` at `archivedAt`, while its
funding account remains internally `closing` until the grace window and every
earlier box deadline have resolved. At financial close, write any remaining
advance to a platform promotional-expense ledger. Do not transfer that advance
to the replacement advertisement.

An archived advertisement can still receive seller-funded expiry/refund returns
after closure. It remains archived. The seller may explicitly transfer any
available balance from the archived ad to the current ad for the same product,
but not while its archive grace and unresolved chargeable assignments could
still change the available balance.
Record `balance_transfer_out` on the old ad and `balance_transfer_in` on the new
ad. A transfer creates future advertising budget; it does not rewrite either ad's
historical reward accounting or repay the archived ad's written-off advance.

## Business Lifecycle

### 1. Advertisement assignment and archive grace

The get-ad-list API must issue a persistent, user-bound assignment (or a signed
token backed by a persistent assignment) instead of trusting a raw
`advertisementId` supplied at completion.

The assignment is proof of grace eligibility, not a `$1.50` balance reservation.
The existing minimum-balance rule controls list eligibility, and the actual debit
still occurs only at successful completion.

At archive time:

1. Set terminal `archivedAt` and remove the ad from new list results immediately.
2. Set `archiveGraceEndsAt = archivedAt + 24 hours`.
3. Allow completion only when the assignment belongs to the user, was issued
   before `archivedAt`, has not already completed, and the current time is no
   later than `archiveGraceEndsAt`.
4. Shorten each already-created box involving this ad to
   `min(existing deadline, archiveGraceEndsAt)`; never extend it.
5. Expire an incomplete assignment at the earlier of its user-local midnight or
   the archive grace deadline. Completion always enforces both deadlines even
   before cleanup has updated the row.

The user's ad count and reward cycle are assigned to the user's local calendar
day at completion. Archive grace does not prevent the normal user-local daily
reset.

### 2. Completed advertisement view

In one database transaction:

1. Validate and deduplicate the completion event.
2. Require a valid `advertisementId` for a qualifying view.
3. Lock the advertisement/stat/funding rows.
4. Deduct exactly `$1.50` from the advertisement balance.
5. Insert an immutable advertisement `view_debit` transaction.
6. Add exactly `15.00 coins` to that advertisement's daily funding cohort.
7. Insert a `view_funded` coin-funding entry.
8. Attach the view to the user's current two-view reward cycle.

The seller is charged when the ad is successfully viewed, not when the box opens.
The current optional `advertisementId` path must be closed because it can advance
the reward counter without creating seller funding.

### 3. Treasure-box creation

After two qualifying views:

1. Calculate the group-based box reward without capping it to current funding.
2. Snapshot the user's timezone and create the box with an exact UTC claim
   deadline for that user's next local midnight.
3. Attribute the box reward between the two advertisements.
4. Record attributed reward demand for funding reconciliation. This is not an
   advertisement-currency balance reservation.
5. If either source ad is archived, shorten the claim deadline to the earliest
   applicable `archiveGraceEndsAt`. Never extend the local-midnight deadline.

Because the two views can have different advertisements or sellers, a single
`sourceSellerId` on `treasure_boxes` is insufficient. Use child allocation rows.

Split a box equally between its two qualifying advertisements. Give any
two-decimal rounding remainder to the second allocation so the children equal the
box total exactly.

Example:

```text
Box reward:                40.00 coins
Ad X attribution:          20.00 coins
Ad Y attribution:          20.00 coins
```

### 4. Treasure-box acquisition

When the user opens a positive box before its deadline:

1. Lock the box and allocation rows.
2. Atomically transition `claimable -> acquired`.
3. Use currently available seller funding for each attributed advertisement.
4. Create a platform advance for any remaining shortage.
5. Credit the complete calculated reward immediately.
6. Create source-tracked user coin lots and immutable credit entries.

The response must not wait for later views. Repeated or concurrent open requests
must return the existing result without crediting twice.

### 5. User-deadline settlement and Taipei accounting close

As each exact user-local box deadline becomes due:

1. Close positive boxes that were not opened as `unacquired`.
2. Close zero-value boxes as `zero_reward`.
3. Close unmatched reward cycles.
4. Release all unacquired demand/reservations.
5. Reconcile the advertisement's rolling net requirement.
6. Repay the advertisement's oldest platform advances first.
7. Reclassify corresponding funding portions/lots as seller-funded.
8. Convert only the remaining surplus to currency and credit the source
   advertisement balance without reactivating it.
9. Record the result against the related Taipei accounting cohort.

At 00:00 `Asia/Taipei`, seal the prior system accounting date and open the next
one. Sealing a cohort is not permission to expire a user's box, reset the user's
ad count, or return funding reserved for a still-valid user obligation. A cohort
becomes financially settled only after all linked assignments, cycles, and boxes
are terminal.

The original view debit remains in the audit trail. A seller return is a separate
compensating transaction.

### 6. Coin reservation and spending

When an order enters `payment-processing`:

1. Lock eligible user lots.
2. Reserve earliest-expiring lots first, then oldest-created lots.
3. Create an order-to-lot allocation for every reserved portion.
4. Reduce spendable balance without classifying the value as consumed.
5. Keep the reservation across its normal lot expiry while payment is unresolved.

When the order becomes `paid`, convert the exact reservations to consumed value.
When it becomes `failed`, `expired`, or `cancelled`, release the exact
reservations. The bounded processing timeout prevents reservations from remaining
open forever.

This preserves advertisement, seller, and current-funder provenance. Monthly
coin aggregates may remain as derived reports but are not the accounting source
of truth.

### 7. Payment failure and order refund

Payment failure or cancellation must reverse the exact order-to-lot allocations,
not only add value back to a monthly total.

For partial refunds before the source lot expiry:

- reverse coin usage proportionally to the refunded quantity/value;
- use deterministic decimal rounding;
- put the final remainder into the final/full refund so cumulative reversals
  equal the original allocation exactly;
- restore unexpired coins to their original lots;
- add compensating ledger rows instead of mutating history.

For a refund after the source lot expiry:

1. Reverse the exact order-to-lot consumption.
2. Do not credit the expired amount to the user.
3. If the lot is currently seller-funded, convert the coins to currency and
   credit the source advertisement balance.
4. If the lot is currently platform-funded, cancel the corresponding platform
   advance or reverse promotional expense.
5. Record a `refund_after_expiry` funding/return transaction linked to the refund,
   order allocation, lot, advertisement, and seller snapshot.

For example, if 20 seller-funded coins were acquired, 8 spent, 12 returned at
normal expiry, and the 8-coin order usage is later fully refunded, the refund
returns the final 8 coins to the source advertisement. The user receives zero and
the final reconciliation is `20 funded = 20 returned + 0 consumed`.

### 8. End-of-next-month expiry

Acquired-coin expiry follows the user's snapshotted timezone. For example, coins
acquired during the user's local September expire at the start of local November
(the end of local October). Store `timezoneSnapshot`, local earning month, and an
exact UTC `expiresAt`; a later profile-timezone change must not move the deadline.

At the stored expiry timestamp:

1. Lock the lot and verify it is active.
2. Calculate the exact available amount.
3. Debit that amount from the user.
4. Mark the lot expired.
5. Insert a user `expiry_debit` entry.
6. Return the seller-funded portion to the source seller.
7. Cancel the platform-funded portion against the source advertisement's
   outstanding platform advance.
8. Insert the corresponding seller/platform funding entries.

If later same-ad funding already repaid and reclassified a platform-funded
portion, that portion is seller-funded at expiry and returns to the seller.

Example:

```text
Original lot:                     20 coins
Consumed before expiry:            8 coins
Unused at expiry:                 12 coins

If all 12 are seller-funded:
  seller return:                  12 coins ($1.20)

If 9 are seller-funded and 3 remain platform-funded:
  seller return:                   9 coins ($0.90)
  platform advance cancellation:   3 coins ($0.30)
```

## Proposed Data Model

Use fixed-precision `numeric`, never `double precision`, for new accounting
fields:

```text
coin amounts:      numeric(18, 2)
currency amounts:  numeric(18, 2)
conversion rate:   numeric(18, 6)
```

Use decimal strings or a decimal library at accounting boundaries.

### A. Advertisement/product lifecycle changes

Change `advertisements` so one product can retain historical ads:

```text
remove unconditional unique(advertisements.productId)
add advertisements.archivedAt
add advertisements.archiveGraceEndsAt
add advertisements.financiallyClosedAt
add advertisements.replacementOfAdvertisementId -- nullable self-reference
add unique(productId) where archivedAt is null
```

Because `advertisement_stats.status` is in a separate table, its value cannot be
used directly by a PostgreSQL partial unique index on `advertisements`. Keep the
terminal `archivedAt` marker on `advertisements` itself and update it atomically
with status.

Block changes to `product.sellerId` once the product has an advertisement or
financial history. Seller snapshots remain on every ledger row as a secondary
audit safeguard.

Extend `advertisement_stats` with fixed-precision controls:

```text
totalSpent                       -- retained as gross completed-view spend
sellerReturnedCurrencyAmount
netSettledSpentAmount            -- derived or cached control
returnedCoinAmount               -- seller-visible coin total
```

Do not automatically change `depleted -> active` when applying a seller return.

### B. `advertisement_coin_funding_accounts`

One rolling account per advertisement and immutable seller-ownership period.

```text
id
advertisementId
sourceSellerId
coinToCurrencyRate                 -- coins per $1, currently 10.000000
platformAdvanceOutstandingAmount
platformFundedConsumedAmount
platformPromotionalExpenseAmount
status                             -- active/closing/closed/exception
openedAt
closedAt
createdAt
updatedAt
```

Constraints:

- unique account for `advertisementId`;
- all amounts non-negative;
- index outstanding advances for reconciliation;
- advertisement/seller ownership is immutable;
- archived financial close moves the remaining outstanding advance to
  `platformPromotionalExpenseAmount` and zeroes the outstanding control.

### C. `advertisement_coin_settlement_cohorts`

One row per advertisement and business settlement date.

```text
id
fundingAccountId
businessDate
claimSettlementAt
openingPlatformAdvanceAmount
sellerFundedAmount
acquiredRewardAmount
advanceCreatedAmount
advanceRepaidAmount
advanceCancelledAtExpiryAmount
sellerSurplusReturnedAmount
closingPlatformAdvanceAmount
status                             -- open/settling/settled/exception
settledAt
createdAt
updatedAt
```

Constraints:

- unique `(fundingAccountId, businessDate)`;
- non-negative amounts;
- index `(status, claimSettlementAt)` for the settlement job;
- `businessDate` always means an `Asia/Taipei` accounting date;
- `claimSettlementAt` is no earlier than the latest exact user/archive deadline
  of the obligations linked to the cohort;
- opening balance must equal the preceding cohort's closing balance, adjusted by
  separately recorded expiry cancellation events.

### D. `advertisement_coin_funding_transactions`

Immutable source-of-truth ledger for funding-account movements.

```text
id
fundingAccountId
settlementCohortId                 -- nullable for later expiry/refund events
type
coinAmount                         -- positive absolute amount
currencyEquivalent
coinToCurrencyRate
adViewCountId                      -- nullable
treasureBoxRewardAllocationId      -- nullable
userCoinLotId                      -- nullable
sellerReturnTransactionId          -- nullable
idempotencyKey
metadata jsonb
createdAt
```

Types:

```text
view_funded
reward_acquired_seller_funded
platform_advance_created
platform_advance_repaid
funding_source_reclassified
platform_advance_cancelled_expiry
platform_advance_written_off_archive
coin_consumed
coin_consumption_reversed
seller_surplus_returned
seller_unused_returned
seller_refund_after_expiry_returned
manual_adjustment
```

Use an explicit transaction type/direction convention. Never infer accounting
meaning from a positive or negative sign alone.

### E. Extend `advertisement_transactions`

The current enum contains only `deposit`, even though views reduce balances.

Add types:

```text
deposit
view_debit
seller_return_credit
balance_transfer_out
balance_transfer_in
manual_adjustment
```

Every completed view debit should contain:

```text
advertisementId
sourceSellerId
adViewCountId
amount = 1.50
coinAmount = 15.00
balanceBefore
balanceAfter
idempotencyKey
createdAt
```

Do not mix the advertisement currency ledger with user coin activity.

For seller-return credits and balance transfers, record both coin amount and
currency amount. `seller_return_credit` must not reactivate a depleted ad.

### F. `advertisement_assignments`

Persists proof that an ad was sent to a user before it was archived.

```text
id
userId
advertisementId
sourceSellerId
assignmentBatchId
userLocalDate
timezoneSnapshot
assignmentTokenHash
status                             -- issued/completed/expired/cancelled
assignedAt
completedAt
completionIdempotencyKey
createdAt
updatedAt
```

The unique key is `(userId, advertisementId, userLocalDate)`, so requesting the
list again on the same local date reuses the original row instead of replacing
its issue time. At completion, the server uses the submitted advertisement ID
only to locate this user-bound persisted assignment; the raw ID is not proof by
itself. Validate the assignment's snapshotted local date, single-use status,
`assignedAt < advertisements.archivedAt`, and
`completedAt <= advertisements.archiveGraceEndsAt` for an archived ad. An
expired completion fails without changing daily counters or financial records.

The maintenance job marks leftover `issued` rows `expired` on its first run
after their snapshotted local midnight. Defaults are 365 days for completed
audit rows and seven days for expired/cancelled rows, configurable through
`ADVERTISEMENT_ASSIGNMENT_COMPLETED_RETENTION_DAYS` and
`ADVERTISEMENT_ASSIGNMENT_EXPIRED_RETENTION_DAYS`. Purging a completed
assignment clears the optional `ad_view_counts.assignmentId` reference but
retains the immutable ad-view and financial ledgers.

### G. `treasure_box_reward_cycles`

Groups the two qualifying views that create one box.

```text
id
userId
status                             -- collecting/completed/expired/cancelled
requiredViewCount                  -- snapshot, currently 2
completedViewCount
accountingBusinessDate             -- Asia/Taipei date of the funding event
userLocalDate
timezoneSnapshot
claimDeadlineAt
treasureBoxId                      -- nullable until completed
createdAt
completedAt
```

Extend `ad_view_counts` with:

```text
assignmentId
rewardCycleId
fundingAccountId
settlementCohortId
advertisementTransactionId
viewChargeAmount                   -- 1.50 snapshot
fundedCoinAmount                   -- 15.00 snapshot
coinToCurrencyRate                 -- 10.000000 snapshot
completionIdempotencyKey
```

### H. Extend `treasure_boxes`

```text
rewardCycleId
status                             -- claimable/acquired/unacquired/zero_reward
timezoneSnapshot
userLocalDate
localClaimDeadlineAt
archiveGraceDeadlineAt             -- nullable; earliest across source ads
claimDeadlineAt                    -- min of the preceding deadlines
acquiredAt
settledAt
rewardRuleVersion
rewardInputSnapshot jsonb
```

For a positive box:

```text
treasureBox.coinsAwarded
  = sum(treasure_box_reward_allocations.attributedCoinAmount)
```

### I. `treasure_box_reward_allocations`

Maps a box reward to its intended advertisement and seller.

```text
id
treasureBoxId
fundingAccountId
settlementCohortId
advertisementId
sourceSellerId
attributedCoinAmount
acquiredCoinAmount
sellerFundedCoinAmount
platformAdvancedCoinAmount
platformRepaidCoinAmount
status                             -- demand/acquired/unacquired
createdAt
acquiredAt
settledAt
```

The current platform-funded remainder is:

```text
platformAdvancedCoinAmount - platformRepaidCoinAmount
```

Do not update the historical advanced amount when repayment occurs; add repayment
and reclassification ledger entries.

### J. `user_coin_lots`

Create lots from acquired allocation funding portions. Splitting seller-funded
and platform-funded portions into separate lots is recommended because it makes
spending, expiry, repayment, and reconciliation deterministic.

```text
id
userId
rewardAllocationId
fundingAccountId
advertisementId
sourceSellerId                    -- intended seller even for platform advance
currentFunderType                 -- seller/platform
originalAmount
availableAmount
consumedAmount
expiredAmount
timezoneSnapshot
earningLocalMonth
expiresAt
status                            -- active/consumed/expired
createdAt
updatedAt
```

When later funding repays an advance, reclassify the oldest outstanding
platform-funded portions for that same advertisement. Record the old and new
funding source in the immutable funding ledger.

### K. `user_coin_transactions`

Immutable user-facing ledger:

```text
id
userId
lotId
type                              -- acquire/spend/reversal/refund/expiry/manual
direction                         -- credit/debit
amount
orderId                           -- nullable
refundId                          -- nullable
idempotencyKey
metadata jsonb
createdAt
```

### L. `order_coin_allocations`

Maps order usage to exact source lots:

```text
id
orderId
lotId
allocatedAmount
reservedAmount
consumedAmount
reversedAmount
netConsumedAmount
createdAt
updatedAt
```

Invariant:

```text
order coin discount = sum(order_coin_allocations.netConsumedAmount)
```

### M. `seller_coin_return_transactions`

Immutable seller-return ledger:

```text
id
sourceSellerId
advertisementId
fundingAccountId
settlementCohortId                -- nullable for later expiry
rewardAllocationId                -- nullable for daily unallocated surplus
userCoinLotId                     -- nullable for unacquired return
reason                            -- unacquired_surplus/expired_unused/
                                  -- refund_after_expiry/manual
coinAmount
coinToCurrencyRate
currencyEquivalent
destinationType
destinationReferenceId
idempotencyKey
metadata jsonb
createdAt
```

The destination is the source advertisement balance. Store `coinAmount` for the
seller-facing display and credit `currencyEquivalent` to the ad balance. If the
ad is archived, the balance remains transferable but the ad remains terminal.

### N. `advertisement_balance_transfers`

Immutable transfer record for reusing an archived ad's balance in the current ad
for the same product:

```text
id
sourceAdvertisementId           -- must be archived
destinationAdvertisementId      -- must be current and same product/seller
sourceSellerId
coinAmount
coinToCurrencyRate
currencyAmount
sourceBalanceBefore
sourceBalanceAfter
destinationBalanceBefore
destinationBalanceAfter
idempotencyKey
createdAt
```

Apply both balance changes and the transfer record atomically. Do not allow a
transfer between products, sellers, or funding accounts.

## Atomicity, Idempotency, and Concurrency

Required transaction boundaries:

- A completed view must atomically write the view, `$1.50` debit, 15-coin funding
  entry, cohort update, and reward-cycle update.
- Opening a box must atomically claim it, split seller/platform funding, create
  lots, write ledgers, and credit the user.
- Entering `payment-processing` must atomically lock lots, reserve them, create
  order allocations, and update spendable balance. Becoming `paid` converts the
  reservations to consumption; failure releases them.
- Settlement must lock the funding account and cohort, close claimable objects,
  repay advances, reclassify funding, and post seller returns exactly once.
- Expiry must atomically debit the user and route each unused portion to its
  current funder.
- An expired-coin refund must atomically reverse consumption and return the value
  to the current funder without crediting the user.
- Archiving must atomically set `archivedAt`, stop new list assignments, and set
  the 24-hour grace deadline. Financial close later expires remaining
  assignments, waits for all effective box deadlines, and writes off any
  remaining platform advance exactly once.
- An archived-balance transfer must lock both ads in deterministic ID order,
  update both balances, and write both sides of the transfer exactly once.

Recommended idempotency keys:

```text
ad-view-funding:<completion-id>
box-acquired:<box-id>
platform-advance:<allocation-id>
platform-repayment:<funding-event-id>:<advanced-allocation-id>
accounting-close:<advertisement-id>:<business-date>
lot-spend:<order-id>:<lot-id>
lot-expiry:<lot-id>
seller-return:<reason>:<source-row-id>
refund-source-return:<refund-id>:<order-allocation-id>
ad-balance-transfer:<source-ad-id>:<destination-ad-id>:<request-id>
```

Use row locks or conditional state updates so concurrent requests and jobs cannot
double-credit, double-spend, double-repay, or double-return.

## Rounding Rules

Normal ad funding is exact:

```text
$1.50 * 10 = 15.00 coins
```

For equal box splits, lot allocation, fractional spending, and partial refunds:

1. Store money and coins to two decimal places.
2. Store the conversion snapshot to at least six decimal places.
3. Use decimal arithmetic rather than JavaScript binary floating point.
4. Round only at ledger/allocation boundaries.
5. Use one documented mode, recommended round-half-up unless finance specifies
   otherwise.
6. Assign any division remainder to the final child allocation so its children
   always sum exactly to the parent.

Do not round `7.5 coins` to an integer. The existing group reward can produce
fractional values.

## Accounting Invariants

Verify these with database constraints where possible and reconciliation jobs:

```text
box awarded
  = sum(box advertisement attributions)

acquired attribution
  = seller-funded portion + current platform-funded portion

platform advance outstanding for an advertisement
  = advances created
  - advances repaid
  - advances cancelled by unused expiry
  - advances written off at campaign close

lot original
  = lot available + lot reserved + lot net consumed + lot expired/returned

paid-order coin discount
  = sum(order allocation net consumed)

payment-processing coin discount
  = sum(order allocation reserved)

accounting-cohort net requirement
  = opening advance + acquired reward - new seller funding
  after applicable expiry cancellations

seller-funded coins, after final settlement
  = seller-funded net consumed
  + unacquired seller returns
  + expired-unused seller returns
  + refund-after-expiry seller returns

advertisement net settled spend
  = gross view spend - seller-return currency credits

archived balance transfer
  preserves source balance + destination balance
```

Never silently repair a discrepancy. Produce an exception report requiring an
auditable adjustment.

## Current Implementation Contradictions and Limitations

These are implementation gaps, not unresolved product rules.

### Advertisement and product

- `advertisements.productId` is unconditionally unique, so archiving currently
  does not permit a replacement ad. Replace it with the partial-current-ad
  constraint described above.
- Advertisement ownership is inherited from `product.sellerId`, but the admin
  product-update API currently permits changing `sellerId`. Reject the change
  once advertisement/history exists.
- `advertisement_stats.balance` and `totalSpent` are `double precision`; use
  fixed-precision amounts for new financial behavior.
- Completed-view spending changes balance/`totalSpent` but inserts no debit
  transaction. Every debit must be logged.
- The spend method accepts `depleted` ads and does not enforce
  `balance >= charge`, so the existing currency balance can become negative after
  an assigned ad is completed late. The current get-ad-list response is not a
  balance reservation and cannot bound the number of concurrent late `$1.50`
  charges. The decision is to retain the list-time minimum-balance buffer without
  assignment-time currency reservation. This is an accepted operational risk,
  not a guarantee that concurrency can never make the balance negative; add
  monitoring/reconciliation for the exception while always honoring a valid
  grace-window completion.
- Existing deposits can reactivate a depleted ad. Seller-return credits and
  archived-balance transfers need separate methods that never reactivate the
  source ad automatically.
- The current status API can reactivate `archived`; enforce terminal transitions.
- There is no archived-balance transfer API or double-entry transfer record.

### Treasure box

- `/video-complete` now requires an `advertisementId` and resolves it against a
  persisted, user-bound, current-local-date assignment. Assignment completion
  and the resulting ad view use unique idempotency keys.
- Neither `ad_view_counts` nor `treasure_boxes` identifies which two views formed
  the box, so an equal split cannot be reconstructed reliably.
- Reward value uses group-wide prior-day view count, while source attribution is
  to the two current ads. Random ad distribution can therefore leave some ads
  with persistent advances while unrelated ads return surplus. This consequence
  is explicitly accepted, but must be reported.
- A box has only `isOpened`/`isActive`; there is no claim deadline or terminal
  settlement reason.
- Opening reads the box without a row lock and updates it without an
  `isOpened = false` guard, so concurrent opens can double-credit.
- The daily stat is one mutable row per user with no business-date key; resetting
  destroys the counters needed for historical reconciliation.

### Order

- Coin spending is tracked only by month in `order.coinInfo`; seller,
  advertisement, lot, and current-funder provenance are absent.
- `orders.discountCoin` is an integer even though rewards and the selected spend
  policy allow two-decimal fractional coins.
- The paid and payment-processing paths duplicate monthly spending logic; replace
  them with one lot-reservation/consumption service.
- `updateOrderStatus` reads the order without a row lock, so concurrent status
  callbacks can duplicate inventory and coin effects.
- The authenticated public order create/status routes lack matching Zod request
  validation.
- Current failure restoration returns all month-based coins to the user even if
  their month expires while payment is processing. The new reservation model
  deliberately holds those lots until the bounded payment result.
- The current two-day processing timeout is measured from `order.createdAt`, not
  from entry into `payment-processing`. Add `paymentProcessingAt` if the chosen
  bound is intended to start with payment processing.

### Refund

- The current API correctly excludes expired source-month coins from the user
  balance, but then reduces historical `coinsSpent` without sending that value to
  any funding source.
- `order.coinInfo` contains months only, so historical refunds cannot identify a
  seller/ad. Exact routing applies only to new lot-backed orders; old data remains
  `legacy_unattributed`.
- Each partial refund independently multiplies and rounds month totals, which can
  drift across multiple partial refunds. Allocate against remaining exact
  order-to-lot amounts and reconcile the final remainder.
- `returnableCoins` currently means only coins restored to the user. Extend the
  response/summary with returned-to-source totals split between seller and
  platform.
- Refund completion already locks the refund, order item, and order in one
  transaction; retain that useful foundation while adding lot locks and funding
  entries.

### Scheduled jobs and timezone

- The current daily and monthly jobs do correctly select users whose configured
  IANA timezone is at local midnight. Preserve this user-local behavior for box,
  ad-count, and acquired-coin expiry.
- Both jobs poll every 30 minutes. A row may remain marked active until almost
  00:30 local time. The box-open and coin-spend write paths must enforce their
  stored exact UTC deadline themselves; cron is cleanup/settlement, not the
  authority that grants an extra 30-minute grace.
- Daily reset currently sets every active box to inactive and resets ad counters,
  but stores neither a timezone snapshot nor an exact deadline/expiration reason.
  Store both so a profile-timezone change cannot move existing deadlines.
- `users.timezone` is nullable and is not validated as an IANA timezone. A user
  with a missing/invalid value is not selected by the local-midnight queries, so
  the current reset/expiry jobs may never process that user. Normalize such rows
  to the confirmed `Asia/Taipei` fallback and use the same effective-timezone
  helper in creation, API checks, and scheduled-job selection.
- Monthly expiration derives the month using the selected timezone and marks
  aggregates expired, which is consistent with local-month policy, but new lots
  need their own snapshotted `expiresAt` and source-specific return transaction.
- System accounting needs separate jobs explicitly configured with
  `{ timezone: "Asia/Taipei" }`. A Taipei midnight fund reset must rotate/seal
  the accounting cohort; it must not zero outstanding advances, erase reserved
  demand, or expire user assets.
- Every application instance starts all cron jobs. There is no distributed lock,
  so multiple replicas can settle the same rows concurrently.
- The daily reset deactivates boxes and overwrites counters without writing
  settlement/return records. Settlement must complete before the next day's
  mutable counters are initialized.
- The current daily reset can run a second time from another instance after the
  first has cleared totals, overwriting yesterday's group count with zero.
- Monthly expiration first marks aggregate rows expired and later updates user
  balances outside one transaction. A crash can leave an unrecoverable partial
  result because the retry no longer selects those rows.
- New jobs require database idempotency plus an advisory lock or unique job-run
  row and `FOR UPDATE SKIP LOCKED` batching.

### Main code touchpoints

```text
src/db/schema.ts
src/repository/advertisement.ts
src/repository/treasureBox.ts
src/repository/user.ts
src/repository/order.ts
src/repository/refund.ts
corresponding controllers, services, routers, and Zod middleware
src/lib/scheduler.ts
src/index.ts
```

Update Swagger for changed advertisement, treasure-box, order, refund, transfer,
and seller-reporting responses. Keep monthly statistics temporarily as derived
compatibility data, never as the ledger source of truth.

## Migration and Rollout

### Historical data

Existing balances and boxes do not reliably identify their source seller or
advertisement. Do not invent attribution.

Confirmed migration rule:

- start exact seller attribution at the environment-specific
  `COIN_LEDGER_CUTOVER_AT` instant;
- put pre-deployment coins into `legacy_unattributed` platform-funded lots;
- capture opening control totals;
- reconstruct only records with a provable view-to-advertisement chain.

Set `COIN_LEDGER_CUTOVER_AT` independently in the applicable environment file:

```text
.env.local
.env.development
.env.stg
.env.production
```

Use an unambiguous UTC ISO-8601 value such as `2026-10-01T00:00:00.000Z` and
validate it at application startup. Once an environment has written ledger data,
changing its cutoff requires an explicit audited migration rather than an
ordinary configuration edit.

### Rollout phases

1. **Observe:** calculate per-ad daily funding, reward demand, and simulated
   platform advance to measure expected exposure without changing rewards.
2. **Advertisement lifecycle:** allow historical ads, enforce one current ad per
   product, make archive terminal, prevent seller ownership changes, and add
   audited balance transfers.
3. **Funding ledger:** require/deduplicate ad identity and log every `$1.50` debit
   and 15-coin funding event.
4. **Acquisition ledger:** add reward cycles, equal per-ad attribution, immediate
   seller/platform funding, user lots, and user ledger entries.
5. **Consumption:** reserve fractional source lots during payment processing and
   record exact paid-order consumption, failure release, and refunds.
6. **Settlement:** add user-local exact-deadline settlement and expiry returns,
   plus separate fixed-Taipei accounting-cohort rotation and control reporting.
7. **Refund integration:** move partial refunds to exact lot allocations and
   route expired refunded value immediately to its current funding source.

Before generating migrations, verify `drizzle.config.ts`; it currently targets a
hardcoded environment. Generate into the intended Drizzle folder and do not
hand-edit generated snapshots.

## Minimum Test Matrix

### Funding and acquisition

- archiving removes the ad from new list responses immediately;
- a pre-archive assignment can complete through exactly `archivedAt + 24 hours`;
- an assignment issued at/after archive or completed after grace is rejected;
- an expired assignment changes no user counters, box state, ad balance, or
  funding ledger;
- issuing an assignment does not debit or reserve advertisement currency;
- one completed view deducts `$1.50` and funds exactly 15 coins;
- retrying a completion creates no duplicate view, debit, or funding;
- missing/invalid ad identity cannot advance the reward cycle;
- a 20-coin reward with only 15 seller-funded coins credits 20 immediately;
- the seller pool remains zero and a five-coin platform advance is recorded;
- two different advertisements never cross-fund each other;
- two views from different sellers split the box equally into separate
  attributions;
- an odd two-decimal reward assigns its rounding remainder to the second ad;
- concurrent box opening credits exactly once;
- a box whose local-midnight deadline precedes the archive grace cannot be opened
  after local midnight;
- a box whose archive-grace deadline precedes local midnight cannot be opened
  after the grace deadline;
- fractional rewards such as 7.5 coins remain exact.

### User-deadline settlement and Taipei accounting

- unopened and zero-value boxes create no user lots;
- unmatched views are included in daily reconciliation;
- same-ad future surplus repays the oldest platform advance first;
- surplus does not cross to another advertisement;
- a 15-coin future surplus repays a five-coin advance and returns 10 to seller;
- partial surplus reduces but does not over-repay the outstanding advance;
- seller return is zero while an advance remains outstanding;
- a seller return credits the source ad's currency balance, exposes its coin
  amount, and does not reactivate a depleted ad;
- rerunning settlement creates no duplicate repayment or seller return;
- the Taipei accounting close seals its cohort without expiring a still-valid
  user-local box or clearing outstanding funding controls;
- changing a user's profile timezone does not move an existing box or coin-lot
  deadline;
- a missing or invalid timezone produces an `Asia/Taipei` snapshot and deadline;
- APIs reject box opening and coin spending at the exact stored deadline even if
  the 30-minute cleanup job has not run yet.

### Spending, expiry, and refunds

- earliest-expiry-first spending is deterministic;
- an order spanning multiple sources creates exact lot allocations;
- payment processing reserves rather than consumes the exact lots;
- reservations remain held across their normal expiry until the bounded payment
  result;
- paid converts reservations to consumption exactly once;
- failed/expired/cancelled payment releases the same lots exactly once;
- fully consumed lots return zero at expiry;
- seller-funded unused value returns only to the seller;
- platform-funded unused value cancels platform exposure, not seller funds;
- reclassified platform-to-seller value returns to seller if later unused;
- repeated expiry cannot double-debit or double-return;
- partial refunds reconcile to the original allocation after the final refund;
- expired refunded seller-funded value credits the source ad and not the user;
- expired refunded platform-funded value reverses platform exposure/expense and
  not seller value;
- expiry racing with refund cannot duplicate value.

### Configuration and migration

- each environment rejects a missing or invalid `COIN_LEDGER_CUTOVER_AT` when
  exact attribution is enabled;
- events immediately before and at the cutoff are classified on opposite sides
  without a timezone-dependent comparison;
- pre-cutoff balances remain `legacy_unattributed` and post-cutoff events require
  exact provenance.

### Advertisement lifecycle

- the current ad prevents creating a second current ad for the same product;
- archiving is terminal and permits creating one replacement ad;
- paused/depleted ads remain eligible for same-ad advance repayment;
- archive financial close writes off any remaining advance exactly once;
- archived ads can receive later expiry/refund returns without reactivation;
- seller can transfer archived available balance to the same product's current
  ad, with exact double-entry records;
- cross-product, cross-seller, and duplicate transfers are rejected;
- an advertised product's seller cannot be changed.

### End-to-end reconciliation

- 10,000 seller-funded coins with 8,000 acquired returns 2,000 unacquired;
- if only 5,000 of the acquired amount is consumed, another 3,000 returns at
  expiry;
- final seller return is 5,000 coins / `$500` and net seller cost is `$500`;
- a carried platform advance reaches zero when later same-ad surplus covers it;
- every box, cohort, funding account, lot, order, and return satisfies its
  invariant.

## Remaining Inputs Before Implementation

No business-policy decisions remain from the current list. Deployment must set a
valid `COIN_LEDGER_CUTOVER_AT` value in each environment before enabling exact
attribution there.

```text
event created before COIN_LEDGER_CUTOVER_AT
  -> legacy_unattributed/platform-funded

event created at/after COIN_LEDGER_CUTOVER_AT
  -> exact advertisement/seller attribution required
```

### Accepted consequences, not open decisions

- Equal split plus per-ad isolation can create platform expense even when other
  advertisements have surplus.
- Platform advances have no business limit. Monitoring and alerts are still
  required, but they must not cap, delay, or reduce an earned reward.
- Archived advertisements can receive future expiry/refund returns but never
  reactivate. Their available balance can be explicitly transferred to the same
  product's current ad.
- Historical data without provable source attribution is borne by the platform.
- User assets expire by exact snapshotted user-local deadlines; Taipei accounting
  close never extends or shortens those deadlines.
- Missing/invalid user timezones resolve to `Asia/Taipei`; later corrections do
  not retroactively move existing deadlines.
- Assignment issue does not reserve ad currency. The minimum-balance filter is
  retained, along with the documented concurrent late-completion risk.

## Definition of Done

The implementation is complete when:

- every completed view has one `$1.50` debit and one 15-coin funding entry;
- rewards are never capped or delayed because of funding availability;
- seller-funded coin pools never become negative; the separately documented
  advertisement-currency late-completion risk remains accepted;
- every shortage creates an explicit platform advance;
- later same-ad surplus repays advances before seller return;
- advertisements never cross-fund one another;
- two-ad boxes split equally with deterministic remainder handling;
- seller returns credit the source ad balance without automatic reactivation;
- gross spend, returned value, and net settled spend remain separately visible;
- user box/ad-count/monthly-coin deadlines use snapshotted user-local boundaries,
  while system accounting cohorts use `Asia/Taipei` boundaries;
- archive excludes an ad from new assignments immediately, yet honors valid
  pre-archive completions and box opens only through their effective deadlines;
- missing/invalid user timezones consistently use the `Asia/Taipei` fallback;
- every environment uses its validated `COIN_LEDGER_CUTOVER_AT` boundary;
- fractional coins remain exact through acquisition, reservation, spending,
  refund, expiry, and return;
- payment-processing reserves coins until its bounded terminal result;
- expired refund coins go to their current funder and never back to the user;
- archived ads are terminal, allow one replacement ad for the product, and can
  transfer available balance to that replacement with an immutable double entry;
- advertised products cannot change seller ownership;
- every acquired coin is traceable through advertisement attribution, current
  funder, user lot, order use, expiry, and return;
- unacquired surplus and expired-unused value reach the correct destination;
- partial refunds and reversals preserve exact source provenance;
- all write paths and jobs are atomic, retry-safe, and concurrency-safe;
- Swagger and validation match the final behavior;
- TypeScript builds and reconciliation tests pass.
