# BE feedback: Flutter error handling

Date: 2026-11-04
Status: implemented for app and admin APIs in backend source; no new database migration required for this error-contract change.

The proposal is supported. Flutter can proceed with typed failures, contextual retry controls and friendly local copy. This implements the BE contract; it does not change Flutter widgets, caches, auth refresh or SSE controllers. The existing payment/refund migrations still need to be deployed with the current backend where not already applied.

Scope: all `/api/*` routes, including `/api/admin` and `/api/admin/*` (case-insensitive). Admin APIs now use the same error envelope, public masking, validation fields, request references and status normalization. Shared helpers select the policy from request context; calls outside API requests retain legacy behavior. The consolidated [admin FE handoff](FE-confirmation/ADMIN_ERROR_HANDLING_AND_REFUND_WINDOWS.md) includes this contract and product-specific refund windows.

Variant-policy update (2026-11-11): the error contract remains unchanged. Product policies move into variants as whole-hour refundWindowHours; order snapshots use refundWindowHoursAtSale; old nested day writes are rejected; old top-level admin writes return validation failures. See [Flutter variant-policy integration](FLUTTER_VARIANT_REFUND_WINDOWS.md) and [admin FE integration](FE-confirmation/ADMIN_VARIANT_REFUND_WINDOWS.md). The new variant-policy migration is generated, not applied.

## Decisions and implemented behavior

| Proposal decision | BE response |
| --- | --- |
| Additive envelope | Implemented: `success`, `statusCode`, `message` remain; failures add `code`, `requestId`, and optional `fieldErrors`. |
| Existing domain codes | Preserved. Errors without a code receive a stable HTTP fallback. Cart errors that previously lacked codes now have explicit product/variant/stock/cart identifiers. |
| Safe public messages | Implemented for staging, production and unknown/unset environments, including direct JSON responses. Unknown exceptions use generic messages in every environment. Expected legacy messages remain available in explicit local/development/test environments; Flutter still must not display arbitrary text. |
| Validation compatibility | Legacy `message` arrays and JSON-string `{error:[...]}` lists remain parseable. Item identifiers/numeric details are retained where approved; arbitrary submitted strings and unknown extra fields are removed from public failures. Safe `fieldErrors` are additive. |
| Request references | Every API response gets a server-generated UUID in `X-Request-ID`; JSON failures include the same `requestId`. Caller-supplied request IDs are ignored. |
| Cooldowns | Existing known `Retry-After` values are preserved. No cooldown is invented where the backend does not know when a limit will clear. |
| Shared boundary | `handleServiceError`, `sendJsonResponse`, global middleware and direct `res.json({success:false,...})` use the same policy within API requests. Missing/invalid failure statuses no longer silently become HTTP 200. |
| Success and provider protocols | Successful JSON payloads, successful ECPay HTML and provider acknowledgement bodies remain unchanged. SSE handshake errors use JSON before streaming; after headers, documented reset/close behavior applies. |
| Logging | API request structured HTTP logs use request ID, method, matched route template, actual status, error code and approved cause classification/application source locations. They omit request bodies, query strings, tokens, cookies, raw SQL and arbitrary exception messages. High-risk payment/auth parameter logging was removed; payment/refund failures within API request context use classified diagnostics. |

The request reference is for support, not an idempotency key, chat cursor, payment attempt ID or authentication credential. Every HTTP retry receives a new request reference; mutation idempotency keys must remain unchanged when retrying the same uncertain operation.

## Failure envelope

HTTP 409:

```json
{
  "success": false,
  "statusCode": 409,
  "code": "REFUND_REQUEST_CONFLICT",
  "message": "This refund request key was already used with a different request",
  "requestId": "67f4318c-a57e-4e18-bb4e-b5fcc7c048ef"
}
```

`X-Request-ID` has the same UUID. Actual HTTP status and `statusCode` agree after serialization. Do not parse English messages to decide recovery. Recognized business codes take priority over generic HTTP recovery.

A Zod validation response retains the array in `message`:

```json
{
  "success": false,
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": [
    { "field": "receiver.phone", "message": "Please enter a value in the correct format" }
  ],
  "fieldErrors": [
    { "field": "receiver.phone", "code": "INVALID_FORMAT", "message": "Please enter a value in the correct format" }
  ],
  "requestId": "67f4318c-a57e-4e18-bb4e-b5fcc7c048ef"
}
```

