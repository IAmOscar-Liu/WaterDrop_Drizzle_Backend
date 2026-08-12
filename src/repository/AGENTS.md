# Repository Layer Guidelines

This folder owns Drizzle database access and DB-shaped transformations. Keep workflow orchestration, HTTP concerns, and user-facing response wrapping in higher layers.

## Responsibilities

- Read and write tables defined in `src/db/schema.ts`.
- Return domain/DB data, not `ServiceResponse`.
- Throw `CustomError` for expected business failures such as missing required rows, invalid state transitions, insufficient stock, or invalid balances.
- Keep relation-heavy entity reads close to the query that shapes them.

## Drizzle Patterns

- Use `db.query.<table>.findFirst/findMany` for simple entity reads and relation graphs.
- Use query builder for lists, aggregates, joins, computed fields, and row locks.
- Use `schema.NewX` for insert inputs and `schema.X` for selected rows.
- Use helpers from `./utils/query` for pagination and optional filter composition.
- Prefer atomic SQL expressions for counters and balances, for example `sql`${table.value} + ${amount}``.

## Transactions And Locks

- Use `db.transaction` for multi-write flows and read-validate-write logic.
- Use `.for("update")` inside transactions when a row is read to decide whether/how to mutate it.
- Do not call a repository helper that opens its own transaction from inside another transaction. Add a transaction-aware helper instead, such as `someOperationWithTx(tx, input)`.
- When locking multiple rows of the same table, sort ids first to reduce deadlock risk.

## Boundaries

- Do not import from `src/services`.
- Avoid side effects such as push notifications, chat sends, email, or external API calls. Return context to the service layer and let the service trigger side effects after commit.
- Avoid ordinary `console.log` in repository files. Use errors for failures and service-level logging for workflow events.

## Naming

- Prefer `findX` for nullable lookups.
- Prefer `getX` when the function throws if missing.
- Prefer `listX` for collection responses.
- Avoid broad rename-only changes unless the affected service/controller/API surface is reviewed in the same task.
