# Development/staging merge and database schema verification

Date: 2026-11-24 (Asia/Taipei)

## Branch and configuration

Merged `development` at `b0a2bf8` into `stage` with merge commit `816e70a`, preserving staging migration history. The merge completed without conflicts. This includes seller earnings, ad automation, advertisement filters/metrics/status counts, payment fixes, and notification-specific coin expiration push navigation.

Updated the local, gitignored `.env.stg` with `SELLER_EARNINGS_LAUNCH_AT=2026-11-24T04:41:28.057Z` (12:41:28 Taipei). This is an explicit new rollout cutoff rather than a historical backfill. Existing staging-specific credentials, URLs, feature flags and the normal staging earnings hold period were preserved. No secrets are included in this report or Git. Copy the setting to the deployed staging environment when deploying the backend; this operation did not change VM environment files or restart PM2.

## Database migrations

Generated and reviewed `drizzle/stg/0021_peaceful_doorman.sql` with `npm run db:generate:stg`. Its SQL is byte-for-byte identical to the development migration `0073_peaceful_green_goblin.sql` already applied to development. It adds seller earnings and wallet-request tables, refund shipping breakdowns, ad automation tables, and deposit/withdrawal transaction enum values. The wallet transaction sign constraint is replaced with the expanded equivalent. No tables or business records were removed.

Successfully ran the explicit migration commands for staging, local and development. Only staging had a pending migration. No business data was copied between environments.

| Environment | Latest migration | Latest SQL hash/timestamp recorded | Pending |
| --- | --- | --- | ---: |
| Local | `0123_fluffy_spyke` | Yes | 0 |
| Development | `0073_peaceful_green_goblin` | Yes | 0 |
| Staging | `0021_peaceful_doorman` | Yes | 0 |

Post-migration generation checks for all three environments report no schema changes against `src/db/schema.ts`.

## Live schema comparison

Read-only repeatable-read catalog inspections compared the `public` application schema in all three configured databases, including definitions rather than only object counts.

| Object | Local | Development | Staging | Definitions match |
| --- | ---: | ---: | ---: | --- |
| Tables, including row-security flags | 76 | 76 | 76 | Yes |
| Columns, types, defaults, nullability, identity/generated attributes and collations | 763 | 763 | 763 | Yes |
| Primary/foreign/unique/check constraints | 285 | 285 | 285 | Yes |
| Indexes, including validity/readiness | 187 | 187 | 187 | Yes |
| Enums and ordered labels | 31 | 31 | 31 | Yes |
| Sequence definitions | 1 | 1 | 1 | Yes |
| Views, public routines, user triggers and RLS policies | 0 | 0 | 0 | Yes |

All checked constraints are validated and all indexes are valid and ready. The canonical schema fingerprints match:

```text
2e798fc82ff791a0d65687e1abdb15ffb4314a630b0e9425ac83aeb0372cfa9e
```

PostgreSQL versions differ: local 17.6, development 18.6, staging 18.7. NOT NULL catalog representation is normalized using column nullability. Owners/grants, physical column order, sequence current values, migration-history row counts and application data are outside this schema comparison.

Local retains the previously documented 17 historical migration rows whose hashes are absent from the current journal. They were not rewritten or deleted. Its latest migration is verified, there are no pending migrations, and its live schema matches the other two databases. Development and staging have no unmatched recorded migration hashes.

## Validation

- `npm run build` passed.
- `npm run test:seller-earnings` passed against a disposable test database, including seller earnings, wallet requests and advertising automation.
- All three migration commands succeeded.
- All three generation checks report no schema changes.
- Live catalog comparison confirms matching schemas and validated constraints/indexes.

Database migration does not deploy the updated API or restart scheduled jobs. Deploy the merged stage backend and its environment configuration separately.


## Later rollout: deletion/history safeguards and package cleanup

Merged development through `4762377` into stage in merge commit `759dbb8`, including the safety fixes in `5836c16`: public daily-stats reset removal, category soft deletion/name restoration, preserved notification contents, device-scoped token removal, and seller/employee account deletion permissions with session/parent-account guards. This later verification supersedes the earlier schema counts/fingerprint above for the current checkout.

Ran all three explicit migration commands again. Local and development were already current. Staging applied `0023_fuzzy_doctor_faustus` to add nullable `categories.deleted_at`; no business records were deleted, restored, copied or reset.

| Environment | Latest migration | Latest hash/timestamp verified | Pending |
| --- | --- | --- | ---: |
| Local | `0125_deep_captain_universe` | Yes | 0 |
| Development | `0075_glamorous_ironclad` | Yes | 0 |
| Staging | `0023_fuzzy_doctor_faustus` | Yes | 0 |

Read-only repeatable-read catalog comparisons confirm the same 76 tables, 765 columns, 286 primary/foreign/unique/check constraints, 187 indexes, 31 enum definitions and one sequence definition. Views, public routines, user triggers and policies are absent in all three. All compared constraints are validated and indexes valid/ready. Canonical fingerprints match:

```text
86ee78c474f1e61c37a517fcfb6d7ce46ca16728aee6e6118d8aa71a8b14f23d
```

Generation checks for local, development and staging report no schema changes. The previously documented local historical migration-hash limitation remains unchanged; current latest hashes/timestamps are verified. Schema parity does not imply matching application data, sequence current values, owners/grants or database versions.

Removed only the obsolete `db:push` and `db:pull` package shortcuts. The project uses `db:generate:*` and `db:migrate:*` to track schema changes. No documentation or package script called the removed aliases. Preserved runtime/PM2, environment-specific migrations/studio, disposable test suites and their internal `_test:*` commands, chat/notification helpers and manual coin-credit helpers. All remaining 89 script entries, nested npm references, TypeScript entrypoints and suite-runner references resolve.

Broader validation also corrected duplicate Account Swagger deletion fields and gave a seller-earnings employee-permission fixture its required seller group, preserving the intended funding-permission check under the stricter employee authentication rules.

Validation: `npm test` passed, including the build, error-contract checks and all 20 disposable-database suites. All three generation checks and live catalog comparisons passed. No running API or PM2 process was restarted by this operation.
