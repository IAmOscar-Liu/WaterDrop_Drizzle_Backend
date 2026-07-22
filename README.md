# Waterdrop Server

Express + TypeScript API server for Waterdrop.

## Folder Structure

```txt
src/
  index.ts              App entry point: middleware, Swagger, routers, jobs
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
drizzle_stg/
drizzle_prod/
```

`drizzle.config.ts` controls:

- which `.env.<env>` file is loaded
- which migration folder is used
- the database URL
- the schema path

Important: when changing environments for Drizzle commands, check `drizzle.config.ts`. The current config uses a hardcoded `env` value.

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

## Validation Before Handoff

At minimum, run:

```bash
npm run build
```

For API changes, also check the relevant Swagger block in `src/routers/admin` and test the route manually or through Swagger UI at:

```txt
/api-docs
```
