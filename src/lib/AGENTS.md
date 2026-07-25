# Lib Guidelines

This folder owns shared utilities, third-party clients, schedulers, notification helpers, and pure domain helpers.

## Responsibilities

- Put reusable pure helpers here when they are shared across services/repositories.
- Keep third-party client setup centralized, for example Firebase, SendGrid, Cloudflare, and ECPay helpers.
- Keep environment access through the existing env/init helpers rather than reading scattered process variables.

## Boundaries

- Pure helpers may be imported by repositories.
- Helpers that trigger side effects should usually be called from services, scheduled jobs, or controllers designed for callbacks.
- Avoid importing repositories into generic utility files unless the file is explicitly a workflow/job module.

## Error And Logging

- Throw `CustomError` for expected application errors when the helper is part of request handling.
- Keep logging concise and useful for operational jobs; avoid noisy logs in pure helpers.
