# Flutter / BE error handling proposal

Status: BE error-contract implementation completed for app and admin APIs in source on 2026-11-04; Flutter presentation/model rollout remains proposed. See [BE feedback, implemented contract and code catalogue](FLUTTER_ERROR_HANDLING_FEEDBACK.md).

## Outcome

Keep navigation, filters and usable content visible when requests fail. Give the buyer a clear next action. Never display raw transport, database or provider errors in staging/production. Preserve existing payment, refund, notification and chat contracts.

## Findings from the current repositories

Flutter:

- `lib/shared/widgets/page_status.dart`: `PageError` is currently only centered error text.
- `lib/utils/exception_handler.dart`: `getDioExceptionMessage` forwards BE `message`, or falls back to the full Dio exception string. Several providers also stringify exceptions before returning them.
- Product, collection, message and chat list pages interpolate provider errors into their UI. This can expose technical details and gives inconsistent recovery options.
- Order history already has initial-load retry and a pagination error footer. Notification/chat synchronization also has retry/reconnection behavior. Preserve these mechanisms and standardize their presentation.
- Some pagination providers retain rows after failure but do not expose a separate pagination error. A page needs to distinguish initial, refresh, pagination and mutation failures.
- Category caches and request-generation guards already exist. Error handling must preserve them.
- `lib/app_flavor.dart` currently defines only `dev` and `stg`; unknown `FLAVOR` values fall back to `dev`. Production and unknown environments need an explicit, safe policy before enabling any development diagnostics.

BE repository: `/Users/oscar/Desktop/my_code/drizzle/waterdrop-server`.

- `src/lib/error.ts`: unknown service exceptions return HTTP 500 with `error.message`; expected `CustomError` instances can optionally have a code.
- `src/middleware/errorHandler.ts`: unhandled exceptions return `err.message`; validation errors currently use an array in `message`.
- `src/lib/general.ts`: `sendJsonResponse` sends service results directly. Fixing only the global middleware will not sanitize service responses.
- `src/middleware/isAuth.ts` can include token-validation exception text in a `CustomError` message.
- Some controllers, including ECPay, send responses directly. Provider callback acknowledgements and successful HTML responses require separate treatment.

## 1. Presentation rules owned by Flutter

| Situation                                                | Presentation                                                                                 | Recovery                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| First load fails; no usable data                         | Error panel inside the content area: icon, short title, one helpful sentence, primary action | Retry the same query; keep app bar and filters mounted                                 |
| Refresh fails; current-query data is available           | Keep rows and scroll position; show a compact stale-data notice or one snackbar              | Retry refresh; retain current cache                                                    |
| Loading the next page fails                              | Keep all loaded rows; show footer `載入失敗，點擊重試`                                       | Retry the same page/cursor, without clearing existing rows                             |
| User explicitly requested more data                      | The same footer; optionally one snackbar with `重試` action                                  | Footer and snackbar share the same guarded retry callback                              |
| Automatic pagination fails                               | Footer feedback; avoid repeated snackbars or an automatic retry loop                         | Wait for manual retry or a controlled reconnection retry                               |
| Action fails, e.g. delete/read/cart update               | Keep context and selection; show safe feedback, or field-specific errors in a form           | Preserve inputs; restore only optimistic changes that were not confirmed by the server |
| Resource was removed or access is unavailable            | Contextual explanation such as `此商品已下架或無法存取`                                      | Back/list/support action; no endless network retry                                     |
| Session expired after the existing token refresh attempt | One session-level prompt, not one per failed request                                         | Sign in again; discard old-session results                                             |
| Chat/notifications reconnect                             | Keep usable content and show the existing reconnect indicator                                | Let the SSE controller own reconnect/backoff; do not start another page retry loop     |

Suggested generic copy:

- Connection failure: `目前無法連線` / `請確認網路連線後再試。`
- Timeout: `連線逾時` / `回應時間較長，請稍後再試。`
- Service failure: `服務暫時無法使用` / `請稍後再試。`
- Refresh with existing data: `暫時無法更新，正顯示先前載入的資料。`

Keep visual styling consistent with the app's dark theme: readable text, a restrained status icon, spacing and a high-contrast retry button. Do not replace failures with an empty-list message.

## 2. Shared Flutter failure model

Normalize errors before they become strings. Proposed `AppFailure` fields:

- `kind`: connection, timeout, unauthenticated, forbidden, notFound, validation, conflict, rateLimited, unavailable, unknown or canceled.
- `code`, HTTP `statusCode`, optional `requestId`, optional retry delay, and safe field errors.
- A localized user message resolved by the client. Retain the original cause only for internal diagnostics.

