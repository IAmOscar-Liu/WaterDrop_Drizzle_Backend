# Coin Ledger Migration and Full-Test Environment Plan

## Status and Scope

Prepared on 2026-09-12 for branch `feat/coin-log-test`.

This document turns `../plans/COIN_LEDGER_SELLER_RETURN_PLAN.md` into a staged database,
application, backfill, testing, and environment-rollout procedure. It is a plan
with live progress tracking. Completed changes are listed below; no
`local`/`development`/`stg` database has been changed from this branch.

## Progress on `feat/coin-log-test`

- [x] Confirm branch ancestry from `development`.
- [x] Add and protect `.env.test`.
- [x] Create dedicated PostgreSQL 17.6 database `waterdrop_coin_test`.
- [x] Make Drizzle select `test` explicitly and refuse a non-`*_test` database.
- [x] Generate/apply the clean pre-ledger test baseline.
- [x] Generate/apply the additive coin-ledger schema expansion in test.
- [x] Verify all 13 new ledger/control tables and four applied test migrations.
- [x] Implement feature-gated API/repository writes and accounting jobs.
- [ ] Build and run historical backfill.
- [x] Add core decimal/timezone and PostgreSQL integration tests.
- [x] Add an HTTP-level harness and critical coin/ad/treasure-box API coverage.
- [x] Add virtual-order, signed mock-ECPay, multi-month `coinInfo`, and refund
  restoration HTTP coverage.
- [x] Add coin-ledger maintenance cron coverage without ECPay polling.
- [x] Run every database-backed suite in a newly created database and drop it
  after success, failure, or interruption.
- [ ] Add concurrency, backfill, and broader regression test coverage.
- [ ] Apply contract constraints after backfill/reconciliation tests.
- [ ] Rehearse and promote to `local`, `development`, then `stg`.

### Implemented in the disposable test environment

- `/api/advertisement/list` persists issued assignments when the ledger flag is
  enabled.
- `/api/treasureBox/video-complete` requires `advertisementId`, validates the
  assignment and archive grace, and writes reward-cycle progress atomically. A
  current completion debits `$1.50` and funds 15 coins; an expired completion
  records zero for both and uses platform funding for any box portion.
- `/api/treasureBox/open/:treasureBoxId` enforces the exact deadline, splits
  seller/platform funding, creates two-decimal source lots, and credits the
  user atomically.
- Order status changes reserve FIFO lots for `payment-processing`, consume the
  same reservations on payment, and release or expire them on terminal failure.
- Refund completion reverses exact order-lot allocations. Non-expired coins go
  back to their lot/user; expired amounts go to their current seller/platform
  funding source.
- A 10-minute idempotent maintenance task expires unclaimed boxes and local-time
  coin lots, settles Taipei cohorts, returns seller surplus, and cancels or
  reverses platform funding.
- Admin APIs expose the coin ledger, financially close archived ads, and
  explicitly transfer an archived balance to its direct replacement without
  auto-activation.
- Products may receive a new advertisement only after the previous ad is
  archived and financially closed.
- `discountCoin` now supports fractional values; generated migration
  `0003_special_human_torch.sql` also removes the old one-ad-per-product unique
  constraint needed for replacement ads.

Current automated verification:

```text
npm run build
npm test
DRIZZLE_ENV=test npx drizzle-kit check
```

These checks pass against `waterdrop_coin_test`. No `local`, `development`, or
`stg` database has been migrated.

### Work still required before `local`

- Build the idempotent historical `legacy_unattributed` backfill and checkpoint
  runner.
- Build reconciliation reports and require zero differences.
- Expand HTTP coverage beyond the critical auth, advertisement, assignment,
  box, ledger, archive, replacement, and transfer flows now covered.
- Add multi-connection concurrency tests for completion, box opening, payment,
  refund, and jobs.
- Audit each target's divergent Drizzle history and rehearse its exact upgrade
  from a disposable copy.
- Apply contract constraints only after backfill and reconciliation pass.

The implementation includes:

- exact advertisement/seller provenance for newly acquired coins;
- immutable advertisement, funding, user-coin, order-allocation, and
  seller-return ledgers;