`receiver.phone` illustrates the path syntax; actual fields use their existing request schema paths (for example, `ReceiverCellPhone` on an appropriate form). Array fields use dot indices, such as `items.0.quantity`. Empty `field` means a form/item-level error. Free-form notification `data` record errors are reported at `data`, without reflecting arbitrary submitted record keys. `fieldErrors` is optional, including for malformed JSON and plain business validation errors. The proposed `INVALID_PHONE` code is not introduced; use field plus `INVALID_FORMAT`/`INVALID_VALUE` and localized copy.

Never assume `message` is a string. During mixed-version rollout, continue accepting failures without `code`/`requestId`, older validation arrays and non-JSON proxy errors. Unknown backend codes should use a safe status-based fallback.

## Generic fallback codes

| HTTP | Code | Flutter recovery |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Keep inputs; show approved field/form messages. |
| 401 | `UNAUTHENTICATED` | Existing single token-refresh attempt, then one session-level sign-in prompt if needed. |
| 403 | `FORBIDDEN` | Explain unavailable access/action. Do not log out for every 403. |
| 404 | `RESOURCE_NOT_FOUND` | Contextual unavailable/removed state; back/list/support action. |
| 409 | `CONFLICT` | Re-read authoritative state; reconcile before retrying a mutation. |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce submitted data/attachments. |
| 429 | `RATE_LIMITED` | Honor `Retry-After` if present. |
| 500 | `INTERNAL_ERROR` | Generic service feedback; bounded read retry or support reference. |
| 502/503/504 | `SERVICE_UNAVAILABLE` | Bounded read retry; reconcile uncertain writes. |

A generic code fills a missing code; it does not replace a domain code such as `PAYMENT_CONFIRMATION_PENDING` or `REFUND_WINDOW_EXPIRED`. Other HTTP failures use an appropriate safe validation/internal fallback; clients must handle unfamiliar statuses safely.

Approved field codes: `INVALID_TYPE`, `VALUE_TOO_SMALL`, `VALUE_TOO_LARGE`, `INVALID_FORMAT`, `INVALID_VALUE`, `UNRECOGNIZED_FIELDS`, `INVALID_MULTIPLE`. Sanitized legacy item errors may additionally use `PRODUCT_UNAVAILABLE`, `VARIANT_UNAVAILABLE` or `INSUFFICIENT_STOCK`. Each supplied field message comes from fixed safe copy; do not expose an unrecognized older-server field message automatically.

## Business recovery catalogue

### Checkout/payment

Preserve these identifiers: `INSUFFICIENT_SPENDABLE_COINS`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_METHOD_MISMATCH`, `PAYMENT_KEY_MISMATCH`, `ORDER_NOT_PAYABLE`, `PAYMENT_ALREADY_STARTED`, `PRODUCT_UNAVAILABLE`, `PRODUCT_PRICE_CHANGED`, `ORDER_STOCK_UNAVAILABLE`, `ORDER_TOTAL_MISMATCH`, `INVALID_SHIPPING_INFO`, `COIN_LEDGER_REQUIRED`, `PAYMENT_CONFIRMATION_PENDING`, `PAYMENT_REVIEW_REQUIRED`.

Use [the payment safety handoff](PAYMENT_SAFETY_API_CHANGES.md) for exact endpoint/status semantics. Insufficient coins block before ECPay checkout. Timeout, WebView close, `PAYMENT_ALREADY_STARTED`, `PAYMENT_CONFIRMATION_PENDING`, or `PAYMENT_REVIEW_REQUIRED` must lead to re-reading the original order, not an automatic second payment/new order. Never set an order to paid/failed locally or via the restricted order-status endpoint.

`/api/ecpay/new` missing-parameter, token and configuration errors now use JSON with 400/401/503 and the common codes, alongside its existing domain errors. A successful response is still HTML. `/api/ecpay/return`, `/api/ecpay/paymentInfo` and logistics provider callbacks keep their plain-text acknowledgement/error protocols.

### Cart/product/order

New explicit codes for previously uncoded cart errors: `PRODUCT_NOT_FOUND` (404), `CART_ITEM_NOT_FOUND` (404), `PRODUCT_UNAVAILABLE` (400), `VARIANT_UNAVAILABLE` (400/404), `INSUFFICIENT_STOCK` (400). Preserve current status semantics; the same domain name can appear at a different status on a different endpoint (for example `PRODUCT_UNAVAILABLE` is 409 at payment preparation).

Checkout pre-validation is a **successful evaluation**: HTTP 200, `success:true`, `data.canCheckout:false` and structured issues are not transport/request failure. Keep its issue codes: `CART_SELECTION_CHANGED`, `CART_ITEM_UNAVAILABLE`, `CART_ITEM_CHANGED`, `PRODUCT_UNAVAILABLE`, `VARIANT_UNAVAILABLE`, `PRICE_CHANGED`, `PRICE_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `STOCK_UNAVAILABLE`. Retain the existing cart refresh/selection/price-confirmation behavior for those issues.