Parsing priority: intentional cancellation -> transport type -> recognized BE code -> HTTP status -> safe generic fallback. Check `success:false` envelopes as well as non-2xx responses. Accept older envelopes and non-JSON proxy responses.

The networking layer normalizes failures, but **does not show global snackbars**. The page/operation chooses feedback so background requests, auth refresh and pagination cannot generate duplicate alerts.

Development diagnostics should require an explicit development environment, debug build and opt-in flag. Normal UI remains friendly in every environment. Staging/production, release builds and unknown environments must never display raw exception text, URLs containing tokens, stack traces or response bodies. A non-sensitive request reference may be offered for support.

## 3. Offline and retry behavior

- A timeout or Dio connection error does not prove the device is offline; the server, DNS or network path may be unavailable. Use neutral connection wording unless offline state is independently known.
- Network-interface availability is only a hint; Wi-Fi does not prove API reachability. A connectivity listener is optional and must not block requests solely because its status is uncertain.
- Show an offline/reconnecting banner when useful. Preserve valid, matching-query cached content. Clearly label older data shown after a failed refresh; do not silently bypass cache expiry indefinitely.
- No persistent offline storage is proposed in this phase. If no in-memory cache exists after app restart, show a recoverable error panel.
- On connectivity recovery, at most one refresh of the visible failed query; do not refetch every cached category. SSE controllers continue to manage their own recovery.
- Retry controls must prevent duplicate in-flight requests and keep query/session generation checks. Discard canceled/superseded requests silently.
- Pagination advances only after success. A failed page must be retried without skipping, duplicating or mixing another category's rows.
- Honor `Retry-After` for rate limits and temporary unavailability. Parse delta-seconds and HTTP-date values; offer a countdown or temporarily disabled retry action. Any automatic read retry is bounded and uses backoff/jitter.
- Avoid blanket automatic retries for mutations. A timeout may mean the server committed the action but the response was lost.
- Order/payment: retain the original order and idempotency key. Re-read authoritative order state before offering another payment; never treat closing a WebView or a timeout as cancellation/payment failure.
- Refunds: preserve the existing request UUID and exact payload when retrying an uncertain request.
- Message deletion/read: preserve canonical event-confirmed results; do not restore deleted/unread items merely because the HTTP response timed out.

## 4. BE proposal: compatible error contract

No new business endpoint is required. Standardize failures across middleware, service responses and direct controller responses.

Example of the proposed failure envelope:

```json
{
  "success": false,
  "statusCode": 503,
  "code": "SERVICE_UNAVAILABLE",
  "message": "Service temporarily unavailable",
  "requestId": "server-generated-correlation-id"
}
```

Proposed optional validation extension:

```json
{
  "fieldErrors": [
    {
      "field": "receiver.phone",
      "code": "INVALID_PHONE",
      "message": "Please enter a valid phone number"
    }
  ]
}
```

Contract rules:

1. Keep existing fields and existing business codes. Add stable codes where absent. Client behavior must not depend on parsing English exception text.
2. `message` must be safe for external clients in staging/production. Unknown exceptions become a generic message; do not expose SQL, database names, internal paths, JWT diagnostics, provider credentials or submitted sensitive values.
3. Existing validation `message` arrays and checkout `error` lists remain compatible during migration. Add `fieldErrors` rather than unconditionally changing `message` to a string. Sanitize legacy structures too.
4. Flutter uses local copy for recognized codes/statuses. Unknown codes or messages fall back safely; arbitrary BE `message` is not automatically displayed. Field errors need approved, user-safe codes/messages.
5. Actual HTTP status must match `statusCode`. Ordinary failures must not return HTTP 200. Flutter still tolerates legacy `success:false` with HTTP 200 during rollout.
6. Return `X-Request-ID` on responses, with the same `requestId` in JSON failures. Generate or validate the identifier server-side and include it in structured logs. Expose required headers through CORS where applicable.
7. Use the standard `Retry-After` header when BE can specify a cooldown, especially 429/503. Do not invent an offline error code for a request that never reached BE.
8. Log the diagnostic cause on BE with request reference and route template, using existing logging conventions and redacting tokens, credentials, cookies and personal data. Do not include raw bodies/query strings by default. Production API responses remain sanitized regardless of Flutter behavior.
9. Keep successful JSON response shapes unchanged. ECPay HTML success and provider webhook acknowledgement formats must retain their protocols. `/api/ecpay/new` validation failures should use the JSON contract; do not wrap payment callbacks in a generic JSON error envelope.
10. Pre-stream SSE handshake failures should use safe HTTP errors. After SSE headers are sent, retain the documented stream error/reset protocol; do not attempt to send a JSON HTTP response over the open stream.

