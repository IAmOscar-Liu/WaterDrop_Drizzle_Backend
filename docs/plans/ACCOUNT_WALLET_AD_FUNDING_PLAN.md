# Account wallet and advertisement funding plan

Status: proposed — implementation has not started.

## Goal

1. Every newly created admin, seller, or employee account receives exactly one wallet.
2. Existing accounts are backfilled without changing historical advertisement balances.
3. Only a platform admin can credit money into a seller wallet.
4. Funding an advertisement deducts the same amount from its seller's wallet atomically.
5. Concurrent funding requests must never make a wallet balance negative.
6. Every wallet balance change is immutable, idempotent, attributable, and reconcilable.

This wallet belongs to admin-side accounts. It is unrelated to app-user coins
and must not alter the app-user coin-ledger rules.

## Current implementation audit

The database already contains `account_wallets` with a unique `accountId` and
the aggregate fields `walletBalance`, `totalRevenueCash`, `totalRevenueCoin`,
and `lockedBalance`. However:

- `createAccount()` inserts only an `accounts` row;
- existing accounts may have no wallet;
- there is no wallet repository, service, controller, API, or transaction log;
- monetary wallet fields use `double precision`;
- `PUT /api/admin/advertisement/deposit/:id` directly increases ad balance;
- the deposit does not debit a wallet, verify ownership, or require idempotency;
- concurrent retries can credit an advertisement more than once;
- archived advertisements can currently receive deposits.

The advertisement coin-funding account is not the seller wallet. It tracks how
viewed-ad money funds coins and seller returns after money has entered an
advertisement balance.

## Decided behavior

- Create a zero-balance wallet for every new account, including admins and employees.
- Only seller wallets may receive admin credits or fund advertisements.
- Only platform admins may credit seller wallets.
- Sellers may fund ads belonging to their own products.
- Admins may initiate ad funding, but it still debits the product owner's wallet.
- Derive the seller from `advertisement -> product -> sellerId`; never trust a seller ID from the request.
- Grandfather existing ad balances. Backfill does not charge them to new wallets.
- Coin expiry, seller returns, financial close, and archived-ad transfers stay unchanged.
- Seller returns continue to credit the source ad balance, not the wallet.
- Never directly set a wallet balance; corrections use compensating transactions.

## Schema changes

### Strengthen `account_wallets`

Keep the table, but change all monetary fields from `double precision` to
`numeric(18,2)` and add non-negative checks. APIs expose exact decimal strings,
for example `"1000.00"`.

Before conversion, audit and reject negative values or values with more than
two decimal places. Do not silently round production money.

### Add `account_wallet_transactions`

Recommended fields:

```text
id                         uuid primary key
walletId                   uuid -> account_wallets, restrict delete
accountId                  uuid -> accounts, restrict delete
actorAccountId             uuid -> accounts, restrict delete
advertisementId            uuid -> advertisements, nullable, restrict delete
type                       enum
amount                     numeric(18,2), signed and non-zero
balanceBefore              numeric(18,2)
balanceAfter               numeric(18,2)
sequence                   bigint generated identity
idempotencyKey             text, unique and not null
reason                     text, nullable
externalReference          text, nullable
metadata                   jsonb, nullable
createdAt                  timestamptz
```

Initial types:

```text
legacy_opening_balance
admin_credit
advertisement_funding_debit
```

`actorAccountId` is nullable only for a system backfill; an admin credit requires
an actor. `amount` is positive for credits and negative for debits. Add checks:

- `balanceAfter = balanceBefore + amount`;
- before/after balances are non-negative;
- credit types have positive amounts;
- ad funding is negative and has an advertisement reference.

Wallet transactions are immutable: application code never updates or deletes them.
Index `(walletId, sequence)` so reconciliation has a deterministic ledger order.

### Link both sides of ad funding

Add nullable, unique `accountWalletTransactionId` to
`advertisement_transactions`. Existing history remains `null`. Insert the wallet
debit first, then insert the ad credit referencing it; avoid circular foreign
keys between the two transaction tables.

Add `wallet_funding` to the advertisement transaction type enum. Keep existing
`deposit` rows as legacy deposits rather than rewriting history.

## Account creation

Refactor `createAccount()` into one database transaction:

1. Hash the password before opening the transaction.
2. Insert the account.
3. Insert its zero-balance wallet.
4. Commit both or roll back both.
5. Preserve the current account response shape.

The wallet's unique `accountId` prevents duplicates. Tests and seeds that insert
accounts directly must use a shared factory or create the wallet explicitly.

A database trigger is not recommended initially because it is invisible to the
Drizzle schema. Reconciliation will fail if an account lacks a wallet. A trigger
can be reconsidered if accounts are routinely created outside this server.

## APIs

Use a dedicated router mounted at `/api/admin/account-wallet`.

### Read the caller's wallet

```http
GET /api/admin/account-wallet/me
```

Any authenticated admin-side account can read its own wallet. Admins and
employees normally have zero balances because business funding is seller-only.

### Read the caller's transactions

```http
GET /api/admin/account-wallet/me/transactions?page=1&limit=20&type=admin_credit
```

Return an immutable, newest-first paginated list with optional type/date filters.

### Admin reads a wallet

```http
GET /api/admin/account-wallet/:accountId
GET /api/admin/account-wallet/:accountId/transactions
```

These are platform-admin-only and return `404` for a missing account or wallet.

### Admin credits a seller wallet

```http
POST /api/admin/account-wallet/:accountId/credit
```

Request:

```json
{
  "amount": "1000.00",
  "idempotencyKey": "seller-topup-payment-20260916-0001",
  "reason": "Confirmed bank transfer",
  "externalReference": "BANK-20260916-12345",
  "metadata": {}
}
```

Rules:

- platform-admin-only;
- target must exist and have role `seller`;
- amount is positive with at most two decimal places;
- lock the wallet before reading or updating it;
- update aggregate and insert transaction atomically;
- same idempotency key and payload return the original result;
- same key with a different account or amount returns `409`.

This API records already-confirmed money. It is not a public checkout endpoint.
A future online payment flow may credit a wallet only from a verified provider webhook.

Recommended response:

```json
{
  "success": true,
  "data": {
    "wallet": {
      "accountId": "SELLER_UUID",
      "walletBalance": "1000.00"
    },
    "transaction": {
      "type": "admin_credit",
      "amount": "1000.00",
      "balanceBefore": "0.00",
      "balanceAfter": "1000.00",
      "idempotencyKey": "seller-topup-payment-20260916-0001"
    }
  }
}
```

## Advertisement funding workflow

Keep the endpoint but change its contract:

```http
PUT /api/admin/advertisement/deposit/:id
```

```json
{
  "amount": "200.00",
  "idempotencyKey": "fund-ad-AD_UUID-20260916-0001",
  "metadata": {}
}
```

Within one database transaction:

1. Load the advertisement and product; derive the seller.
2. Authorize the owning seller or platform admin.
3. Reject archived or financially closed ads.
4. Lock the seller wallet with `FOR UPDATE`.
5. Resolve idempotency before applying a new change.
6. Verify exact `walletBalance >= amount`.
7. Lock advertisement stats.
8. Debit the wallet and credit the ad by the same amount.
9. Insert the negative wallet transaction.
10. Insert the positive ad transaction and link both records.
11. Commit all changes together.

Insufficient wallet balance returns `409` and changes nothing. Admin permission
never bypasses the balance requirement.

All amounts are normalized to cents. The legacy advertisement aggregate still
uses `double precision`; use cent comparison helpers and exact numeric
transaction fields as reconciliation controls. Migrating all ad monetary
aggregates to `numeric` should be a separate migration because the coin ledger
uses those fields broadly.

## Concurrency and lock order

Always lock in this order:

```text
seller wallet -> advertisement stats
```

Concurrent deposits to different ads owned by one seller then serialize at the
wallet. Also include a conditional non-negative database update as defense in
depth. Never check funds outside a transaction and update later.

## Existing-account backfill

Create a dedicated idempotent script:

```text
src/scripts/accountWalletMigration.ts
```

Do not combine it with the app-user coin-ledger migration.

### Audit mode

Report without writing:

- account and wallet counts;
- accounts missing wallets;
- negative or over-precision wallet values;
- orphan wallets;
- non-zero wallets without transaction history;
- existing ad balances and legacy deposit counts as control totals.

### Apply mode

Under a PostgreSQL advisory lock:

1. Insert zero-balance wallets for missing accounts with `ON CONFLICT DO NOTHING`.
2. Preserve every existing wallet balance.
3. For a non-zero legacy wallet without history, insert one
   `legacy_opening_balance` transaction using `wallet-backfill:<walletId>`.
4. Do not create historical wallet debits for existing ad balances.
5. Print created/preserved counts and control totals.

### Reconcile mode

Fail if:

- any account lacks a wallet;
- any wallet is negative;
- a transaction chain is broken;
- opening balance plus signed transactions differs from wallet aggregate;
- wallet-funded ad credit lacks its paired wallet debit;
- paired debit and credit amounts differ.

Add explicit environment commands, for example:

```text
npm run account-wallet:audit:local
npm run account-wallet:backfill:local
npm run account-wallet:reconcile:local
```

Add development, staging, and production forms. A write command must never
silently default to development.

## Rollout sequence

1. Generate and review schema migrations for the intended environment folders.
2. Run the read-only precision and balance audit before converting existing
   wallet columns to `numeric(18,2)`.
3. Migrate the disposable test database and run the full suite.
4. Deploy wallet creation, read/credit APIs, ledger, and migration script with
   wallet-backed ad funding disabled.
5. Migrate, backfill, and reconcile the target environment.
6. Credit test seller wallets through the admin API.
7. Enable wallet-backed ad funding.
8. Smoke test: admin credit -> ad funding -> view debit -> seller return -> reconcile.
9. Repeat local -> development -> staging -> production.

Use `ACCOUNT_WALLET_AD_FUNDING_ENABLED`. While disabled, the ad deposit endpoint
returns `503`; it must not fall back to unbacked balance minting.

## Test coverage

Add tests for:

- account creation and retry produce exactly one wallet;
- backfill is idempotent and preserves existing balances;
- admin can credit a seller; seller/employee cannot credit;
- admin cannot credit an admin or employee wallet;
- sellers can read only their own wallet; admin can read any wallet;
- seller and admin can fund the seller's ad;
- another seller cannot fund it;
- insufficient funds change neither side;
- duplicate idempotency requests debit exactly once;
- conflicting idempotency payload returns `409`;
- archived/closed ads reject funding;
- concurrent deposits never make a wallet negative;
- paired wallet debit and ad credit are equal and linked;
- a forced mid-transaction failure rolls everything back;
- existing coin, box, order, refund, cron, seller-return, and ad-transfer tests pass.

## Swagger and FE handoff

Document exact decimal strings, authorization, transaction filters,
idempotency/retry behavior, `409` conflicts, rollout `503`, and the distinction
between wallet credit, ad funding, and seller returns.

## Expected implementation files

```text
src/db/schema.ts
src/repository/accountWallet.ts
src/services/accountWallet.ts
src/controller/accountWallet.ts
src/middleware/admin/accountWallet.ts
src/routers/admin/admin-account-wallet.ts
src/routers/admin/index.ts
src/repository/account.ts
src/repository/advertisement.ts
src/services/advertisement.ts
src/controller/advertisement.ts
src/middleware/admin/advertisement.ts
src/routers/admin/admin-advertisement.ts
src/scripts/accountWalletMigration.ts
src/tests/api.e2e.ts
package.json
docs/api/<dated-admin-fe-wallet-update>.md
```

## Accepted implementation decisions

1. **Activation after wallet funding:** preserve current deposit behavior:
   `depleted` becomes `active` after reaching the existing minimum; `paused`
   stays paused; `archived` is rejected.
2. **Seller status for admin credit:** allow corrections/credits to inactive or
   banned sellers, but require an active seller before funding an ad.
3. **Legacy non-zero wallets:** preserve them and insert a
   `legacy_opening_balance` transaction.
4. **Money representation:** migrate wallet aggregates to `numeric(18,2)` and
   expose decimal strings.
5. **Ad-to-wallet withdrawal:** exclude it. Archived funds keep using the
   existing replacement-ad transfer.
6. **Credit reversal API:** exclude it initially. A future correction must be an
   admin-only compensating transaction, never a history edit.

## Implementation status

Implemented on `feat/FE-confirmation`: exact wallet aggregates and immutable
transactions, automatic wallet creation, admin credit/read APIs, atomic linked
wallet-to-ad funding, idempotency and row locking, audit/backfill/reconciliation
commands, Swagger/FE handoff, and disposable-database integration coverage.