Legacy order-validation item lists remain supported; use additive safe fields when supplied, otherwise generic form/item feedback. Do not classify them by matching their reason text.

### Refunds

Eligibility codes remain `REFUNDS_DISABLED`, `ORDER_NOT_PAID`, `NOT_RECEIVED`, `RECEIPT_TIME_UNKNOWN`, `PAYMENT_TIME_UNKNOWN`, `REFUND_WINDOW_EXPIRED`, `NO_REFUNDABLE_QUANTITY`. Review/retry codes include `REFUND_REQUEST_CONFLICT`, `REFUND_TERMINAL`, `REFUND_AGREEMENT_REQUIRED`, and `REFUND_WINDOW_EXPIRED`.

Use `GET /api/order/:id` and computed eligibility to recover. Retain the same `clientRequestId` and exact payload for an uncertain retry; a deliberate new request after rejection needs a new UUID. Do not infer eligibility from a null deadline or hide existing requests because new requests are blocked. See [the refund-window handoff](FLUTTER_PRODUCT_REFUND_WINDOWS.md).

### Authentication and access

Uncoded auth failures now expose `UNAUTHENTICATED`/`FORBIDDEN`. Existing codes are preserved, including `ADMIN_ACCESS_TOKEN_REQUIRED`, `ACCOUNT_CREDENTIALS_CHANGED`, `ACCOUNT_SESSION_INVALID`, `REFRESH_TOKEN_INVALID`, `ACCOUNT_PROFILE_INCOMPLETE`, `ACCOUNT_EMAIL_UNVERIFIED`, `EMAIL_VERIFICATION_TOKEN_INVALID`, `EMAIL_CHANGE_PASSWORD_INVALID`, `ACCOUNT_EMAIL_UNAVAILABLE`.

Several are admin/account-only and must not cause Flutter to invent a new login flow. Treat a failed refresh on the existing refresh endpoint according to its auth-specific contract; do not refresh recursively. A business 403 such as `PAYMENT_KEY_MISMATCH` is not session expiry.

### Chat/notifications

Keep their existing cursor, snapshot, access and connection-limit codes and the controller-owned reconnect/backoff. These remain domain codes rather than generic `CONFLICT`/`RATE_LIMITED`. Respect known cooldown headers. After SSE headers, use the documented `stream.reset` protocol (`auth_expired` or `resync_required` where applicable); do not parse the stream as an HTTP JSON failure.

## Headers and UI recommendations

For app and admin APIs, CORS exposes `X-Request-ID` and `Retry-After` for the existing allowed origins. Known cooldowns remain endpoint-specific (for example 15 seconds for stream/notification limits, 60 seconds for logistics verification, 3600 seconds for account cooldowns where already set). No universal 429/503 delay is promised. Flutter should support both legal `Retry-After` formats and bounded backoff when absent.

Recommended normalization order: intentional cancellation; genuine connection/timeout transport failure; HTTP/envelope domain code; status fallback; safe unknown. Dio's HTTP `badResponse` category must still inspect the response's business code rather than becoming a generic connection error. HTTP 200 `success:false` from an older deployment is still a failure; HTTP 200 `success:true` with negative eligibility is not.

The network layer should return `AppFailure`, not show global snackbars. Preserve the proposal's initial/refresh/pagination distinction, current-query/session guards, existing SSE recovery, mutation reconciliation, and friendly UI in every build/flavor. Unknown flavor/release diagnostics remain a Flutter responsibility; no Flutter runtime was edited here.

## Verification and rollout

- `npm run test:error-handling`: public masking in staging/production/unknown/unset modes, legacy structures, direct-controller normalization, headers/log references, CORS, parser errors, cooldowns, unchanged success payloads, HTML, provider callback text and SSE reset behavior.
- `npm test`: build, error-contract tests and the 19 disposable-database suites, including payment, refund, chat, notifications, auth, order expiry and coin accounting.
- Swagger `/api-docs` documents admin APIs with shared `ApiFailure` / `ApiFieldError` schemas, request/cooldown headers and error response references. Success schemas and HTML/provider protocols remain intact.
- Error-contract tests verify app/admin parity in staging/production/unknown/unset environments, including admin root/case-insensitive paths, parser errors, masking, validation fields, response references and Swagger schemas.

Deploy the backend and allow mixed-version fallback while Flutter rolls out typed errors. No migration is added by error handling itself. Remaining frontend work is the presentation/model/caching rollout described in [the original proposal](FLUTTER_ERROR_HANDLING_PLAN.md).