Suggested common codes (new generic failures only; existing domain codes remain authoritative):

| HTTP        | Proposed generic code                                  | Flutter recovery                                          |
| ----------- | ------------------------------------------------------ | --------------------------------------------------------- |
| 400         | `VALIDATION_FAILED`                                    | Correct inputs; safe field messages                       |
| 401         | `UNAUTHENTICATED`                                      | Existing single token refresh, then sign-in recovery      |
| 403         | `FORBIDDEN`                                            | Explain unavailable action/access                         |
| 404         | `RESOURCE_NOT_FOUND`                                   | Contextual unavailable state                              |
| 409         | Existing domain code, otherwise `CONFLICT`             | Refresh/reconcile; not a generic automatic mutation retry |
| 429         | `RATE_LIMITED`                                         | Honor cooldown                                            |
| 500         | `INTERNAL_ERROR`                                       | Generic message and optional support reference            |
| 502/503/504 | `SERVICE_UNAVAILABLE` or existing provider/domain code | Read retry; reconcile uncertain mutations                 |

BE implementation touchpoints: `src/lib/error.ts`, `src/type/general.ts`, `src/lib/general.ts`, `src/middleware/errorHandler.ts`, validation/auth middleware, request-reference middleware in `src/app.ts`, and direct-response controllers. Use one shared sanitization/serialization policy across these paths. Update the Flutter handoff with the final code catalogue and field-error examples. Admin APIs use the same contract; Swagger error definitions and the consolidated admin handoff document it.

## 5. Frontend rollout

1. **Foundation:** typed failure normalization, safe message catalogue, reusable content error panel and shared snackbar/footer presentation. Preserve the existing auth-refresh and SSE ownership boundaries.
2. **Lists:** 市集, 訂單記錄, 我的收藏, 訊息中心 and 聊天室. Separate initial/refresh/pagination errors; preserve filters, rows, selection, pagination state and current-query caches.
3. **Details and forms:** 商品介紹, 訂單詳情, 訊息詳情, cart, checkout/payment, refunds, account/delivery/payment settings and bank search. Add contextual recovery and safe validation messages; retain uncertain-operation safeguards.
4. **Remaining pages:** home/treasure box, ads/explore, profile, help/consent/documents and WebViews. Audit direct exception interpolation and background errors, not just `PageError` callers.
5. **Cleanup:** retire raw-string UI fallbacks after all callers migrate. Avoid replacing existing business-specific handling with a generic error screen.

## 6. Validation and acceptance

Flutter tests: first load with no response; timeout; DNS/connection failure; non-JSON 502; safe unknown 500/code; 401 refresh success/failure; 403/404; validation lists; 409 business conflicts; 429 cooldown; canceled requests; rapid category changes; failed refresh with cached data; failed pagination/retry without skipped pages; duplicate retry taps; SSE recovery; successful mutation with lost response; logout clearing caches.

Verify staging/production masking even in debug builds, and unknown-flavor behavior. Seed errors with token-like strings, SQL and paths and assert they never appear in user-visible widgets or snackbars. Check dark-theme contrast and narrow-screen layout.

BE tests: service exception and middleware exception use the same safe policy; auth and validation failures are sanitized; status/body agree; legacy payload compatibility; request references match logs; `Retry-After` is present where applicable; direct-response controllers and SSE/payment protocols remain correct. Existing payment/refund/chat/notification regression suites must remain green.

Acceptance: users can retry a recoverable page error without reopening the page, retain loaded rows after pagination failure, keep horizontal filter position, and never see raw technical errors in staging/production.

## Original BE decision requests (answered in the implementation feedback)

- Confirm the additive error contract, common codes and legacy validation/checkout compatibility.
- Confirm request-reference and cooldown headers, and which user-safe field-error codes will be provided.
- Confirm the sanitization boundary covers service wrappers and direct controller responses, not only global middleware.
- Return a code catalogue for product/order/cart/refund conflicts and auth failures; retain existing identifiers.

Flutter presentation improvements can start without waiting for new fields: transport/status fallback, safe generic copy and local retry controls work against the current API. BE sanitization is independently required because hiding raw text in Flutter does not prevent the API itself from disclosing it.


BE review clarification: HTTP 200 `success:true` checkout evaluations with `canCheckout:false` remain successful business evaluations. Ordinary request failures use non-2xx status. Dio HTTP `badResponse` must still parse domain codes; only genuine transport errors should bypass HTTP/envelope parsing. Implementation details, exceptions and accepted field-error codes are in the [BE feedback](FLUTTER_ERROR_HANDLING_FEEDBACK.md).
