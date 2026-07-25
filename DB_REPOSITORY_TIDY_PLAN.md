# DB Repository Tidy Plan

## Goal

Make `src/repository/` consistent enough that future API work is predictable, concurrency-safe, and easy to review, without forcing a risky all-at-once rewrite.

This plan is intentionally about repository and DB-access conventions only. It does not change the route/controller/service contract by itself.

## Implementation Log

- 2026-07-25: Added shared query helpers in `src/repository/utils/query.ts`.
- 2026-07-25: Migrated `src/repository/notification.ts` list pagination/filter construction to the shared helpers without changing its API response shape.
- 2026-07-25: Migrated `src/repository/collection.ts` list pagination/filter construction to the shared helpers without changing its API response shape.
- 2026-07-25: Migrated `src/repository/account.ts` account-list pagination/filter construction to the shared helpers without changing its API response shape.
- 2026-07-25: Migrated `src/repository/product.ts` product-list pagination/filter construction to the shared helpers without changing its API response shape.
- 2026-07-25: Migrated `src/repository/advertisement.ts` advertisement-list pagination/filter construction to the shared helpers without changing its API response shape.
- 2026-07-25: Wrapped `src/repository/delivery.ts` delivery creation/update multi-write flows in transactions and moved delivery notification sending after the update transaction commits.
- 2026-07-25: Wrapped `src/repository/account.ts` account-parent assignment in a transaction with account row locks and parent-group lookup by `parentId`.
- 2026-07-25: Updated `src/repository/order.ts` order-status cart cleanup to use the existing order transaction instead of calling the cart repository through the global `db`.
- 2026-07-25: Extracted pure ECPay string validation helpers into `src/lib/ecpayValidation.ts` and removed repository imports from `src/services`.
- 2026-07-25: Moved delivery-update notification side effects out of `src/repository/delivery.ts`; services/polling now send notifications after repository transactions return notification context.
- 2026-07-25: Moved refund-created chat-message side effects out of `src/repository/refund.ts`; `src/services/refund.ts` now sends fire-and-forget chat messages after the refund transaction returns chat context.
- 2026-07-25: Wrapped `src/repository/chatroom.ts` chat-room find-or-create flow in a transaction with a per-user row lock, normalized nullable lookup fields, inserted `orderId` directly, and made inactive-room reactivation return a single room object.
- 2026-07-25: Removed ordinary repository `console.log` noise from active repository files; historical logs remain only under `src/repository/backup/`.
- 2026-07-25: Added transaction-aware advertisement balance spending and updated `src/repository/treasureBox.ts` video completion to use one transaction for daily stat, ad view, ad balance, and treasure-box changes.
- 2026-07-25: Wrapped user creation, referral group join, and daily-stat get-or-create flows in transactions with row locks where the code reads before deciding to mutate.
- 2026-07-25: Migrated remaining active list pagination/filter math in `delivery.ts`, `refund.ts`, `chatroom.ts`, and `order.ts` to the shared query helpers.

## Current State Summary

The repository folder currently mixes several valid Drizzle patterns, but without clear rules for when to use each:

- `db.query.<table>.findFirst/findMany` is used for relation-heavy reads.
- `db.select().from(...)` is used for joins, aggregates, list counts, and some simple lookups.
- Some multi-step writes use `db.transaction`, while others perform multiple writes sequentially outside a transaction.
- Some repositories call other repositories or services directly, for example order/cart interaction, product/ECPay validation, delivery notifications, and refund/chat messages.
- Some repository methods include side effects such as notifications, chat messages, and `console.log`.
- Error behavior differs by file: some missing rows return `undefined` or `null`, while others throw `CustomError`.
- Pagination/list query shape is repeated manually across many repositories.
- Generated backup files under `src/repository/backup/` contain old patterns and should not influence new conventions.

## Target Conventions

### 1. Query API Selection

Use `db.query.<table>` for simple entity reads where Drizzle relations express the shape cleanly.

Good fit:

- `getById` with `with` relations
- simple `findFirst`
- relation trees such as product categories, chat history, order detail

Use `db.select().from(...)` for query-builder cases.

Good fit:

- aggregates: `count`, `sum`, grouped stats
- custom joins
- computed fields
- dynamic filter arrays
- row locks via `.for("update")`
- paginated list APIs that need a separate count query

Avoid mixing both styles inside the same function unless there is a concrete reason, such as inserting with query builder and reloading a relation graph with `tx.query`.

### 2. Transaction Rules

Use a transaction when a function performs more than one DB write, or performs read-validate-write logic that can race.

Required transaction cases:

- insert parent plus child rows
- update one table and write a log table
- validate stock/refund/coins and then mutate rows
- any operation using `.for("update")`
- read existing row, decide, then insert/update, when uniqueness or balances matter

