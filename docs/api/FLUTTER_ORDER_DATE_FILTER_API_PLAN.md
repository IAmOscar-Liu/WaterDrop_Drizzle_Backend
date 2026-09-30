# Order History Date Range — Backend API Proposal

Status: proposed contract for BE review; no API or Flutter implementation is included.

## Current Flutter behavior (verified)

- Page: `lib/pages/order_page.dart` (`訂單記錄`). It currently has only a sort toggle: `由後到前` (default, `desc`) / `由前到後` (`asc`). No date filter is sent.
- API: `GET /api/order/list`, called by `loadOrders()` and `fetchMoreOrders()` in `lib/provider/order_provider.dart`.
- Initial request: `page=1&limit=10&order=desc`. Changing sort reloads page 1. Scrolling to the last order requests the next page until `totalPages` is reached.
- Authentication: the shared Dio interceptor attaches the current Bearer token when available.
- Expected response: `{ success: true, data: { orders, total, page, limit, totalPages } }`. Order objects already contain `createdAt`, `updatedAt`, and nullable `completedAt`.
- Both the order card and detail page display `completedAt ?? createdAt` as `訂單日期`. Parsed timestamps are converted to the device's local timezone by `ParseUtils.parseDateTime()`.

Only the Flutter repository was reviewed. The backend's current sort column, validation, database schema, and any existing undocumented date-filter support have not been verified.

## Proposed request contract

Extend the existing endpoint; keep its authentication and response schema.

| Query parameter | Type                      | Behavior                                                                                                                                                                                              |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`          | integer                   | Existing pagination; Flutter starts at 1.                                                                                                                                                             |
| `limit`         | integer                   | Existing pagination; Flutter sends 10. Preserve existing BE limits/defaults.                                                                                                                          |
| `order`         | `asc` / `desc`            | Preserve existing behavior for legacy requests. For filtered requests, order by `COALESCE(completedAt, createdAt)` in this direction, with `id` in the same direction as a deterministic tie-breaker. |
| `startDate`     | optional timestamp string | Inclusive lower bound: `COALESCE(completedAt, createdAt) >= startDate`.                                                                                                                               |
| `endDate`       | optional timestamp string | Exclusive upper bound: `COALESCE(completedAt, createdAt) < endDate`.                                                                                                                                  |

Date rules:

- Accept ISO 8601 / RFC 3339 timestamps with an explicit timezone (`Z` or numeric offset). Flutter sends UTC with `Z`.
- Reject date-only strings, timezone-less timestamps, empty values, and invalid calendar dates with HTTP `400`.
- Either bound may be omitted independently. Both omitted means the existing unfiltered behavior, without a new implicit date window.
- When both are present, require `startDate < endDate` after converting to instants. Reject equal or reversed bounds with HTTP `400`.
- Do not introduce a new maximum range or forbid future bounds in this proposal. If BE needs a range limit, agree on and document it before FE implementation.
- Date filtering must retain the existing authenticated-user ownership restrictions and existing order eligibility rules.

### Which order date?

Product direction: **use `completedAt` first**, matching the existing `訂單日期` display. `createdAt` records when an order is initiated; the user may take another ten minutes to complete it. `completedAt` therefore better represents the intended order date.

Retain the existing fallback when `completedAt` is null: use `createdAt`. Filtering and filtered sorting must both use `COALESCE(completedAt, createdAt)`, the SQL equivalent of Flutter's `completedAt ?? createdAt`. This preserves visibility for eligible orders without a completion timestamp. Keep the UI label `訂單日期` and use the same label for the date filter.

For example, an order initiated on September 28 at 23:55 and completed on September 29 at 00:05 belongs to September 29. Its initiation date must not independently qualify it for a September 28 query once `completedAt` exists. Do not implement this as an OR between the two timestamp ranges.

BE should confirm its current sort expression. If it differs from `COALESCE(completedAt, createdAt)`, preserve legacy requests and explicitly agree on the filtered ordering above.

### Calendar dates and timezone

The user selects inclusive calendar dates in the device's local timezone, matching current timestamp display. FE converts the first day's local midnight and the midnight immediately after the last selected day to UTC. The API end bound is exclusive even though the last day selected in the UI is included.

Example: selecting **2026-09-01 through 2026-09-29** on a device in `Asia/Taipei` sends:

```http
GET /api/order/list?page=1&limit=10&order=desc&startDate=2026-08-31T16%3A00%3A00.000Z&endDate=2026-09-29T16%3A00%3A00.000Z
Authorization: Bearer <token>
```

This covers local `2026-09-01 00:00` up to, but excluding, local `2026-09-30 00:00`. Selecting just September 29 produces a full-day range, not equal API bounds.

FE must construct the next **calendar** midnight before converting to UTC, rather than adding a fixed 24 hours, so daylight-saving transitions are handled correctly. BE compares the provided instants and does not reinterpret them using the server timezone or the timezone saved at login. No additional timezone query parameter is needed.

## Backend processing and response

1. Validate and normalize the optional bounds.
2. Apply authenticated-user scope, existing eligibility rules, and date predicates to the same base query.
3. Count matching orders for `total` before pagination. Compute `totalPages` using the existing page-size rules.
4. Apply the agreed deterministic sorting, then paginate. Paginate orders before expanding one-to-many relationships so joined items do not duplicate orders or inflate the count.
5. Return existing order objects and the existing envelope unchanged. Do not silently ignore invalid filters or filter only the current page in memory.

Conceptual predicate (actual column names depend on BE schema):

```sql
WHERE <existing authenticated-user scope and eligibility predicates>
  AND COALESCE(completed_at, created_at) >= :startDate -- include only when supplied
  AND COALESCE(completed_at, created_at) < :endDate    -- include only when supplied
