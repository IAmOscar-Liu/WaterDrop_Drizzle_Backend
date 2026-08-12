# Middleware Guidelines

This folder owns request middleware, authentication checks, error handling, and non-admin validation helpers.

## Responsibilities

- Keep middleware focused on request concerns: authentication, validation, parsing guards, and error handling.
- Use `validateZod` for Zod-backed validation.
- Avoid DB writes from middleware unless the middleware already owns that concern and existing code follows the same pattern.

## Validation

- Put reusable request validation in middleware instead of controllers.
- Keep schema names close to route intent, for example `createRefund` or `updateDelivery`.
- Validate params, query, and body separately when the route needs all three.
- Coerce strings from query/params carefully, especially numbers, dates, booleans, and enums.

## Error Behavior

- Let validation failures return through the shared validation/error path.
- Do not swallow authentication or validation failures and continue to controllers.
