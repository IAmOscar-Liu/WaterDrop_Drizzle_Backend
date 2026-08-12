# Controller Layer Guidelines

This folder adapts Express requests into service calls. Keep controllers thin and predictable.

## Responsibilities

- Read `req.params`, `req.query`, `req.body`, and authenticated ids from the request.
- Coerce simple primitives when needed, such as `Number(req.query.page)` or date parsing.
- Call the matching service method.
- Respond through `sendJsonResponse`.

## Boundaries

- Do not put DB queries in controllers.
- Do not duplicate business validation that belongs in Zod middleware or services.
- Do not return raw thrown errors directly; let services produce `ServiceResponse` and use the shared response helper.

## API Changes

- For admin APIs, make sure the matching router Swagger and `src/middleware/admin` Zod schema are updated in the same task.
- Keep request parsing aligned with route validation. If a new body/query/path field is added, wire it through controller, service, and repository deliberately.
- Preserve existing response shapes unless the task explicitly changes the frontend contract.
