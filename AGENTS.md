# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code. Entry point [`src/index.ts`](/Users/oscar/Desktop/my_code/drizzle/waterdrop-server/src/index.ts) wires middleware, Swagger, routers, and scheduled jobs. HTTP flow is organized by feature: `routers/`, `controller/`, `services/`, and `repository/`. Shared utilities live in `lib/`, `middleware/`, `constants/`, and `type/`. Static files and seed data are under `src/assets/` and `src/seed/`. Drizzle schema lives in `src/db/schema.ts`; generated migrations are stored in `drizzle_local/` and `drizzle_dev/`.

## Build, Test, and Development Commands
Use `npm run dev` to run the API locally with `NODE_ENV=local` and `nodemon`. Build TypeScript with `npm run build`, then start compiled output with `npm run start:local` or another `start:*` target. Database workflows use Drizzle: `npm run db:generate`, `npm run db:migrate`, and `npm run db:studio`. Utility scripts include `npm run db:test`, `npm run db:seed-products`, and `npm run test-script`.

## Coding Style & Naming Conventions
The codebase uses TypeScript with `strict` mode enabled. Follow the existing style: 2-space indentation, semicolons, double quotes, and named imports grouped at the top of each file. Use `PascalCase` for classes, `camelCase` for functions and variables, and lowercase feature filenames such as `src/services/order.ts` and `src/routers/order.ts`. There is no configured ESLint or Prettier, so run `npm run build` before submitting changes.

## Testing Guidelines
There is no dedicated Jest or Vitest suite in this repository. Treat `npm run build` as the minimum validation step, then run the smallest relevant script or endpoint flow for your change, for example `npm run db:test` for database connectivity or `npm run test-script` for local experiments. Add new test helpers under `src/` only when they are reusable and safe with local environment variables.

## Commit & Pull Request Guidelines
Recent commits use short snapshot-style messages such as `save current status@Mar. 18 22:05`. Prefer clearer, scoped messages instead, for example `feat: add order expiration cleanup` or `fix: validate product list query params`. Pull requests should include a concise summary, impacted routes or tables, environment or migration notes, and proof of validation. Include API examples or screenshots only when request or response behavior changes.

## Security & Configuration Tips
Environment files are selected by `NODE_ENV` and loaded near process startup. Keep secrets in `.env*` files only; never hardcode credentials or commit generated keys. When changing schema or environment names, update `drizzle.config.ts` and the corresponding `.env.<env>` file together.
