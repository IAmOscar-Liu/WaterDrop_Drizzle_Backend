# Account-wallet rollout

Run this independently in each environment. Keep
`ACCOUNT_WALLET_AD_FUNDING_ENABLED=false` until audit, migration, backfill, and
reconciliation have all succeeded.

## 1. Pre-migration audit

Run the command matching the target environment before applying the schema
migration. It reports missing wallets, invalid precision, negative values,
orphans, existing wallet totals, and existing ad-balance control totals.

```bash
npm run account-wallet:audit:local
npm run account-wallet:audit:development
npm run account-wallet:audit:stg
npm run account-wallet:audit:production
```

Stop if negative balances, locked balances above wallet balance, or values with
more than two decimal places are reported. The schema migration converts wallet
aggregates to `numeric(18,2)` and adds non-negative constraints.

## 2. Apply the schema migration

```bash
npm run db:migrate:local
```

Use the corresponding `development`, `stg`, or `production` command for the
target environment. Review the generated migration for that environment first.

## 3. Backfill existing accounts

```bash
npm run account-wallet:backfill:local
```

The command is idempotent. It creates a zero-balance wallet for every account
that lacks one. Existing balances are preserved; each non-zero wallet without
history gets one `legacy_opening_balance` transaction. Existing advertisement
balances are grandfathered and are not deducted from wallets retroactively.

## 4. Reconcile

```bash
npm run account-wallet:reconcile:local
```

Reconciliation fails for missing/orphan wallets, negative balances, broken
transaction chains, aggregate-versus-ledger mismatches, or an advertisement
funding debit without an equal linked advertisement credit.

## 5. Enable and smoke test

Set this in the target environment and restart the server:

```dotenv
ACCOUNT_WALLET_AD_FUNDING_ENABLED=true
```

Then verify this sequence:

1. Admin credits a test seller wallet.
2. Seller or admin funds the seller's advertisement.
3. Wallet decreases and ad balance increases by the same amount.
4. Repeat the request with the same idempotency key and confirm no second debit.
5. Run the reconciliation command again.

Roll out in order: local, development, staging, then production. The repository
currently has focused wallet migrations for test, local, and development. The
staging snapshot is behind earlier schema work; reconcile/apply that migration
history before generating the staging wallet migration. A production migration
folder/configuration must also be established before the production migration
command can be used.
