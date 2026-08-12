# Service Layer Guidelines

This folder coordinates application workflows between controllers, repositories, and side-effect helpers.

## Responsibilities

- Return `ServiceResponse<T>` from public service methods.
- Catch errors with `handleServiceError`.
- Keep controllers thin by handling business orchestration here.
- Trigger side effects after repository transactions complete, unless the side effect is itself stored as a DB row.

## Side Effects

- Push notifications, chat messages, emails, and third-party API calls belong here or in a dedicated workflow helper called from here.
- For fire-and-forget work, attach `.catch(...)` and log a concise failure message.
- If a side effect must be guaranteed/retried, prefer adding an outbox-style DB record over doing more work inside repositories.

## Repository Usage

- Call repository methods for persistence and DB-shaped reads.
- Do not rely on repository `console.log` output for business behavior.
- Avoid composing nested repository transactions indirectly. If a service needs one atomic workflow across multiple repository operations, add transaction-aware repository helpers first.

## Response Shape

- Preserve existing API response shapes unless the route/controller change explicitly requires a contract update.
- Services may map repository data into API-friendly messages, but large formatting should live in small helper functions near the service method.
