# Waterdrop Server

Express + TypeScript API server for Waterdrop.

## Folder Structure

```txt
src/
  app.ts                Express middleware, Swagger, and routers
  index.ts              Runtime entry point: starts jobs and HTTP listener
  routers/              Public and user-facing route definitions
  routers/admin/        Admin route definitions and Swagger docs
  controller/           Parses request data and calls services
  services/             Service response wrappers and business workflow calls
  repository/           Database access with Drizzle ORM
  db/schema.ts          Drizzle table, enum, relation, and type definitions
  middleware/           Auth, validation, error handling
  middleware/admin/     Zod validation schemas for admin APIs
  lib/                  Shared helpers, env, Swagger, integrations
  constants/            Static constants used by services/repositories
  type/                 Shared TypeScript request/response types
  assets/               Static assets and local JSON data
  seed/                 Seed scripts
```

## Admin APIs For Frontend

Admin routes live in `src/routers/admin`.

`src/routers/admin/index.ts` mounts each admin module under `/api/admin`:

```txt
/api/admin/account
/api/admin/product
/api/admin/advertisement
/api/admin/order
/api/admin/delivery
/api/admin/refund
/api/admin/file
/api/admin/chatroom
/api/admin/system
```

Each `admin-*.ts` file usually contains:

- Express route definitions
- Auth middleware, usually `isAuth`
- Zod request validation via `validateZod`
- Swagger JSDoc for frontend-facing API docs

Example route flow:

```txt
src/routers/admin/admin-refund.ts
  -> src/controller/refund.ts
  -> src/services/refund.ts
  -> src/repository/refund.ts
  -> src/db/schema.ts
```

Request validation for admin APIs lives in `src/middleware/admin`. For example:

```txt
src/middleware/admin/refund.ts
```

Frontend developers should mainly read:

- `src/routers/admin/admin-*.ts` for paths, methods, Swagger docs, request bodies, and query params
- `src/middleware/admin/*.ts` for exact validation rules
- `/api-docs` when the server is running for Swagger UI

## Drizzle ORM

Database schema is defined in:

```txt
src/db/schema.ts
```

This file contains:

- PostgreSQL tables via `pgTable`
- enums via `pgEnum`
- indexes and primary keys
- Drizzle relations
- inferred TypeScript types such as `Order`, `NewOrder`, `RefundItem`

Repository files in `src/repository` use Drizzle queries against this schema.

Migration output folders are environment-specific:

```txt
drizzle_local/
drizzle_dev/
drizzle_test/
drizzle_stg/
drizzle_prod/
```

`drizzle.config.ts` controls:

- which `.env.<env>` file is loaded
- which migration folder is used
- the database URL
- the schema path

Select the environment explicitly with the matching `db:generate:*`,
`db:migrate:*`, or `db:studio:*` command. The unsuffixed command defaults to
local.

Advertisement-assignment cleanup accepts these optional environment settings:

```txt
ADVERTISEMENT_ASSIGNMENT_COMPLETED_RETENTION_DAYS=365
ADVERTISEMENT_ASSIGNMENT_EXPIRED_RETENTION_DAYS=7
COIN_LEDGER_MAINTENANCE_CONCURRENCY=5
DATABASE_CLEANUP_BATCH_SIZE=5000
DEVICE_TOKEN_RETENTION_DAYS=60
IDEMPOTENCY_KEY_RETENTION_DAYS=3
COIN_LEDGER_JOB_RUN_RETENTION_DAYS=90
```

The completed retention is the audit window. Leftover `issued` assignments are
first marked `expired` after their snapshotted user-local date ends, then use the
shorter expired retention before physical deletion. Both values are
non-negative whole days.

Coin-ledger maintenance uses bounded concurrency for independent records. Set
`COIN_LEDGER_MAINTENANCE_CONCURRENCY` to a positive whole number that does not
exceed the available PostgreSQL connection capacity.

Operational cleanup deletes at most `DATABASE_CLEANUP_BATCH_SIZE` rows per
table and run. Device tokens and idempotency keys retain their existing 60-day
and 3-day defaults. Coin-ledger job-run records are diagnostic rather than
financial data and default to 90 days. Cleanup jobs use both in-process overlap
protection and PostgreSQL advisory locks across server instances.

## Essential Commands

Install dependencies:

```bash
npm install
```

Run local development server:

```bash
npm run dev
```

Run development or staging server with nodemon:

```bash
npm run dev:dev
npm run dev:stg
```

Run without cron jobs for development or staging:

```bash
npm run dev:dev-no-cron
npm run dev:stg-no-cron
```

Build TypeScript:

```bash
npm run build
```

Start compiled server:

```bash
npm run start:local
npm run start:dev
npm run start:stg
npm run start
```

Generate Drizzle migrations from schema changes:

```bash
npm run db:generate
```

Run migrations:

```bash
npm run db:migrate
```

Open Drizzle Studio:

```bash
npm run db:studio
```

Seed products:

```bash
npm run db:seed-products
```

Generate DBML:

```bash
npm run generate-dbml
```

## Automated Tests

Run the complete pre-push suite with:

```bash
npm test
```

The command first type-checks/builds the project, then reads the PostgreSQL
server from `.env.test`, creates a new temporary `*_test` database, applies
every migration in `drizzle_test`, and runs:

- coin/timezone unit tests;
- real HTTP API end-to-end tests against the Express app;
- repository/PostgreSQL coin-ledger integration tests;
- coin-ledger maintenance cron integration tests.

The temporary database is dropped in a `finally` cleanup whether the suite
passes or fails. The configured `waterdrop_coin_test` database is only used as
the connection template and is not populated or reset. The configured
PostgreSQL user must have `CREATE DATABASE` and `DROP DATABASE` privileges.

Smaller disposable-database suites are available while developing:

```bash
npm run test:api
npm run test:coin-ledger
npm run test:cron
npm run test:coin-accounting
```

Tests import `src/app.ts`, so they exercise the real routers, middleware,
controllers, services, and repositories without starting cron jobs or calling
the normal server entry point. Add new HTTP scenarios to
`src/tests/api.e2e.ts` as API coverage grows.

The API suite creates a virtual-item order and sends a locally generated,
validly signed mock ECPay payment webhook. No request is sent to ECPay. It
verifies that payment records coin usage by earning month, completes the refund
flow, and confirms that non-expired coins return to the original user lots and
monthly totals. Email delivery is a no-op in the test environment.

The cron suite invokes the same coin-ledger maintenance job used by the
scheduler. It verifies unclaimed treasure-box expiration, unused acquired-coin
expiration, seller returns, Taipei cohort settlement, assignment expiration and
retention cleanup, user balances, and job-run idempotency. ECPay logistics
polling and other external network jobs are not invoked.

## Validation Before Handoff

At minimum, run:

```bash
npm run build
npm test
```

For API changes, also check the relevant Swagger block in `src/routers/admin` and test the route manually or through Swagger UI at:

```txt
/api-docs
```
