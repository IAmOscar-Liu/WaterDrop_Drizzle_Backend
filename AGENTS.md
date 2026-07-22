# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code. Entry point [`src/index.ts`](/Users/oscar/Desktop/my_code/drizzle/waterdrop-server/src/index.ts) wires middleware, Swagger, routers, and scheduled jobs. HTTP flow is organized by feature:

```txt
routers/     Express route definitions and Swagger JSDoc
controller/  Request parsing and service calls
services/    ServiceResponse wrappers and workflow orchestration
repository/  Drizzle database access
```

Shared utilities live in `lib/`, `middleware/`, `constants/`, and `type/`. Admin request validation lives in `src/middleware/admin/`. Static files and seed data are under `src/assets/` and `src/seed/`. Drizzle schema lives in `src/db/schema.ts`; generated migrations are stored in environment folders such as `drizzle_local/`, `drizzle_dev/`, `drizzle_stg/`, and `drizzle_prod/`.

## Admin API Conventions
Admin routes are especially important for frontend integration. They live in `src/routers/admin/` and are mounted by `src/routers/admin/index.ts` under `/api/admin`.

When adding or changing an admin API, update all relevant layers:

```txt
src/routers/admin/admin-<feature>.ts
src/middleware/admin/<feature>.ts
src/controller/<feature>.ts
src/services/<feature>.ts
src/repository/<feature>.ts
```

The router file should include Swagger JSDoc for frontend developers. The middleware file should include matching Zod validation. Keep request body/query/path validation in `src/middleware/admin`, not inside controllers unless there is a good reason.

Typical admin route flow:

```txt
admin router -> controller -> service -> repository -> db/schema.ts
```

Use `isAuth` for protected admin routes unless surrounding routes clearly do otherwise. Use `validateZod` with `adminValidation.<feature>.<schemaName>` for validated params, query, and body.

## Swagger & Frontend Handoff
Swagger is configured in `src/lib/swagger.ts` and served at `/api-docs`. Admin router files contain most frontend-facing API documentation.

For API behavior changes, update Swagger in the same turn as code changes. Include:

- path and method
- required and optional request fields
- enum values
- query filters and pagination
- response shape changes
- important business prerequisites, for example required order or delivery status

If a response includes nested relations from Drizzle, document the nested fields in the route schema or reference an existing component.

## Drizzle ORM Notes
`src/db/schema.ts` is the source of truth for tables, enums, relations, and inferred TypeScript types. Prefer Drizzle APIs over raw SQL except for small expressions such as atomic increments or aggregate sums.

Common patterns:

- Use `schema.NewX` for insert data and `schema.X` for selected rows.
- Use transactions for multi-step writes.
- Use `.for("update")` when validating and then mutating related rows that could be changed concurrently.
- For list filters, build `SQL[]` conditions and pass `conditions.length > 0 ? and(...conditions) : undefined`.

`drizzle.config.ts` currently uses a hardcoded `env` value. Before generating or migrating, check that it points to the intended environment and output folder. When schema changes require migrations, use:

```bash
npm run db:generate
npm run db:migrate
```

Do not hand-edit generated migration snapshots unless the user explicitly asks and you understand the migration state.

## Build, Test, and Development Commands
Use `npm run dev` to run the API locally with `NODE_ENV=local` and `nodemon`. Build TypeScript with:

```bash
npm run build
```

Start compiled output with `npm run start:local`, `npm run start:dev`, `npm run start:stg`, or `npm run start`.

Useful commands:

```bash
npm run dev
npm run dev:dev
npm run dev:dev-no-cron
npm run dev:stg
npm run dev:stg-no-cron
npm run build
npm run db:generate
npm run db:migrate
npm run db:studio
npm run db:seed-products
npm run test-script
```

This project does not use Docker Compose for normal development instructions. Do not add Docker Compose guidance to docs unless the user explicitly asks.

## Coding Style & Naming Conventions
The codebase uses TypeScript with `strict` mode enabled. Follow the existing style: 2-space indentation, semicolons, double quotes, and named imports grouped at the top of each file. Use `PascalCase` for classes, `camelCase` for functions and variables, and lowercase feature filenames such as `src/services/order.ts` and `src/routers/order.ts`.

There is no configured ESLint or Prettier. Avoid broad formatting churn. Run `npm run build` before submitting changes.

## Validation & Error Handling
Request validation uses Zod through `src/middleware/validateZod.ts`. Admin validation schemas are composed in `src/middleware/admin/index.ts`.

Service methods generally return `ServiceResponse` and catch errors with `handleServiceError`. Repositories may throw `CustomError` for expected business validation failures.

When adding controllers, keep them thin:

- read params/query/body
- coerce basic primitive values if needed
- call the service
- respond with `sendJsonResponse`

## Testing Guidelines
There is no dedicated Jest or Vitest suite in this repository. Treat `npm run build` as the minimum validation step, then run the smallest relevant script or endpoint flow for your change, for example `npm run db:test` for database connectivity or `npm run test-script` for local experiments.

Add new test helpers under `src/` only when they are reusable and safe with local environment variables.

## Git & Change Safety
The worktree may contain user changes. Do not revert unrelated changes. If a file has user edits, preserve them and make the smallest compatible change.

Avoid destructive commands such as `git reset --hard`, `git checkout --`, or deleting files unless the user clearly asks for that exact operation.

## Security & Configuration Tips
Environment files are selected by `NODE_ENV` at runtime and by `drizzle.config.ts` for Drizzle commands. Keep secrets in `.env*` files only; never hardcode credentials or commit generated keys. When changing schema or environment names, update `drizzle.config.ts` and the corresponding `.env.<env>` file together.