- platform advances and same-ad repayment;
- user-local box and acquired-coin expiration;
- Taipei system-accounting cohorts;
- unacquired and expired-unused returns;
- exact partial-refund reversals;
- archived-ad grace, replacement, financial close, and balance transfer;
- historical `legacy_unattributed` handling;
- a disposable PostgreSQL test environment and complete automated test suite.

The business rules remain defined in `../plans/COIN_LEDGER_SELLER_RETURN_PLAN.md`. If the
two documents ever disagree, resolve the disagreement before generating a
migration.

## Confirmed Inputs

1. The app will always send `advertisementId` to
   `POST /api/treasureBox/video-complete`.
2. The backend must nevertheless validate it as a required UUID and must verify
   that the authenticated user received that advertisement before accepting a
   completion.
3. Each environment uses a bounded write-stopped migration window. Its completed
   backfill checkpoint and subsequent ledger enablement define the transition.
4. Missing or invalid user timezone means `Asia/Taipei`.
5. Test migration and behavior must pass before changing `local`,
   `development`, or `stg`.
6. Production is outside this rollout and requires a separate approval after
   staging validation.

## Current Repository Findings

### Video completion contract (resolved in the test implementation)

The previous backend treated `advertisementId` as optional in:

```text
src/controller/treasureBox.ts
src/services/treasureBox.ts
src/repository/treasureBox.ts
```

It is now required at every layer, validated as a UUID with Zod, and documented
in Swagger.

### Issued-ad assignment (resolved for new ledger traffic)

`GET /api/advertisement/list` now records which ads were returned to each user
when the ledger feature is enabled. `/video-complete` requires an issued row and
atomically consumes it.

Assignment issuance is idempotent for `(user, advertisement, user-local date)`:
additional list requests reuse the original row. Completion considers only the
assignment's snapshotted current local date. Maintenance expires leftovers
after that local midnight, keeps completed rows for an audit window, and purges
terminal rows after configurable retention.

No `$1.50` currency reservation is created when an assignment is issued. That
confirmed behavior remains unchanged.

### Environment and migration configuration (resolved for `test`)

Before this branch, `drizzle.config.ts`:

- hardcodes `stg`;
- does not support `test`;
- selects environment-specific migration folders;
- prints the full `DATABASE_URL`, which may expose credentials.

The existing generated histories are also different:

```text
drizzle_local: 106 migrations
drizzle_dev:    60 migrations
drizzle_stg:     6 migrations
```

The test selection/URL guard/logging problems are fixed. Different target
migration counts do not by themselves prove live-schema drift, but they prevent
us from assuming that one newly generated migration is safe everywhere. Do not
generate or run coin-ledger migrations until the live schema and Drizzle journal
for every target environment have been audited.

### Automated test suite (disposable runner and core coverage added)

`npm test` now builds the TypeScript project, creates a uniquely named database
on the `.env.test` PostgreSQL server, applies all `drizzle_test` migrations,
runs unit, real HTTP, and repository integration suites, and drops the database
in `finally`. The
persistent `waterdrop_coin_test` database is not modified. Critical HTTP
coverage now includes auth, request validation, advertisement setup, issued
assignments, video completion, reward/opening behavior, ledger authorization,
archive grace, financial close, replacement, and idempotent balance transfer.
It also covers a virtual order paid by a signed mock ECPay callback,
multi-month order coin provenance, refund restoration, and the maintenance
job's treasure-box/coin-lot expiration, seller return, Taipei cohort settlement,
and idempotency behavior without contacting ECPay.
Concurrency, backfill, and broader whole-application regression coverage remain
required before promotion.

## Test Database Decision

### Use a real PostgreSQL database

A `.sql` file is not a database. It can store schema, seed data, or a sanitized
backup, but it cannot execute and validate:

- transactions and rollbacks;
- `FOR UPDATE` locking;
- concurrent requests;
- unique/check/foreign-key constraints;
- advisory locks and `SKIP LOCKED` jobs;
- numeric behavior;
- migration journals;
- scheduler queries.

Use a disposable PostgreSQL database for the test environment.

### A second PostgreSQL instance is normally unnecessary

The recommended local arrangement is one separate database in the existing
local PostgreSQL instance:

```text
PostgreSQL server
  existing local database
  waterdrop_coin_test       <- disposable and test-only
```

A separate instance is only necessary if:

- no local PostgreSQL server is available;
- the existing server's PostgreSQL major version differs from the deployed
  version and version-specific behavior must be tested;
