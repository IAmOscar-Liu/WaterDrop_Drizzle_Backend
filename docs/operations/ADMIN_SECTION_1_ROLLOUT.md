# Admin Section 1 rollout

Run each step in local, development, staging, and production independently.

## 1. Preflight before migration

```bash
npm run admin-section-1:preflight:local
```

Use the matching environment suffix elsewhere. This fails when category names
have case-insensitive duplicates or an employee is not attached to an active
seller. Resolve those rows before applying the unique category-name index.

## 2. Apply the generated migration

```bash
npm run db:migrate:local
```

Generated migrations currently exist for test, local, and development:

- `drizzle_test/0008_long_warstar.sql`
- `drizzle_local/0108_powerful_daredevil.sql`
- `drizzle_dev/0062_powerful_magus.sql`

Do not generate staging/production migrations until their migration snapshots
have been reconciled with the branch.

## 3. Initialize sidebar seen state

Optionally set one shared deployment timestamp before running the backfill:

```dotenv
ADMIN_SIDEBAR_CUTOVER_AT=2026-09-16T00:00:00.000Z
```

Then run:

```bash
npm run admin-section-1:backfill:local
```

The command is idempotent. It creates five read-state rows for each active
admin-side account in its resolved scope, so historical records do not appear
as new sidebar notifications.

## 4. Verify

```bash
npm test
```

Smoke-test sub-account creation/deletion, category conflict handling, product
soft delete, wallet summary, dashboard, ad metrics, and sidebar seen state.

