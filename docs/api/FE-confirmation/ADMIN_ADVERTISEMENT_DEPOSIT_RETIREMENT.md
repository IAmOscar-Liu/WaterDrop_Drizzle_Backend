# Admin advertisement funding API changes

Date: 2026-10-01

Status: implemented in the backend source; deployment is required before this
contract takes effect in an environment.

## Frontend change

`PUT /api/admin/advertisement/deposit/:id` has been removed. It has no redirect or
compatibility alias; requests to the old path return HTTP `404`. Do not depend on
a JSON error body for an unmatched route.

Use `PUT /api/admin/advertisement/budget/:id` with `operation: "increase"` for all
advertisement top-ups. `id` is the advertisement UUID, not the product UUID.

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

- Required: `operation`, `amount`, and `idempotencyKey`.
- Allowed operations: `increase` and `decrease`. Only `increase` performs a
  transfer; `decrease` returns `409 operation_not_supported`. `set` is removed
  and returns `400`, whether the target is below, equal to, or above the balance.
- `amount`: positive TWD amount, as a decimal string or number, with at most two
  decimal places. Prefer decimal strings.
- `idempotencyKey`: 8–200 characters after trimming. Generate one key per intended
  top-up and reuse it with the same advertisement and amount for retries.
- `metadata`: optional JSON object.

Migrate existing callers by replacing `/deposit/` with `/budget/` and adding
`operation: "increase"`. Preserve the original idempotency key for any in-flight
funding retry, including a retry after switching endpoints. Do not create a new
key for the same intended transfer.

## Funding behavior and permissions

The owning seller or a platform admin may fund the advertisement. Employees and
unrelated sellers cannot. Money always comes from the product seller's wallet,
including requests made by an admin.

For example, adding 200 TWD moves an ad balance from 100 to 300 and reduces the
seller wallet by 200. Wallet debit, ad credit, and linked ledger entries are
committed atomically. The seller must be active with sufficient wallet funds;
archived or financially closed ads cannot receive new funding.

A depleted ad becomes active when its resulting balance reaches 100 TWD. A paused
ad remains paused.

## Response and errors

Successful funding retains the `{ "success": true, "data": ... }` envelope.
`data` contains advertisement statistics (`balance`, `status`, `totalSpent`, and
the other existing fields), `wallet`, `walletTransaction`,
`advertisementTransaction`, and `idempotentReplay`.

- Advertisement `balance` and transaction `amount` are numbers.
- Wallet amounts and ledger `balanceBefore`/`balanceAfter` values are decimal
  strings.
- Wallet transaction type: `advertisement_funding_debit`.
- Advertisement transaction type: `wallet_funding`.
- A successful same-key funding retry returns `idempotentReplay: true` and the
  original financial result without another debit.

| HTTP status | Meaning |
| --- | --- |
| 400 | Invalid UUID, operation, amount, or idempotency key. |
| 401 | Missing or invalid authentication. |
| 403 | Caller is not the owning seller or a platform admin. |
| 404 | Advertisement not found, or request sent to the removed deposit path. |
| 409 | Unsupported `decrease`, insufficient wallet funds, inactive seller, unavailable wallet, archived/closed ad, or idempotency conflict. |
| 503 | Wallet funding is disabled by `ACCOUNT_WALLET_AD_FUNDING_ENABLED`. |

Swagger at `/api-docs` documents the budget endpoint and its nested response.
The deposit path is no longer listed.

## Scope

This change removes the duplicate deposit API and the budget `set` operation.
Use `increase` for top-ups. `decrease` remains in the request enum but returns
HTTP `409` with `message: "operation_not_supported: advertisement budget cannot be withdrawn"` after authorization and advertisement lookup. Unauthorized callers
still receive `403`, and a missing advertisement returns `404`.

Requests with `set` fail validation with HTTP `400` and do not change balances.
The former `noChange` response for equal targets is removed. Withdrawal support
is not implemented; the frontend must not advertise it as available.

No database migration or backfill is required. App/Flutter routes are unaffected.

The proposed closed-ad withdrawal and internal company statistics work is tracked
in the [consolidated implementation plan](../../plans/BE_REQUIREMENT_1001_IMPLEMENTATION_PLAN.md). Those features remain planned.