- CI needs an isolated server;
- stronger protection from accidental cross-database operations is desired.

SQL files may be used as reproducible inputs:

```text
test baseline schema dump
sanitized migration-rehearsal dump
deterministic fixture/seed SQL
expected reconciliation query SQL
```

They must never be treated as a substitute for running the tests in PostgreSQL.

## Phase 0: Freeze and Audit Before Editing Schema

### 0.1 Capture the starting point

- Record the branch commit.
- Require a clean or understood worktree.
- Record the installed PostgreSQL version and extensions for each target.
- Record table row counts and control totals relevant to ads, coins, orders,
  refunds, and active boxes.
- Back up each database before any eventual migration.

Control totals should include at least:

```text
sum(users.coins)
sum(non-expired monthly coinsEarned - coinsSpent)
count(active treasure boxes)
sum(advertisement_stats.balance)
sum(advertisement_stats.totalSpent)
orders by status and sum(discountCoin)
payment-processing orders with coinInfo
refundable paid orders with coinInfo
refunds by status and summed coin fields
```

Never print credentials, tokens, or unsanitized customer data into logs or
committed artifacts.

### 0.2 Audit schema and migration history per environment

For `local`, `development`, and `stg`:

1. Read the database's Drizzle migration journal.
2. Produce a schema-only dump or isolated introspection result.
3. Compare live tables, enums, columns, indexes, constraints, and types with
   `src/db/schema.ts`.
4. Compare each environment's latest Drizzle snapshot with its live schema.
5. Classify differences as intentional drift, missing migration, or stale
   generated history.
6. Resolve drift or define an explicit baseline before generating the feature
   migrations.

Do not copy a migration or snapshot from one environment folder to another just
because its SQL appears similar.

### 0.3 Freeze constants and time rules

Centralize and test these values before ledger work:

```text
COINS_PER_CURRENCY_UNIT = 10.000000
AD_VIEW_CHARGE = 1.50
AD_VIEW_FUNDED_COINS = 15.00
ARCHIVE_GRACE_HOURS = 24
FALLBACK_TIMEZONE = Asia/Taipei
SYSTEM_ACCOUNTING_TIMEZONE = Asia/Taipei
```

Use database time for persistent deadlines. Stop all application writers during
the migration window so clock differences between replicas cannot blur the
transition boundary.

## Phase 1: Add the Disposable `test` Environment

Complete this phase while `src/db/schema.ts` still represents the pre-ledger
baseline.

### 1.1 Refactor environment selection

Update `drizzle.config.ts` to:

- accept a validated `DRIZZLE_ENV` or `NODE_ENV` rather than a hardcoded value;
- allow only `local`, `development`, `test`, `stg`, and `production`;
- map `test` to `.env.test` and `drizzle_test/`;
- fail when the environment or `DATABASE_URL` is missing;
- stop logging the full database URL;
- print only the selected environment and migration directory.

Keep `src/lib/env.ts` compatible with `NODE_ENV=test`.

### 1.2 Add test-only configuration

Create an uncommitted `.env.test` containing test-only credentials and safe
defaults. Commit only a secret-free example/template if the repository uses one.

Required test variables:

```text
NODE_ENV=test
DATABASE_URL=<test-only PostgreSQL URL>
NO_CRON=true
COIN_LEDGER_ENABLED=false
```

Add explicit test values or mocks for email, push notification, payment,
logistics, and object-storage integrations. Tests must not contact real users,
sellers, ECPay, FCM, SendGrid, or cloud storage.

### 1.3 Add destructive-operation guards

Every create/reset/drop test command must:

1. require `NODE_ENV=test`;
2. parse `DATABASE_URL`;
3. require an approved database-name suffix such as `_test`;
4. reject known local/development/staging/production database names and hosts;
5. display the resolved test database name without displaying credentials;
6. fail closed if any check is uncertain.

### 1.4 Add test lifecycle commands

Plan package scripts for:

```text
test:db:create       create the disposable database if absent
test:db:drop         drop only the validated test database
test:db:reset        drop/create/migrate/seed
test:db:migrate      run test-folder migrations
test:db:seed         load deterministic fixtures
test:unit            pure unit tests, no database
test:integration     repository/API/job tests against PostgreSQL
test:migration       baseline -> expand -> backfill -> contract rehearsal
test:all             build + unit + integration + migration + reconciliation
```

