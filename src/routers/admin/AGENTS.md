# Admin Router Guidelines

Admin routes are mounted under `/api/admin` by `src/routers/admin/index.ts` and are important frontend integration contracts.

## Responsibilities

- Register admin route paths and HTTP methods.
- Use `isAuth` unless nearby admin routes intentionally do otherwise.
- Use `validateZod` with schemas from `src/middleware/admin`.
- Call controller methods only; do not put service or DB logic here.

## Swagger Requirements

For admin API changes, update Swagger in the same task. Include:

- path and method
- auth requirement
- params, query, and body schema
- enum values
- pagination fields
- response shape, including nested relation fields when returned
- business prerequisites such as order status, delivery status, or permission scope

## Naming

- Use `admin-<feature>.ts` for feature router files.
- Export an Express router as the default export, matching existing files.