Single atomic SQL writes do not need a transaction by default.

Examples:

- `insert(...).returning()` for one row: no transaction needed
- `update ... where id = ... returning`: no transaction needed
- create delivery plus delivery log plus order-item updates: should be one transaction
- account parent assignment with group creation and account update: should be one transaction

### 3. Locking Rules

Use `.for("update")` inside transactions when a row is read to make a decision before mutation.

Important candidates:

- order status transitions
- product stock/reserve changes
- refund quantity checks
- coin balance and monthly coin stat changes
- advertisement balance spending
- find-or-create flows where duplicates matter

When locking multiple rows, sort ids first to reduce deadlock risk.

### 4. Repository Boundaries

Repositories should own DB persistence and DB-shaped transformations.

Prefer not to import services from repositories. Current examples to unwind:

- `src/repository/product.ts` imports `../services/ecpay`
- repository functions triggering notifications directly
- repository functions sending chat messages directly

Target layering:

```txt
controller -> service/orchestrator -> repository
```

Repositories may import small pure helpers from `lib/`, but cross-feature workflow orchestration should move to service-level functions.

Acceptable repository-to-repository calls are narrow DB helpers, but avoid calling a helper that opens its own transaction from inside another transaction. Prefer transaction-aware helper functions that accept `tx`.

### 5. Side Effects

Side effects should happen after the DB commit unless the side effect itself is stored in the database.

Examples:

- Push notifications: service after repository success
- Chat messages: service/orchestrator after refund creation, or a transaction-aware outbox row
- Email: service after state update

For fire-and-forget side effects, always attach `.catch(...)` and log the failure. Longer term, prefer an outbox table for guaranteed retry.

### 6. Error Semantics

Use consistent method naming to communicate missing-row behavior.

Suggested convention:

- `findX(...)`: returns `undefined` or `null` when not found
- `getX(...)`: throws `CustomError("X not found", 404)` when not found
- `listX(...)`: returns empty arrays, never 404
- `create/update/deleteX(...)`: throws `CustomError` for failed business expectations

Repository methods should throw `CustomError` for expected business failures. Services should keep the existing `handleServiceError` pattern.

### 7. List/Pagination Shape

Standardize list params and response shape:

```ts
type ListParams = {
  page?: number;
  limit?: number;
};

type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};
```

Existing API keys such as `orders`, `refunds`, or `products` can stay for backward compatibility, but new internal helpers should share the same pagination math.

Recommended helper:

```ts
function getPagination(page = 1, limit = 10) {
  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}
```

### 8. Dynamic Filters

Use `SQL[]` filter arrays consistently:

```ts
const conditions: SQL[] = [];

if (status) {
  conditions.push(eq(table.status, status));
}

const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
```

Avoid passing arrays with `undefined` unless the local file has a clear, tested pattern for it.

### 9. Return Shapes

Repository methods should return DB/domain data, not `ServiceResponse`.

Controllers should not know Drizzle shapes beyond request parsing. Services should decide how to combine repository calls and map errors.

For relation-heavy returned data, keep small formatter functions near the repository query, for example `formatRefundRow`.

### 10. Logging

Replace repository `console.log` with one of:

- no log for ordinary CRUD
- structured logger helper, if added later
- service-level log around workflows

Repository logs should not become the main signal for business behavior.

## Proposed Shared Utilities

Add these gradually under `src/repository/utils/` or `src/lib/db/`:

- `pagination.ts`: `getPagination`, `getTotalPages`
- `filters.ts`: helpers for optional date range and pagination filters
- `transactions.ts`: shared DB/transaction type and helper types
- `errors.ts`: optional `assertFound(row, message)`

Potential transaction type:

```ts
type DbClient = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = DbClient | Tx;
```

Use this only where helper functions need to work both inside and outside a transaction.

## Migration Phases

### Phase 1: Document and Guard

- Add this plan.
- Keep new code following the target conventions.
- Stop adding new service imports inside repositories.
- Stop adding multi-write repository methods without transactions.
- Ignore `src/repository/backup/` for future examples.

### Phase 2: Low-Risk Utility Extraction

- Add pagination helpers.
- Add filter helpers for date ranges and common list params.
- Update list methods one file at a time.
- Do not change response shapes during this phase.

Suggested order:

1. `notification.ts`
2. `collection.ts`
3. `cart.ts`
4. `account.ts` list methods

### Phase 3: Transaction Safety Pass

Review and update multi-step writes that currently run outside transactions.

Priority candidates:

- `delivery.createDelivery`
- `delivery.updateDelivery`
- `account.assignAccountParent`
- notification mark/delete flows if future behavior adds related writes
- chat room find-or-create flow, especially around unique constraints and inactive room reactivation

Acceptance criteria:

- all parent/child writes commit or rollback together
- read-validate-write paths use row locks where needed
- transaction functions do not call helpers that use the global `db` for related writes