The default test process should start with `NO_CRON=true`. Scheduler behavior is
tested by directly invoking extracted job functions with controlled timestamps,
not by waiting for wall-clock cron expressions.

### 1.5 Establish the clean test baseline

Because `drizzle_test/` does not exist, create its baseline from the unchanged
pre-ledger `src/db/schema.ts`, then verify that it builds an empty test database
from scratch.

This clean baseline validates new installations. It does not replace the later
upgrade rehearsal against clones of each target environment.

## Phase 2: Expansion Schema Migration

Use an expand/backfill/switch/contract sequence. The first migration is additive
and compatible with the current application.

### 2.1 Advertisement lifecycle

- Add `archivedAt`, `archiveGraceEndsAt`, `financiallyClosedAt`, and nullable
  `replacementOfAdvertisementId`.
- Remove the unconditional product unique constraint only when the replacement
  partial unique index is ready.
- Enforce one non-archived/current ad per product.
- Add immutable seller snapshots to accounting records.
- Add fixed-precision returned/net control fields to advertisement stats.
- Extend advertisement transaction types for view debit, seller return, and
  balance transfer.

All archive and replacement changes must preserve the current ad until the new
constraints are successfully installed.

### 2.2 Assignment, reward-cycle, and treasure-box provenance

Create/add:

```text
advertisement_assignments
treasure_box_reward_cycles
treasure_box_reward_allocations
ad_view_counts.assignmentId
ad_view_counts.rewardCycleId
ad_view_counts funding/transaction references
treasure_boxes status and rewardCycleId
treasure_boxes timezoneSnapshot and userLocalDate
treasure_boxes localClaimDeadlineAt
treasure_boxes archiveGraceDeadlineAt
treasure_boxes effective claimDeadlineAt
```

New references that cannot be populated for historical rows remain nullable in
the expansion migration.

### 2.3 Funding and seller-return accounting

Create:

```text
advertisement_coin_funding_accounts
advertisement_coin_settlement_cohorts
advertisement_coin_funding_transactions
seller_coin_return_transactions
advertisement_balance_transfers
```

Use `numeric(18,2)` for money/coin amounts and `numeric(18,6)` for conversion
rates. Add non-negative checks, idempotency unique constraints, and indexes for
open cohorts/outstanding advances.

### 2.4 User coin and order provenance

Create:

```text
user_coin_lots
user_coin_transactions
order_coin_allocations
```

Add timezone snapshot, earning local month, exact UTC expiry, funder type,
available/reserved/consumed/expired controls, and immutable source references.

Keep `users.coins`, `user_monthly_coin_stats`, `orders.coinInfo`, and existing
refund summary fields during the transition. They remain compatibility controls
until ledger reads have been proven.

### 2.5 Job and backfill controls

Add tables or unique controls for:

```text
job run/idempotency keys
backfill run and checkpoint
reconciliation exceptions
cutover environment/value audit
```

Jobs must be retryable and safe across multiple application replicas.

### 2.6 Review generated SQL before running it

Check that the expansion migration:

- does not drop populated columns or tables;
- does not make unfilled historical references `NOT NULL`;
- does not convert `double precision` values in place without an explicit
  rounding/reconciliation policy;
- creates foreign keys in a safe order;
- does not cascade-delete immutable financial history;
- uses concurrent/index-lock strategy appropriate to database size;
- can run with the old application still serving traffic.

## Phase 3: Implement Compatible Application Writes

Deployable code must support the expanded schema while legacy compatibility
fields remain present.

### 3.1 Shared accounting services

Build small transaction-oriented services for:

- decimal conversion and deterministic rounding;
- effective timezone and exact deadline calculation;
- assignment validation;
- funding allocation and platform advance;
- user-lot reservation/consumption/reversal;
- expiry routing;
- seller-return credit;
- immutable idempotent ledger insertion;
- reconciliation assertions.

Do not duplicate allocation rules across order, refund, and scheduler
repositories.

### 3.2 Advertisement list and completion API

`GET /api/advertisement/list`:

- continue filtering by active status and existing minimum balance;
- exclude an archived ad immediately;
- persist a user/ad assignment for returned ads;
- reuse the same user/ad/user-local-date assignment across repeated list calls;
- do not reserve or debit `$1.50` at assignment time;
- make assignment issuance idempotent for the same response/retry as needed.

