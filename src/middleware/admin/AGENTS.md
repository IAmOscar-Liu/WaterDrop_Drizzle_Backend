# Admin Middleware Guidelines

This folder owns Zod validation for admin APIs.

## Responsibilities

- Export feature validation schemas and compose them from `src/middleware/admin/index.ts`.
- Keep request body, query, and path validation here for admin routes.
- Match every admin router Swagger change with a validation schema change when applicable.

## Schema Style

- Reuse common helpers from `common.ts` for pagination, ids, dates, and shared primitives.
- Keep enum values aligned with `src/db/schema.ts`.
- Prefer explicit optional fields over loose passthrough objects.
- Keep validation messages clear enough for frontend debugging.

## Layer Boundary

- Do not call services or repositories from validation files.
- Put business state checks in services/repositories; put request-shape checks here.
