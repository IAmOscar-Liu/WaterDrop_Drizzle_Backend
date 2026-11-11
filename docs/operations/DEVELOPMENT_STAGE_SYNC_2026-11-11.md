# Development/staging merge and database schema verification

Date: 2026-11-11 (Asia/Taipei)

## Source and package scripts

Committed the fulfillment-message changes on `development` (`3d571c4`): original virtual/home-delivery follow-up paragraphs remain, followed by purchased product/variant, quantity, unit price and item subtotal. Home delivery additionally shows its delivery method. Names and prices use order snapshots; reminders omit the virtual delivery-method row and explain that subtotal precedes coin deductions and excludes shipping/other fees. Existing paid orders/messages are not rewritten.

Removed the one-off `db:seed-products`, `generate-dbml` and `getStoreList` package shortcuts (`a2e0a62`). README documents direct commands for these retained source utilities. Runtime/deployment, migration, tests and documented chat/notification/manual-credit helpers remain. All nested package commands and TypeScript entrypoints resolve.

The existing staging branch is named `stage`; it was fast-forwarded to include all development changes, including the `drizzle/{local,dev,test,stg}` relocation and shared admin/app error contract. Both branches contain the same package cleanup. No remote push, server deployment or PM2 restart was performed. The unrelated pre-existing `docs/.DS_Store` working-tree edit was left untouched.

## Migrations

Ran `db:migrate:local`, `db:migrate:development` and `db:migrate:stg` using their explicit environment configurations.

- Local and development were already current; migration runs completed successfully without new schema changes.
- Staging applied `drizzle/stg/0017_product_refund_windows.sql` and `drizzle/stg/0018_payment_safety.sql`.
- No migration SQL or generated snapshots were modified.
- Drizzle generation checks for all three environments report no schema changes relative to `src/db/schema.ts`.

| Environment | Latest journal migration | Latest SQL hash/timestamp recorded | Pending migrations |
| --- | --- | --- | ---: |
| Local | `0119_payment_safety` | Yes | 0 |
| Development | `0070_payment_safety` | Yes | 0 |
| Staging | `0018_payment_safety` | Yes | 0 |

## Actual schema comparison

Read-only repeatable-read catalog inspections compared all three configured databases. Each environment has:

| Object | Count | Definitions match across all three |
| --- | ---: | --- |
| Tables | 66 | Yes |
| Columns, types, defaults, nullability, identity/generated attributes | 689 | Yes |
| Primary/foreign/unique/check constraints | 249 | Yes |
| Indexes, including predicates and validity/readiness | 170 | Yes |
| Enums and ordered values | 31 | Yes |
| Sequence definitions | 1 | Yes |
| Views, public application routines, user triggers and RLS policies | 0 | Yes |

All checked constraints are validated and all indexes are valid/ready. The 1,206 compared definitions share the same canonical fingerprint:

```text
f508d162395be70c8a557412eec6b3d523f71ba6dcb476cb7c2c9f19e1f3efec
```

Local runs PostgreSQL 17.6; development/staging run 18.6. NOT NULL catalog representation is normalized through column nullability. Owners/grants, physical column order, sequence current values, migration-history row counts and application data are outside this schema-equivalence comparison. No application data was copied between environments.

## Historical local migration limitation

Development and staging recorded migration hashes all correspond to their current repository journals. Local retains 17 older recorded rows with 16 distinct hashes absent from the current local journal. These rows date from September 2025 and were already present before this operation; the checked reachable Git migration history did not resolve their hashes. They were not deleted, rewritten or marked as newly applied.

The latest local migration hash/timestamp is verified, there are no pending local migrations, and the live local schema matches development/staging. This confirms current schema parity, while the origin of those older local migration records remains unresolved. It does not establish a fully reproducible local migration history from those records alone.

## Validation

- `npm test`: build, error-contract checks and all 19 disposable-database suites passed, including fulfillment message snapshot prices, retries and rollback.
- Package script targets and nested commands resolve.
- Local/development/staging migration runs completed successfully.
- All three generation checks report no schema changes.
- Read-only catalog comparison confirms schema parity and validated constraints/indexes.

Deploy the updated backend separately when ready; applying database migrations does not restart a running API process.
