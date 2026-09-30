# Development PostgreSQL: New York to Singapore

Date: 2026-09-22 (Asia/Taipei)

## Scope

This is a **rehearsal copy**, not a server cutover. Development API/cron writers
are still running against New York. Singapore contains the dump's snapshot;
later New York writes are not replicated to it.

Rehearsal completed successfully. Singapore was empty before restoration.
All 50 tables and 8,478 rows matched the captured source snapshot, including
63 Drizzle migration records. Verification also passed for 554 columns,
121 indexes, 183 non-NOT-NULL constraints, 132 enum labels, and two sequences.
Column nullability is verified separately with the column definitions.
No source changes were observed at verification time, but writers remain active.
The TypeScript build passed; application/VM cutover testing remains a separate
step before the final move.

| Setting | Source | Destination |
| --- | --- | --- |
| Region | New York | Singapore |
| Host | `db-postgresql-nyc1-73197-do-user-11203048-0.j.db.ondigitalocean.com` | `db-pgsql-sgp1-66937-do-user-11203048-0.i.db.ondigitalocean.com` |
| Database | `defaultdb` | `defaultdb` |
| Port | `25060` | `25060` |
| PostgreSQL | 17.11 | 18.6 |
| Environment file | `.env.development` | `.env copy.development` |

The copy environment file contains the new credentials and is ignored by Git.
It is not loaded automatically by `NODE_ENV=development`; the application loads
`.env.development`. The original development connection remains unchanged.

## Backup and restore procedure

PostgreSQL 18.6 client tools were installed using `brew install libpq`.
Executables are under `/opt/homebrew/opt/libpq/bin`.

Local artifacts are in this Git-ignored, restricted-access directory:

```text
.local-db-migrations/nyc-to-sgp-20260922-NY2SUw/
```

- `source.dump`: custom-format PostgreSQL schema and data backup.
- `backup.json`: archive checksum, size, and completion time.
- `dump.log` / `restore.log`: tool output.
- `source-manifest.json`: table counts and data hashes from the exported dump snapshot, plus schema and sequence information.
- `destination-manifest.json` / `verification.json`: restored database comparison.
- `migrate.cjs`: local helper reading credentials from the two environment files.

The dump uses an exported, repeatable-read snapshot and includes `public` and
`drizzle`, preserving the migration journal. Restore uses a single transaction
and stops on errors. It refuses a destination with existing user relations and
does not drop or overwrite them.

Ownership and ACLs are not copied; restored objects belong to the destination
`doadmin`. Restore skips database comments to avoid managed-extension ownership
restrictions. PostgreSQL cluster roles, provider settings, trusted sources,
connection pools, and external file storage are not transferred by this dump.

Verification compares every table's row count and canonical row-content hash,
column definitions, indexes, constraints, enums, and sequence state. It also
checks whether New York has changed since the dump; this check does not stop
future writes or turn a rehearsal into a final migration.

Logical restores renumber physical column slots left by previously dropped
columns and numeric enum sort weights. Verification ignores those internal
numbers while still comparing column definitions, relative column order, and
enum labels in their original relative order.

To rerun verification while the two environment files still point at their
original migration endpoints:

```bash
node .local-db-migrations/nyc-to-sgp-20260922-NY2SUw/migrate.cjs verify
```

## Final cutover still required

1. Stop all New York database writers, including development API instances,
   cron jobs, scripts, and external workers. Confirm payment callbacks will be
   retried or otherwise handled during the maintenance window.
2. Take a fresh source dump. This rehearsal archive cannot include later writes.
3. Restore the fresh dump into an empty destination. The current Singapore
   database now holds the rehearsal data: preserve it if needed, then explicitly
   arrange a fresh database or an approved replacement. The helper intentionally
   refuses to overwrite a populated database.
4. Repeat data/schema/sequence verification and application smoke tests against
   Singapore. Ensure DigitalOcean trusted sources permit the development VM.
5. Update the deployed development `DATABASE_URL` with the Singapore connection.
   Update local `.env.development` too if local tools should use Singapore.
   Account for a `DATABASE_URL` already set in the PM2/process environment: it
   takes precedence over the runtime dotenv file.
6. Restart the development server with the refreshed environment, then verify
   login, product listing, and the application's main database flows. Resume
   scheduled jobs only on the intended instance.
7. Keep the New York database and final backup for rollback. Once Singapore
   accepts writes, switching back to New York without reconciling new data would
   lose those writes.

No `db:generate:development` or `db:migrate:development` is needed just to move
the existing database. The dump carries its current schema and migration
history; any separate application schema upgrade should be handled separately.
