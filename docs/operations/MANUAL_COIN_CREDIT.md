# Manual Coin Credits

Use this command to increase an app user's coin balance in the `local` or
`development` environment. It updates the user balance and coin ledger in one
database transaction.

It cannot be used in staging or production.

## Prerequisites

Before running the command:

1. Apply the coin-ledger database migrations to the target database.
2. Set `COIN_LEDGER_ENABLED=true` in the target environment file:
   - local: `.env.local`
   - development: `.env.development`
3. Confirm that `DATABASE_URL` in that file points to the intended database.
4. Obtain the app user's UUID.

This command does not require an additional schema migration.

## Local usage

```bash
npm run coin:add:local -- \
  --user-id=<user-uuid> \
  --amount=100 \
  --reason="Manual testing" \
  --idempotency-key="testing-20260914-001" \
  --operator="oscar"
```

## Development usage

```bash
npm run coin:add:development -- \
  --user-id=<user-uuid> \
  --amount=100 \
  --reason="Manual testing" \
  --idempotency-key="testing-20260914-001" \
  --operator="oscar"
```

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `--user-id` | Yes | UUID of the app user receiving the coins. |
| `--amount` | Yes | Positive coin amount with no more than two decimal places. |
| `--reason` | Yes | Audit explanation for the credit. |
| `--idempotency-key` | Yes | Unique reference for this intended credit. |
| `--operator` | No | Person or process issuing the credit; defaults to `cli`. |

## Idempotency keys

Use a different idempotency key for every intentional credit. A ticket number,
test-case reference, or dated sequence is suitable.

- Repeating the same command with the same key, user, and amount does not add
  the coins twice. It returns `already_applied`.
- Reusing the key with a different user or amount fails.

Example retry output:

```text
{
  status: 'already_applied',
  userId: '<user-uuid>',
  creditedCoin: 100,
  balance: '150.00',
  expiresAt: '<expiration-timestamp>',
  lotId: '<lot-uuid>',
  transactionId: '<transaction-uuid>'
}
```

The displayed `expiresAt` value is UTC. The expiration is calculated using the
user's timezone.

## Accounting behavior

The command atomically:

1. Creates a platform-funded `user_coin_lots` record.
2. Creates a `user_coin_transactions` credit with type `manual`.
3. Increases `users.coins`.
4. Increases `user_monthly_coin_stats.coins_earned`.

Manual coins follow the normal spending order and expire at the end of the next
month in the user's timezone. A missing or invalid user timezone falls back to
`Asia/Taipei`.

Because manual credits are platform-funded and are not linked to an
advertisement, expired manual coins are not returned to a seller or ad balance.

## Local verification

After making local credits, run reconciliation:

```bash
npm run coin-ledger:reconcile:local
```

It should finish with `Coin-ledger reconciliation passed.`

## Common failures

- `Manual coin credits are only allowed...`: use `coin:add:local` or
  `coin:add:development`; staging and production are intentionally blocked.
- `COIN_LEDGER_ENABLED must be true...`: enable the ledger in the selected
  environment after its migrations and backfill are complete.
- `Manual coin credit user not found`: verify the UUID and selected database.
- `amount supports at most 2 decimal places`: use an amount such as `10`,
  `10.5`, or `10.25`.
- `idempotency key was already used with different data`: use a new key for a
  new credit, or retry using the original user and amount.