`POST /api/treasureBox/video-complete`:

- add Zod body validation requiring `advertisementId` as a UUID;
- make the controller, service, and repository type non-optional;
- find the authenticated user's valid assignment internally;
- require the assignment's snapshotted local date to still be current;
- accept a pre-archive assignment only through `archiveGraceEndsAt`;
- reject unassigned, wrong-user, duplicated, post-archive, or late completion;
- atomically write the view, `$1.50` debit, 15-coin funding entry, assignment
  completion, and reward-cycle progress;
- expose documented validation/conflict responses in Swagger.

The app does not need to send seller ID, funding source, or ledger IDs.

### 3.3 Treasure-box creation and open

- Link the exact two view events to the cycle and box.
- Split attribution equally, with deterministic two-decimal remainder handling.
- Snapshot the effective user timezone, using `Asia/Taipei` for null/invalid
  values.
- Store the normal local-midnight deadline and the effective archive-capped
  deadline.
- Lock/conditionally update the box on open so concurrent requests credit once.
- Credit the complete reward immediately, splitting seller/platform funding
  without reducing or delaying the user reward.
- Dual-write existing user/monthly controls during the compatibility period.

### 3.4 Advertisement archive and replacement

- Archive must become terminal and remove the ad from new list results in the
  same transaction.
- Pre-archive assignments remain completable for at most 24 hours.
- Existing box deadlines are shortened, never extended.
- Allow one replacement/current ad for the same product.
- Prevent product seller ownership changes once ad/financial history exists.
- Delay old-ad balance transfer until the archive grace and chargeable work have
  settled.
- Keep expired/refund returns postable to the archived ad without reactivation.

### 3.5 Order reservation and payment results

- Allow two-decimal fractional coin spending.
- Allocate earliest-expiring lots first.
- Reserve exact lots at `payment-processing`.
- Convert reservations to consumption at `paid`.
- On `failed`, `expired`, or `canceled`, release or immediately expire each lot
  according to its stored deadline.
- Preserve the current two-day bounded payment-processing policy unless a
  separately approved change introduces `paymentProcessingAt`.
- Continue producing compatibility `coinInfo` while ledger reads are being
  validated.

### 3.6 Refunds

- Link each refund to exact remaining order allocations.
- Reverse partial refunds proportionally with deterministic final-remainder
  reconciliation.
- Restore unexpired portions to the user's original lots and balance.
- Never restore expired portions to the user.
- Route expired seller-funded portions to their source ad.
- Cancel/reverse expired platform-funded exposure.
- Add seller/platform returned totals to API summaries without changing the
  meaning of the existing user `returnableCoins` field silently.

### 3.7 Scheduler separation

Refactor cron wrappers from executable job functions.

User-local jobs:

- reset ad count and boxes at the user's local midnight;
- expire acquired coins at the user's local end-of-next-month boundary;
- use stored UTC deadlines as authority;
- treat invalid/null timezone as `Asia/Taipei` only when creating new deadlines.

System jobs:

- run accounting-cohort rotation explicitly in `Asia/Taipei`;
- repay same-ad platform advances before seller surplus return;
- financially close archived ads only after grace obligations resolve;
- never clear unresolved advances or user obligations as a “fund reset.”

Every API write must enforce the exact deadline even if the 30-minute cleanup
cron has not run.

### 3.8 Feature and migration controls

Use explicit controls such as:

```text
COIN_LEDGER_ENABLED
ADVERTISEMENT_ASSIGNMENT_COMPLETED_RETENTION_DAYS
ADVERTISEMENT_ASSIGNMENT_EXPIRED_RETENTION_DAYS
```

During the write-stopped migration window, old balances are migrated as
`legacy_unattributed`. After the completed checkpoint is reconciled and the
ledger is enabled, every new qualifying event must have exact provenance or fail
atomically.

## Phase 4: Historical Backfill

The backfill must be idempotent, resumable, batched, and safe to rerun. It must
have a dry-run/report mode and checkpoint progress without relying on console
output.

### 4.1 Create the legacy source

Create a clearly identified platform-funded `legacy_unattributed` source for
pre-migration value. Do not infer a seller or advertisement when the exact source
cannot be proved.

