# Admin Section 1 rollout completion

As of 2026-09-30, the rollout is complete in test, local, development, and staging.
The live staging audit confirmed all five sidebar read states for every eligible
active account, no duplicate normalized category names, and no active employees
without a valid seller parent.

The one-time preflight and sidebar backfill CLI and its package aliases have been
retired. The original implementation remains in Git history. This completion
record does not certify a production rollout.

The backfill initialized `orders`, `deliveries`, `refunds`, `advertisements`, and
`chatrooms` read states in each account's resolved scope, using the rollout cutover
time so historical records did not appear as new notifications. Existing read
states remain intact.

Retain the generated migrations, snapshots, and journals. Staging's catch-up
migration is `drizzle_stg/0013_aromatic_toad_men.sql`. The standard
`db:migrate:<environment>` commands remain available.

Use `npm test` for regression coverage. Runtime smoke checks cover sub-account
creation/deletion, category conflicts, product soft deletion, wallet summary,
dashboard, advertisement metrics, and sidebar seen state.
