# Flutter — synchronous ECPay test logistics verification (B)

Date: 2026-10-23

Status: **Backend implemented and tested with mocked provider responses; deployment, live sandbox and Flutter UI verification remain.** No database schema change, migration, verification-job table, worker or new environment variable is required. Flutter was inspected for compatibility but not modified. This app-only API is excluded from admin Swagger.

This replaces the proposed callback/job design in [the plan](../plans/FLUTTER_CHECKOUT_VALIDATION_API_PLAN.md). It is separate from [A: cart validation](FLUTTER_CHECKOUT_VALIDATION_API_CHANGES.md).

## New endpoint

```http
POST /api/ecpay/express/test/validate
Authorization: Bearer APP_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "type": "C2C",
  "ReceiverName": "王小明",
  "ReceiverCellPhone": "0912345678",
  "ReceiverEmail": "buyer@example.com"
}
```

Use the existing authenticated Dio client. The field names match the receiver fields currently used by `ValidationWebview`.

| Field | Contract |
| --- | --- |
| `type` | Optional `C2C` or `B2C`; defaults to `C2C`, matching Flutter's current `AppConstants.logisticsSubType`. |
| `ReceiverName` | Required nonblank string, ECPay length 4–10 (Chinese/full-width characters count as 2). Digits, emoji, controls and the existing prohibited special characters are rejected. ECPay performs its own additional validation. |
| `ReceiverCellPhone` | Required string: `09` followed by 8 digits. |
| `ReceiverEmail` | Required email string, maximum 50 characters. |

Values are not silently trimmed/rewritten. Unknown body fields and all query parameters are rejected. Do not send `realAccount`, a store ID, seller information, URLs, merchant credentials, a callback payload or a user ID. Missing/invalid bearer tokens and nonexistent app users are rejected; admin/seller tokens cannot call this API.

## Result and errors

HTTP 200 success:

```json
{
  "success": true,
  "data": {
    "verificationId": "07dd736d-ebee-43c8-b91b-084cd03f382d",
    "success": true,
    "code": "VALIDATED",
    "message": "物流資料驗證成功",
    "providerCode": "300"
  }
}
```

Only proceed when **HTTP 200, outer `success == true`, `data.success == true`, and `data.code == "VALIDATED"`**. Do not infer success from an HTTP status alone, a callback, a nonempty response or a loading timeout.

A recognized provider rejection is also HTTP 200, with outer `success:true`, but:

```json
{
  "verificationId": "07dd736d-ebee-43c8-b91b-084cd03f382d",
  "success": false,
  "code": "PROVIDER_REJECTED",
  "message": "綠界未接受測試物流資料，請確認收件資訊或稍後重試",
  "providerCode": null
}
```

The rejection message is intentionally generic. The provider's raw error text may contain personal data and is not returned. A rejection can concern test service configuration as well as receiver information; do not automatically tell the buyer their name is invalid.

| HTTP / top-level `code` | Meaning / Flutter action |
| --- | --- |
| 400 / existing Zod error envelope | Invalid fields; show field errors and allow correction. No provider call occurs. |
| 401 / 403 | Authentication/account failure; use existing authentication handling. |
| 429 `LOGISTICS_VERIFICATION_LIMIT` | Too many requests or one already in progress; honor `Retry-After: 60`. |
| 502 `LOGISTICS_VERIFICATION_INVALID_RESPONSE` | Missing/invalid signature, mismatched transaction/receiver data, unknown status or malformed result; stay blocked. |
| 502 `LOGISTICS_VERIFICATION_PROVIDER_ERROR` | Provider transport/HTTP failure; allow manual retry. |
| 503 `LOGISTICS_VERIFICATION_UNAVAILABLE` | Backend callback host is not configured correctly; do not continue. |
| 504 `LOGISTICS_VERIFICATION_TIMEOUT` | Result unknown after timeout; do not continue or assume no test order was created. |
| 500 `LOGISTICS_VERIFICATION_INTERNAL_ERROR` | Unexpected backend failure; stay blocked. |

Non-200 service failures use the existing `{success:false,message,code}` envelope and have no successful `data`. Network errors and unknown response shapes also block checkout.

`verificationId` is a server-generated response correlation ID only. It is **not** a saved job, signed checkout permit, idempotency key or status-query token. There is no polling API or `PENDING` result in this synchronous design. Flutter correlates results with its own request sequence and the receiver/account snapshot.

## Flutter changes, based on the current project

Files inspected in `/Users/oscar/Desktop/my_code/flutter/flutter_ad_ecommerce`:

- `lib/features/ecpay/widget/checkout_webview.dart`: `ValidationWebview` currently loads `/express/test/create` and treats any `express-test-reply` callback as success.
- `lib/pages/payment_settings_page.dart`: `CheckoutStat.validating` currently mounts that widget, then advances to `CheckoutStat.settingMap` in `onSuccess`.
- `lib/provider/dio_provider.dart`: `dioProvider` already attaches the bearer token, binds requests to the account and handles a single authentication refresh/retry. Its default receive timeout is 60 seconds.

Recommended integration:

1. At `CheckoutStat.validating`, capture account ID, receiver name/phone/email, logistics type and a request sequence number. Start **one** Dio POST outside `build()`; show an ordinary loading view instead of `ValidationWebview`.
2. Use the existing `dioProvider`, with a client receive timeout longer than the backend's 20-second provider deadline (for example 30 seconds). Do not create an unauthenticated standalone Dio client.
3. After the response, verify the widget is mounted, still in the expected checkout attempt, and account/receiver/type values and sequence still match. Discard late results after edits, logout, navigation away or a newer retry. An access-token refresh alone need not invalidate the same account's attempt.
4. Advance to `CheckoutStat.settingMap` only on the explicit successful result above. Every other outcome must show an error with Retry and Back/Edit options. Disable repeated taps while waiting.
5. On edits or retry, invalidate the previous sequence and cancel its Dio request where possible. Cancellation does not guarantee ECPay stopped processing the old request. Never let its eventual result advance the new attempt.
6. Keep `LogisticsMapWebview` and `/api/ecpay/logistics/map`: store selection still needs that WebView. Keep `/api/ecpay/express/validate` for existing seller/goods field checks, shipping calculations and actual order/delivery creation.

Example request in the existing Flutter provider setup:

```dart
final response = await ref.read(dioProvider).post(
  '/api/ecpay/express/test/validate',
  data: {
    'type': AppConstants.logisticsSubType,
    'ReceiverName': receiverSnapshot.name,
    'ReceiverCellPhone': receiverSnapshot.phone,
    'ReceiverEmail': receiverSnapshot.email,
  },
  options: Options(receiveTimeout: const Duration(seconds: 30)),
  cancelToken: cancelToken,
);
// After checking mounted/account/receiver/request-sequence freshness:
final body = response.data;
final data = body is Map ? body['data'] : null;
final validated = response.statusCode == 200 &&
    body is Map && body['success'] == true &&
    data is Map && data['success'] == true && data['code'] == 'VALIDATED';
// Only validated may advance checkout. Handle DioException/non-200 separately.
```

This sketch does not implement widget lifecycle or stale-result guards for you. Do not fall back to the old unconditional-success WebView when this endpoint fails or returns 404; deploy the backend before switching Flutter.

## Provider behavior and operational limits

The backend sends one form-encoded HTTPS request to ECPay's fixed **test** `/Express/Create` URL. It always uses the published test merchant for the chosen mode, test goods amount 300, test store `131386`, a dummy sender and the supplied receiver fields. C2C uses `UNIMARTC2C`; B2C uses `UNIMART`. This remains sandbox validation even when the platform runs in production; there is no client option to create a real shipment through this endpoint.

`ClientReplyURL` is omitted. The backend recognizes the synchronous creation envelope, verifies its MD5 `CheckMacValue`, checks the generated trade number/merchant/type/amount/receiver fields and requires the known initial status `300` plus a logistics ID. Unknown statuses fail closed. ECPay documents backend creation without `ClientReplyURL` and the `1|...` / `0|...` response format in [門市訂單建立](https://developers.ecpay.com.tw/8809/); checksum rules are in [檢查碼機制說明](https://developers.ecpay.com.tw/7424/). The initial `300` status means the order data was received, as illustrated in [ECPay's logistics FAQ](https://support.ecpay.com.tw/15904).

The published sandbox credentials are shared, so a checksum alone is not proof that a browser callback came from ECPay. This flow instead consumes the response to the backend's own TLS-verified request to the fixed provider host and also checks its signature and correlation fields. It never accepts caller-submitted provider results.

- Provider deadline: 20 seconds, with an abort signal; no automatic retry. Redirects are disabled and provider response bodies are bounded at 32 KiB.
- One in-flight request per app user, five provider attempts per user per minute, twenty concurrent calls per API process. The limiter stores at most 10,000 user entries and removes expired entries on requests. These are process-local limits, not durable or cluster-wide quotas.
- Each manual retry creates a fresh provider trade number. A timeout/process failure can leave a test order at ECPay. With no durable jobs, this does **not** promise cross-process idempotency, recovery or exactly-once test-order creation. Avoid automatic retry loops.
- Existing `HOST` supplies the server callback URL; deploy with the correct externally reachable API host. No credentials or environment files were changed. Local callback reachability is subject to ECPay accepting the configured URL; callbacks are not required to complete the HTTP result.
- New provider callback `POST /api/ecpay/express/test/validation/server-reply` only acknowledges `1|OK`. It intentionally does not trust or store the payload, log recipient information, create deliveries, or complete a verification. It is not an app API and cannot unlock checkout.
- Existing `/express/test/create` and old test callbacks remain unchanged for older apps. They are legacy paths, not the new verified contract. Remove their Flutter usage when adopting this endpoint; retirement of those endpoints is a separate compatibility decision.

A successful **test** request does not guarantee the real seller, store, goods, amount or later real shipment will be accepted. It does not validate payment, stock or final order prices. No order, delivery, merchant-trade, verification or idempotency row is created in this backend by this flow.

## Tests and rollout

```bash
npm run build
npm run test:logistics-verification
```

The suite uses disposable PostgreSQL and replaces the dedicated ECPay HTTP adapter with fixtures. It checks app authentication, request restrictions, B2C/C2C test configuration, the official checksum example, matching signed success, provider rejection, malformed/unsigned/mismatched results, unknown statuses, transport/timeouts, concurrency/rate limits and no business-row writes. **No live ECPay calls were made by the suite.**

Deploy the backend first, then have Flutter adopt the new request. Before rollout, test a real sandbox request through the deployed host and verify loading, success, field errors, provider outage/timeout, repeated taps, account/receiver changes and navigation cancellation on-device. No database generation or migration step is needed.