ORDER BY COALESCE(completed_at, created_at) DESC, id DESC
```

For `asc`, reverse both sort directions. Review the query plan for the actual user-scope predicate, the `COALESCE` expression, and the tie-breaker. Evaluate an expression index or an indexed generated column if supported and needed; choose the index after checking the schema and workload.

No-match response proposal:

```json
{
  "success": true,
  "data": {
    "orders": [],
    "total": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 0
  }
}
```

For invalid bounds, use the documented validation envelope already present in `FLUTTER_COIN_LEDGER_API_CHANGES.md`, for example:

```json
{
  "success": false,
  "statusCode": 400,
  "message": [
    {
      "field": "endDate",
      "message": "endDate must be later than startDate."
    }
  ]
}
```

BE should confirm that this is also the order endpoint's validation convention. The current FE error helper stringifies `message`; FE should extract field messages for readable validation feedback rather than display the raw array.

## Flutter follow-up plan

1. Add a date-range selector and clear action alongside sort in `order_page.dart`. Default to all dates; cancelling the picker leaves the active range unchanged. Keep controls accessible during loading and errors. Use `此期間內沒有訂單` for an empty filtered result.
2. Extend `loadOrders({String? order, DateTime? startDate, DateTime? endDate})`; document that these provider arguments are API bounds, with an exclusive end. Store the normalized active bounds and sort in the notifier. Calling without bounds clears the filter.
3. Use one query builder for initial and subsequent pages, omitting absent bounds and always normalizing sort to `asc` or `desc`. Every page must use the same active range.
4. Applying/clearing a range or changing sort resets page 1 and replaces the list. Sort changes retain the active range; pagination retains both sort and range.
5. Ignore stale responses from earlier queries using a request-generation identifier (including pagination responses). Advance the committed page only after a successful request. The current implementation increments before requesting, which can skip a page after a failure.
6. Keep existing page-entry behavior: reopening the page starts with descending sort and all dates. Ensure the persistent notifier is reset to the page's active query.
7. Keep list/detail `訂單日期` labels and their existing `completedAt ?? createdAt` display. Label the filter `訂單日期` too, and handle structured validation messages.

## Acceptance checks and rollout

- No date parameters: existing callers still receive the same eligible orders and legacy sorting.
- Start-only, end-only, and two-bound queries: each returns only matching orders.
- Boundary fixtures: include an order exactly at the start; exclude an order exactly at the end; include an order just before the end.
- When `completedAt` exists, use it even if `createdAt` falls on a different day or on the other side of a range boundary. Test both creation-in-range/completion-outside and creation-outside/completion-in-range cases.
- When `completedAt` is null, filter and sort using `createdAt`. Once the order completes, a fresh query uses `completedAt` and may place it in a different date range or position.
- Same-day selection, month/year rollover, equivalent offset/UTC timestamps, and local daylight-saving transitions produce the expected range.
- Reject invalid dates, missing timezone, empty values, equal bounds, and reversed bounds with HTTP `400`.
- `total` and `totalPages` describe all matching orders; an empty result is HTTP `200` with an empty list.
- Identical effective order timestamps (`completedAt ?? createdAt`) have deterministic ordering in both directions. Test multiple pages against a fixed dataset. Existing offset pagination does not promise snapshot consistency during concurrent inserts or updates to `completedAt`.
- A user cannot retrieve another user's orders by changing bounds.
- FE preserves filters during sorting/pagination, clears them correctly, retries the same page after failure, and ignores stale responses after range changes.

The date basis is completion first, with the existing creation-time fallback. Confirm BE support for this expression, filtered sorting, the validation envelope, and the proposed timezone/boundary semantics. Deploy the backward-compatible API extension first, validate it in staging, then release the Flutter filter UI. Backend implementation and runtime verification remain outstanding.
