# Admin FE update: account wallet and advertisement funding

Date: 2026-09-16

Swagger at `/api-docs` now includes the `Account Wallet` group. All endpoints
below are under `/api/admin`, use the existing bearer access token, and return
currency values such as wallet balances and wallet transaction amounts as
decimal strings.

## New account-wallet APIs

### Current account wallet

```http
GET /account-wallet/me
GET /account-wallet/me/transactions?page=1&limit=20&type=admin_credit
```

Any authenticated admin-side account may read its own wallet and transaction
history. Optional transaction filters are `type`, `startAt`, and `endAt`.

Transaction types:

- `legacy_opening_balance`
- `admin_credit`
- `advertisement_funding_debit`

### Platform-admin account lookup

```http
GET /account-wallet/:accountId
GET /account-wallet/:accountId/transactions
```

Only a platform `admin` may use these two endpoints.

### Credit a seller wallet

```http
POST /account-wallet/:accountId/credit
```

```json
{
  "amount": "1000.00",
  "idempotencyKey": "seller-topup-payment-20260916-0001",
  "reason": "Confirmed bank transfer",
  "externalReference": "BANK-000123",
  "metadata": {}
}
```

Only a platform admin may call this endpoint, and the target must be a seller.
Inactive or banned seller wallets may still be credited for correction. This
API records money that has already been confirmed; it is not a checkout API.

Retry rules:

- same key, seller, actor, and amount: returns the original financial result;
- same key with a different financial payload: `409`;
- FE must generate a stable key per intended credit and reuse it on retries.

## Changed advertisement deposit API

```http
PUT /advertisement/deposit/:id
```

The endpoint no longer creates advertisement balance without a source. It now
transfers the same amount from the product seller's account wallet to the ad.

```json
{
  "amount": "200.00",
  "idempotencyKey": "fund-ad-AD_UUID-20260916-0001",
  "metadata": {}
}
```

Rules:

- the caller must be the owning seller or a platform admin;
- the product seller must be active;
- admin permission does not bypass insufficient wallet balance;
- archived or financially closed ads reject funding;
- `depleted` becomes `active` only after its balance reaches the existing
  minimum; `paused` stays paused;
- a successful response includes the updated ad status, seller wallet, linked
  wallet debit, linked ad credit, and `idempotentReplay`;
- same idempotency key and financial payload debits exactly once;
- insufficient balance or conflicting state returns `409`;
- during rollout, the endpoint returns `503` while
  `ACCOUNT_WALLET_AD_FUNDING_ENABLED` is disabled.

## Account creation

Every newly created admin-side account now receives one zero-balance wallet.
This does not add fields to the existing register or login responses; read the
wallet through `/account-wallet/me` when needed.

## Scope

These are admin-side (`/api/admin/**`) changes. App-user authentication,
advertisement list, treasure-box, order, and refund request contracts are not
changed by the account-wallet feature. Existing expired/unused coin returns
still credit the advertisement balance, not the seller wallet.
