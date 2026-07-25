# Router Layer Guidelines

This folder owns Express route registration and frontend-facing API documentation.

## Responsibilities

- Define route paths, HTTP methods, middleware order, and controller handlers.
- Keep routers thin. Do not parse business data or call repositories here.
- Use `isAuth` for protected user routes unless surrounding routes clearly use another pattern.
- Put validation middleware before controller handlers.

## Swagger

- Update Swagger JSDoc whenever request or response behavior changes.
- Include required and optional fields, enum values, query filters, pagination fields, and important business prerequisites.
- Keep documented response shapes aligned with the controller/service output.

## Route Flow

Typical flow:

```txt
router -> validation/auth middleware -> controller -> service -> repository
```

When adding a feature route, wire all touched layers in the same task so the API is actually callable.
