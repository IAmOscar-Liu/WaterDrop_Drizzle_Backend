# Account-wallet rollout completion

As of 2026-09-30, the rollout is complete in test, local, development, and staging.
The live staging audit confirmed that every account has a wallet, existing
balances have opening ledger entries where required, and wallet transaction
chains, balances, and advertisement funding pairs reconcile.

The one-time audit/backfill/reconciliation CLI and its package aliases have been
retired. The original implementation remains in Git history. This completion
record does not certify a production rollout.

The completed backfill created zero-balance wallets for accounts without one and
one `legacy_opening_balance` entry for each nonzero wallet without history.
Historical advertisement balances were preserved without retroactive wallet
debits. Keep those ledger entries as accounting history.

Normal account creation initializes wallets. Admin credits and advertisement
funding continue through the account-wallet APIs with
`ACCOUNT_WALLET_AD_FUNDING_ENABLED=true`. Runtime integration tests check concurrent
funding, rollback, matching advertisement credits, and wallet transaction chains.
Run `npm test` to execute them in a disposable database.

Generated SQL migrations, snapshots, journals, and the `db:migrate:<environment>`
commands remain available for schema changes and new databases. A fresh database
uses normal account creation; importing legacy balances into another environment
requires a separately reviewed data migration.
