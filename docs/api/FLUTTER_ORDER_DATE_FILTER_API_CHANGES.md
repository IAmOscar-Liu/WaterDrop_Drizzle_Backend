# Flutter order history date filter — backend handoff

Date: 2026-09-29

Status: implemented in this backend worktree and verified with local API integration tests against a disposable PostgreSQL database. Deployment and staging verification remain pending. Flutter implementation is outside this repository.

This implements the contract in [FLUTTER_ORDER_DATE_FILTER_API_PLAN.md](FLUTTER_ORDER_DATE_FILTER_API_PLAN.md). The backend confirms completion-first filtering, deterministic filtered sorting, explicit-timezone bounds, and the proposed structured validation envelope.

## Endpoint and request

`GET /api/order/list`

Authentication: `Authorization: Bearer <token>` (existing app user token).

| Query | Contract |
| --- | --- |
| `page` | Existing page number; default `1`. Flutter should send positive integers. |
| `limit` | Existing page size; default `10`. No new page-size cap. |
| `order` | Send `asc` or `desc`; default `desc`. Existing behavior is retained: only `asc` selects ascending order. |
| `startDate` | Optional ISO 8601 timestamp with `Z` or numeric offset `±HH:MM`. Inclusive lower bound. |
| `endDate` | Optional ISO 8601 timestamp with `Z` or numeric offset `±HH:MM`. Exclusive upper bound. |

Either date bound may be omitted independently. Omit both to clear the date filter and retrieve all eligible dates. Do not send an empty string or the literal string `null`. There is no maximum range or restriction on future bounds. Fractional seconds from Flutter timestamps are preserved when normalizing offsets to UTC and passing bounds to PostgreSQL.

Orders belong to the authenticated user and are restricted to **`paid` and `payment-processing`** for both filtered and unfiltered requests. This restriction applies to results and totals. The previous `statusIn` override has been removed: `statusIn` and `status` query parameters are ignored and cannot change these two eligible statuses. Flutter should omit those parameters. Pagination and sort handling outside the new date fields retain their existing behavior.

## Date basis and sorting

The effective order date is **`completedAt ?? createdAt`**, implemented with SQL `COALESCE(completed_at, created_at)` for both date filtering and filtered sorting.

- Include an order exactly at `startDate`.
- Exclude an order exactly at `endDate`.
- When `completedAt` exists, `createdAt` does not independently qualify the order for the range.
- When `completedAt` is null, use `createdAt`.
- If either date bound is supplied, sort by the effective order date, then `id`, both in the requested direction.
- Without either bound, retain the legacy `createdAt` sort. Consequently, clearing a filter can change the relative order of otherwise matching orders.

A fresh query can move an order to a different range or position after its completion timestamp is set. Existing offset pagination does not provide snapshot consistency during concurrent changes.

## Calendar dates and timezone

Keep the UI label `訂單日期` and display `completedAt ?? createdAt` in the device's local timezone.

For an inclusive local date selection, construct the first selected day's local midnight and the next calendar midnight after the last selected day. Convert both to UTC. Do not compute the end bound by adding a fixed 24-hour duration, because a daylight-saving day can have a different length. The backend compares instants without applying the server timezone or the timezone saved at login.

Example for **September 1–29, 2026 in Asia/Taipei**:

```http
GET /api/order/list?page=1&limit=10&order=desc&startDate=2026-08-31T16%3A00%3A00.000Z&endDate=2026-09-29T16%3A00%3A00.000Z
Authorization: Bearer <token>
```

Example query construction in Flutter:

```dart
final startLocal = DateTime(firstDay.year, firstDay.month, firstDay.day);
final endExclusiveLocal = DateTime(lastDay.year, lastDay.month, lastDay.day + 1);

final query = <String, dynamic>{
  'page': 1,
  'limit': 10,
  'order': 'desc',
  'startDate': startLocal.toUtc().toIso8601String(),
  'endDate': endExclusiveLocal.toUtc().toIso8601String(),
};
// Pass query as Dio queryParameters so offsets and punctuation are URL-encoded.
```

Selecting only September 29 in Taipei sends `startDate=2026-09-28T16:00:00.000Z` and `endDate=2026-09-29T16:00:00.000Z`. These bounds are different even for a single-day selection. No additional timezone parameter is needed.

## Response and errors

The success envelope and order objects are unchanged:

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

This is the HTTP `200` response when nothing matches. With matches, `orders` contains the existing order fields, nested `items` (including `variantAtSale` and `variantImage`), and `deliveries`. No new response field is required. `total` counts all matching orders before pagination; `totalPages = ceil(total / limit)`. Child items and deliveries do not inflate the count or duplicate orders. A page beyond the last page has an empty list but retains the matching total.

Invalid date fields return HTTP `400`, including empty values, date-only strings, missing timezones, impossible calendar dates, invalid times/offsets, and repeated values for one date field. When both bounds are supplied, `startDate` must be strictly earlier than `endDate` after timezone normalization. Equal instants expressed with different offsets are also rejected.

Example:

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

Read the `message` array and display each entry's `message` rather than stringifying the array. Missing or invalid authentication retains HTTP `401` behavior.

## Flutter integration checklist

1. Default to all dates and descending sort when entering the page. Keep the picker and notifier's active query in sync.
2. Add the date selector and clear action. Canceling the picker preserves the active range. Use `此期間內沒有訂單` for an empty filtered result.
3. Store UTC API bounds and sort in the provider. Use the same query builder for initial loading and pagination; omit absent bounds. Document the exclusive end bound in provider arguments.
4. Applying or clearing a range resets page 1 and replaces the list. Changing sort retains the range; pagination retains both range and sort.
5. Ignore stale responses with a request-generation identifier, including pagination responses. Commit a page increment only after success so retries request the same page.
6. Keep controls usable during loading and errors, and show readable structured validation messages.

## Verification and release

Passed locally:

```bash
npm run build
npm run test:order-date-filter
```

The new test command creates and migrates a disposable test database, calls the actual authenticated HTTP endpoint, and drops the database afterward. It covers legacy sorting, both one-sided filters, inclusive/exclusive boundaries, completion-first precedence, null completion fallback, offset equivalence, microsecond bounds, deterministic pagination in both directions, counts with multiple child records, empty results, invalid bounds, ownership, rejection of status override attempts, completion updates, and calendar rollover/DST-offset cases. Flutter UI behavior itself has not been tested here.

Swagger at `/api-docs` is reserved for admin frontend APIs. Flutter APIs are excluded; use this Markdown handoff for the app contract. The integration test also verifies that all published Swagger paths are under `/api/admin/`.

No schema migration is required. The current schema has no order-date expression index. The core filter/sort plan was inspected on the disposable fixture database; its small dataset uses a sequential scan and sort. This does not establish production performance. Before a high-volume rollout, profile representative staging requests and evaluate an index on `(user_id, COALESCE(completed_at, created_at), id)` against actual status filters and workload.

Release sequence: deploy this backend change, verify the examples and representative query performance in staging, then release the Flutter date filter UI. This handoff does not imply the API has already been deployed.