### 4.2 Normalize effective timezones

- Detect null and invalid `users.timezone` values.
- Apply the confirmed `Asia/Taipei` effective fallback.
- Snapshot it onto created historical lots/active boxes.
- Produce a count/report of fallback users.
- Do not move deadlines later if an existing reliable deadline is available.

### 4.3 Initialize advertisement lifecycle/account controls

- Create one funding account for every existing ad.
- Preserve cash balance and gross `totalSpent` as opening controls.
- Start advance/return totals at zero unless a value is provably created by the
  new ledger.
- Mark existing archived ads with migration metadata rather than inventing an
  exact historical archive event.
- Do not convert old `totalSpent` into seller-funded coin events.

### 4.4 Backfill current user balances

For each user:

1. Calculate unexpired month balances from monthly stats.
2. Compare their total with `users.coins`.
3. Create platform-funded legacy lots that preserve the user's spendable balance
   and the most reliable existing expiry months.
4. Put any unexplained difference in an explicit legacy adjustment lot/exception
   rather than assigning it to a seller.
5. Assert that lot available totals exactly equal `users.coins` at the backfill
   snapshot.

Never silently change the user's displayed balance to make old aggregates fit.

### 4.5 Finalize in-flight orders and preserve historical refunds

- finalize every stale `payment-processing` order through the legacy workflow
  before balance backfill, restoring its reserved coins and inventory normally;
- block backfill if any `payment-processing` order remains;
- do not invent consumed allocations for historical paid orders;
- when a paid historical order has `coinInfo` but no ledger allocations, use the
  legacy refund calculation; any still-valid returned coins become new
  platform-funded `legacy_unattributed` lots;
- never attribute historical order value to a real ad/seller without a provable
  chain.

### 4.6 Backfill active treasure boxes

Historical boxes do not contain their exact two advertisements. For boxes still
claimable during migration:

- preserve reward amount and effective user-local expiry;
- mark reward provenance as `legacy_unattributed` platform-funded;
- create the minimum synthetic cycle/allocation required for idempotent opening
  or expiry;
- never reconstruct seller attribution from unrelated aggregate view rows.

Inactive/opened historical boxes may remain legacy audit records unless they are
needed to satisfy an in-flight order/refund invariant.

### 4.7 Reconcile before enabling writes

Required zero-difference controls:

```text
users.coins
  = sum(active legacy/new lot available amounts)

payment-processing discountCoin
  = sum(reserved order allocations)

paid refundable historical discountCoin
  = sum(legacy consumed allocations)

new ledger entries before enablement
  = only explicit migration/opening entries
```

Any unexplained discrepancy blocks enablement. Do not “fix” it with a real seller
source.

## Phase 5: Contract and Constraint Migration

Run this only after backfill, dual-write comparison, and full tests pass.

- Make required post-enablement provenance fields `NOT NULL` where historical
  exceptions are represented explicitly.
- Validate foreign keys/check constraints that were initially added without full
  validation if that technique was needed for lock control.
- Enforce idempotency unique constraints.
- Enforce one current advertisement per product.
- Enforce immutable seller/source ownership through APIs and database controls
  where practical.
- Keep compatibility columns until at least staging has completed an observation
  period and rollback no longer depends on them.
- Do not drop `coinInfo`, monthly stats, or old refund fields in the same release
  that first enables the new ledger.

A later cleanup migration may remove obsolete fields only after explicit
approval and archived reconciliation evidence.

## Full Test Plan in the Disposable Environment

### Test architecture

Add a real automated test runner and HTTP test harness. Tests should support:

- transaction-isolated unit/integration cases where practical;
- deterministic fixture factories;
- controlled database time inputs for boundary tests;
- mocked external integrations;
- direct execution of job functions;
- multiple database connections for concurrency tests.

### Unit tests

Test pure rules without PostgreSQL:

- `$1 = 10 coins` conversion;
- exact `$1.50 -> 15.00 coins` funding;
- equal two-ad split and final-child remainder;
- fractional coin allocation;
- earliest-expiry ordering;
- partial-refund cumulative remainder;
- user timezone fallback;
- DST/local-midnight conversion;
- end-of-next-month expiry;
- archive effective deadline;
- same-ad advance repayment ordering.

### Schema and repository integration tests

