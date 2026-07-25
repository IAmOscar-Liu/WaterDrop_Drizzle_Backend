# DB Schema Guidelines

This folder owns Drizzle schema definitions, relations, inferred types, and database-facing structure.

## Responsibilities

- Treat `schema.ts` as the source of truth for tables, enums, relations, and inferred TypeScript types.
- Keep table names, column names, relation names, and enum values stable unless a migration is part of the task.
- Export `schema.X` and `schema.NewX` types through Drizzle inference rather than duplicating model interfaces elsewhere.

## Schema Changes

- If schema changes are required, update `schema.ts` first and then generate migrations with the intended environment in `drizzle.config.ts`.
- Do not hand-edit generated migration snapshots unless explicitly asked and the migration state is understood.
- Check nullable fields carefully because PostgreSQL unique indexes allow multiple `NULL` values unless the index is designed otherwise.

## Relations

- Add or update Drizzle relations when repositories need nested `db.query` reads.
- Keep relation names predictable and close to existing naming.