### Phase 4: Workflow Side-Effect Separation

Move side effects out of repository methods into services or a dedicated workflow/orchestrator layer.

Priority candidates:

- delivery notifications from `delivery.ts`
- refund chat message fire-and-forget logic from `refund.ts`
- product ECPay validation import from `product.ts`
- order/cart cross-feature behavior in `order.ts`

Possible target shape:

```txt
repository/order.ts       DB writes only
services/order.ts         business workflow and side effects
repository/cart.ts        cart DB helpers
services/orderWorkflow.ts optional orchestration if services grow too large
```

### Phase 5: Naming and Error Semantics

Rename methods only when touching related API behavior or when call sites are small.

Examples:

- `getX` should throw on missing row
- `findX` should return nullable
- `listX` should return collection shape

Avoid a broad rename-only PR unless there is test coverage or strong IDE support for all call sites.

Current recommendation: keep broad `find/get/list` renames as a follow-up review item rather than a same-pass refactor. Several public services infer response types from repository return types, so rename-only churn should happen next to endpoint-specific tests or an explicit API cleanup.

### Phase 6: Query Style Normalization

Normalize each repository file internally.

Use `db.query` for entity graph reads. Use query builder for lists, aggregates, locks, and custom joins. Add a short comment only when a function intentionally mixes both.

Current status: active repository list pagination uses the shared helper. Some functions intentionally mix query builder writes with `tx.query` relation reloads so they can return the existing nested response shape.

Suggested order:

1. `notification.ts`
2. `collection.ts`
3. `cart.ts`
4. `account.ts`
5. `product.ts`
6. `advertisement.ts`
7. `chatroom.ts`
8. `delivery.ts`
9. `order.ts`
10. `refund.ts`
11. `user.ts`
12. `treasureBox.ts`

## Repository-Specific Notes

### `account.ts`

- `assignAccountParent` should be transactional because it may create an account group and update an account.
- `getAccountById` throws, so callers should not check for falsy return afterward.
- Password hashing is repository-adjacent but could stay unless auth workflows are refactored.

### `advertisement.ts`

- Creation and balance mutation transactions are good examples.
- List functions use query builder appropriately for joins and aggregates.
- Consider moving ad-balance business workflows to service if they become cross-feature.

### `cart.ts`

- Simple CRUD is mostly fine.
- `toggleCartItem` checks by `productId` only; verify whether user scoping is intended before refactoring.
- Logging can be removed or moved up.

### `chatroom.ts`

- `sendChatMessage` transaction is appropriate.
- `findOrCreateChatRoom` should be made concurrency-safe around the unique index.
- Consider adding transaction-aware internal helpers if refund/order workflows need to create messages atomically.

### `delivery.ts`

- `createDelivery` and `updateDelivery` are high-priority transaction candidates because they write delivery, logs, order items, and trigger notification behavior.
- Notification sending should move after commit.

### `notification.ts`

- Good low-risk file for introducing pagination and filter helpers.
- No transaction needed for current single-table operations.

### `order.ts`

- Transaction use is generally necessary and should remain.
- Avoid calling `upsertCartItem` from inside order transaction because it uses global `db`.
- Extract coin/stat/product stock helpers that accept `tx`.

### `product.ts`

- Create/update product transactions are appropriate.
- Repository imports service-level ECPay validation; move this to pure helper or service layer.
- Remove unused service import if still present during cleanup.

### `refund.ts`

- Transaction and row locks are appropriate for refund quantity and coin mutation.
- Fire-and-forget chat side effect should eventually move to service/orchestrator or outbox.
- Keep shared refund amount/quantity validation in repository or pure helper.

### `treasureBox.ts`

- Transaction use is appropriate for award/open flows.
- Calls into advertisement repository should be checked for transaction boundaries.
- Logging is heavy and should move to structured workflow logs.

### `user.ts`

- Several coin/stat operations need careful transaction and locking review.
- Bank-account update timeout logic is business-specific; keep close to repository only if it is purely data invariant.

## Acceptance Checklist

Use this checklist for each repository file during cleanup:

- [ ] Every multi-write operation is inside one transaction.
- [ ] Every read-validate-write operation is race-safe or explicitly documented as low risk.
- [ ] No repository imports from `src/services`.
- [ ] Side effects happen after commit or are represented as DB rows.
- [ ] Missing-row behavior matches function name.
- [ ] List functions use shared pagination math.
- [ ] Dynamic filters use a consistent `SQL[]` pattern.
- [ ] Logs are removed, moved, or intentionally kept.
- [ ] `npm run build` passes.

## Non-Goals

- No schema or migration changes are required for the first cleanup pass.
- No API response shape changes unless explicitly planned.
- No mass formatting churn.
- No Docker Compose documentation changes.