- all migrations apply from the clean test baseline;
- all expected indexes/FKs/checks/unique constraints exist;
- exact numeric values round as designed;
- ledger rows cannot be duplicated by idempotency key;
- one current ad per product is enforced;
- seller ownership cannot move after financial history;
- row locks prevent double box credit, double spend, double refund, and double
  seller return;
- concurrent job workers do not settle the same row twice.

### API tests

Advertisement list/completion:

- list persists assignment but does not reserve/debit currency;
- repeated same-day lists do not create or overwrite duplicate assignments;
- `/video-complete` rejects missing/non-UUID `advertisementId`;
- valid assignment completes once;
- yesterday's leftover assignment neither completes nor blocks today's row;
- an expired assignment returns `409` without changing user or seller state;
- arbitrary, wrong-user, and duplicate ad IDs fail;
- archived ad disappears from new lists immediately;
- pre-archive assignment completes inside 24 hours and fails afterward.

Assignment maintenance:

- stale `issued` rows become `expired` after the snapshotted local midnight;
- completed rows remain through the configured audit window;
- purging an assignment retains its ad-view and financial records;
- expired/cancelled and completed retention periods are enforced separately.

Treasure box:

- every two qualifying views form the expected cycle;
- same-ad and different-ad boxes are attributed correctly;
- group-owner reward may exceed one view's funding without delay/reduction;
- seller pool never becomes negative; shortage creates platform advance;
- effective deadline is the earlier of local midnight and archive grace;
- concurrent open credits once;
- unopened/zero boxes settle without user credit.

Order/refund:

- fractional lots reserve in deterministic order;
- paid converts reservation to consumption;
- failure/cancel/expiry resolves reservations once;
- payment processing crossing lot expiry follows the bounded-reservation rule;
- full unexpired refund restores all spent coins;
- partial unexpired refund restores only the proportional coins;
- mixed expired/unexpired refund restores only unexpired portions to the user;
- expired seller-funded refund credits the source ad;
- expired platform-funded refund reverses platform exposure;
- repeated/parallel refund cannot return value twice.

Advertisement lifecycle/accounting:

- archive is terminal;
- one replacement ad can be created for the product;
- replacement lineage is preserved;
- financial close waits for grace obligations;
- remaining advance is written off once;
- later expiry/refund credits do not reactivate the archived ad;
- allowed archived balance transfer is double-entry and same product/seller;
- cross-product, cross-seller, duplicate, and early transfers fail.

Scheduler/timezone:

- user-local resets work across representative positive/negative offsets;
- null/invalid timezone uses Taipei;
- profile timezone change does not move existing deadlines;
- API deadline enforcement works during the cron's 00:00-00:30 polling gap;
- Taipei accounting close does not expire user-local assets;
- retries and two replicas remain idempotent;
- a crash between batches can resume safely.

### Backfill and migration tests

Test at least these fixture populations:

- empty database;
- users with zero coins;
- matching and mismatching user/monthly totals;
- null/invalid timezones;
- active unopened boxes;
- ads in every status;
- payment-processing orders;
- paid refundable orders;
- partial and completed refunds;
- missing/malformed historical `coinInfo`;
- rerun after interruption at every checkpoint.

Assert that the second backfill run changes no accounting totals.

### Whole-application regression

Before promotion, run smoke/regression coverage for features affected indirectly:

- authentication and timezone update;
- seller/admin advertisement APIs;
- product creation/update and seller ownership;
- cart, stock/reserve, order creation and status transitions;
- ECPay callback handling with mocks;
- refund administration and summaries;
- push/email jobs with mocks;
- API Swagger generation;
- `npm run build`.

### Reconciliation tests

Run SQL assertions after every suite:

```text
box reward = sum(box allocations)
acquired allocation = seller funded + platform funded
lot original = available + reserved + net consumed + expired/returned
order discount = sum(order allocations)
ad advance = created - repaid - cancelled - written off
seller net spend = gross spend - seller-return credits
user balance = sum(available user lots)
```

All differences must be exactly zero at the chosen decimal precision.

## Migration Rehearsal Against Target-Like Databases

A clean test database proves fresh installation and behavior. It does not prove
that migrations will work on the differently-versioned target databases.

Before modifying each real environment:

1. Obtain a schema-only plus sanitized representative-data dump from that
   environment, or clone it using an approved secure mechanism.
2. Restore it into the disposable test PostgreSQL server/database.
3. Confirm its migration journal matches the source environment.
4. Apply that environment's exact planned expansion migration.
5. Run the backfill twice.
6. Run reconciliation, API, scheduler, concurrency, and regression suites.
7. Apply the contract migration.
8. Rerun all tests and reconciliation.
9. Measure migration locks and duration with representative row counts.
10. Drop/reset the disposable database before rehearsing the next environment.

No unsanitized development/staging data should be committed as `.sql` fixtures.

## Promotion Order and Gates

### Gate 1: Disposable `test`

Required:

- clean baseline builds from empty PostgreSQL;
- target-like upgrade rehearsals pass;
- build/unit/integration/API/job/concurrency tests pass;
- backfill rerun is a no-op;
- reconciliation differences are zero;
- rollback procedure is rehearsed.

### Gate 2: `local`

1. Back up/local snapshot.
2. Apply the environment-specific expansion migration.
3. Stop application writers and keep the ledger disabled.
4. Finalize legacy payment-processing orders.
5. Run the idempotent backfill and require zero reconciliation differences.
6. Set `COIN_LEDGER_ENABLED=true` and restart application writers.
7. Run smoke and full relevant tests.
8. Observe before promotion.

### Gate 3: `development`

Repeat the same write-stopped sequence using `.env.development` and its own
tested migration history and backfill checkpoint.

### Gate 4: `stg`

Repeat with `.env.stg`, sanitized production-like volume, all scheduled jobs,
multiple replicas if staging uses them, and external-service sandboxes/mocks.

Promotion stops on any reconciliation difference, unhandled exception, duplicate
ledger event, missed deadline, negative seller-funded coin pool, or unexpected
API regression.

## Rollback Strategy

### Before ledger cutover

- Disable `COIN_LEDGER_ENABLED`.
- Roll back application code if necessary.
- Leave additive tables/columns in place.
- Do not run a destructive down migration merely to remove unused expansion
  objects.

### After ledger writes begin

- Stop new ledger/order/refund/scheduler writes safely.
- Preserve all immutable rows for diagnosis.
- Roll back only to code that understands the expanded schema and compatibility
  dual writes.
- Use compensating ledger entries for financial corrections; never edit/delete
  historical transactions.
- Restore a database backup only when the full environment and all subsequent
  writes are intentionally discarded.

Do not delete or rerun a completed environment backfill checkpoint after ledger
data exists without an audited migration.

## Implementation Sequence Checklist

1. Audit target schemas and divergent migration histories.
2. Add guarded `test` environment and real disposable PostgreSQL database.
3. Establish clean pre-ledger `drizzle_test` baseline.
4. Add automated test harness, safe reset, mocks, and fixtures.
5. Add expansion schema and review generated SQL.
6. Implement shared decimal/timezone/accounting services.
7. Make `advertisementId` required throughout `/video-complete`.
8. Persist issued ad assignments and implement archive grace.
9. Implement view funding, box attribution/open, and coin lots.
10. Implement order reservations, consumption, and failure release.
11. Implement refund reversals and seller/platform routing.
12. Implement user-local expiry and Taipei system-accounting jobs.
13. Implement ad financial close, replacement, and balance transfer.
14. Implement seller/admin ledger and reconciliation APIs plus Swagger/Zod.
15. Build idempotent backfill and reconciliation reports.
16. Run clean-install, backfill, full behavior, concurrency, and regression tests.
17. Rehearse each target environment's exact upgrade in disposable PostgreSQL.
18. Apply contract constraints only after all controls match.
19. Promote in order: `test` -> `local` -> `development` -> `stg`.
20. Plan production separately after staging acceptance.

## Definition of Ready for `local`

Nothing is applied to `local` until all of the following are true:

- a real disposable PostgreSQL test database exists;
- test create/reset/drop commands refuse non-test targets;
- Drizzle no longer hardcodes `stg` or logs database credentials;
- current target schema/migration drift is understood;
- expansion and contract migrations have been rehearsed;
- the backfill is idempotent and produces zero reconciliation differences;
- every core feature and regression test passes;
- exact-deadline, refund, archive-grace, and concurrency cases pass;
- an operational rollback/runbook has been executed successfully in test.
