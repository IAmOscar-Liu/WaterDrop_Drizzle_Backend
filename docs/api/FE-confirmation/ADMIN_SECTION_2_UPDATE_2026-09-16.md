# Admin FE API update — Section 2

This document answers Section 2 of
[`ADMIN_FE_CONFIRMATION_CHECKLIST.md`](ADMIN_FE_CONFIRMATION_CHECKLIST.md). The
updated contracts are also available in Swagger at `/api-docs`.

All paths below include the `/api/admin` prefix. Protected endpoints require `Authorization: Bearer <accessToken>`.

## 1. Login, refresh, and logout

- Admin access token lifetime: **1 day when `NODE_ENV=local`; 1 hour in development, staging, production, and test**.
- Refresh token lifetime: **30 days**. A successful refresh issues a new access token and rolls the refresh token forward for another 30 days.
- `POST /account/logout` now clears the refresh cookie with the same domain, path, SameSite, and Secure attributes used when it was created.
- The other cookie behavior is unchanged: HTTP-only, `SameSite=Strict`, path `/`; domain `waterdropping.com` in production (host-only in other environments); Secure in production.
- The browser must send credentials for cookie-based refresh/logout requests, for example Axios `withCredentials: true` or Fetch `credentials: "include"`.

Login and refresh continue to return the access token in `data.token`. FE should refresh before or after a `401` caused by access-token expiry. This lifetime change applies only to `/api/admin/account` authentication; the app-user `/api/auth` token behavior is unchanged.

## 2. Account registration requirements

`POST /account/register`

Required fields:

| Field | Rule |
| --- | --- |
| `name` | Non-empty display/account name |
| `realName` | Required; ECPay-compatible length 4–10 and no emoji |
| `email` | Valid email |
| `password` | At least 8 characters and includes uppercase, lowercase, number, and special character |
| `phone` | Taiwan mobile format: 10 digits beginning with `09` |

Optional fields are `address` and `role`. `role` is `seller` or `employee`; when omitted it defaults to `seller`.

```json
{
  "name": "Waterdrop Store",
  "realName": "王小明",
  "email": "seller@example.com",
  "password": "Password123!",
  "phone": "0912345678",
  "address": "台北市信義區...",
  "role": "seller"
}
```

## 3. Password change

`PUT /account/change-password` is unchanged. Send `id`, `oldPassword`, and `newPassword`. The new password follows the same complexity rule as registration.

## 4. Edit account avatar

`PUT /account/update` now accepts an avatar update.

- Preferred request field: `avatarUrl`
- Backward-compatible request alias: `avatar_url`
- Send a valid URL to set/replace the avatar.
- Send `null` to clear it.
- Responses use the database field name `avatar_url`.

```json
{
  "id": "ACCOUNT_UUID",
  "avatarUrl": "https://cdn.example.com/avatar.png"
}
```

```json
{
  "id": "ACCOUNT_UUID",
  "avatarUrl": null
}
```

An account can update itself; a platform admin can update another account.

## 5. Admin account/sub-account list filters

`GET /account/list` is now **platform-admin-only**. Seller and employee accounts receive `403`.

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `page`, `limit` | Pagination |
| `search` | Name/email search |
| `role` | `admin`, `seller`, or `employee` |
| `status` | `active`, `inactive`, or `banned` |
| `sellerId` | Employees whose account-group parent is the specified seller; alias of `parentId` |
| `parentId` | Employees whose account-group parent is the specified admin/seller |
| `accountGroupId` | Accounts directly assigned to this account group |

Filters can be combined. If `sellerId` and `parentId` are both sent, they must be equal.

Example:

```http
GET /api/admin/account/list?sellerId=SELLER_UUID&accountGroupId=GROUP_UUID&page=1&limit=20
```

## 6. Advertisement wallet/deposit

Implemented. `PUT /advertisement/deposit/:id` now atomically transfers the
requested amount from the product seller's account wallet into the
advertisement balance. It requires `amount` and `idempotencyKey`; insufficient
wallet balance returns `409`. Full wallet, authorization, retry, response, and
rollout details are documented in
[ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md](ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md).

## 7. Advertisement status authorization and prerequisites

`PUT /advertisement/status/:id`

Only these callers are allowed:

- the seller who owns the advertisement's product; or
- a platform admin.

When changing to `active`, all of these must be true:

- the advertisement is not permanently archived;
- the product status is `active`;
- at least one product variant is `active` and has `stock > reserve`;
- the advertisement balance meets the existing minimum of 100.

Authorization failure returns `403`. Failed activation prerequisites or attempts to reactivate an archived ad return `409`. Status values remain `active`, `paused`, `depleted`, and `archived`.

## 8. Advertisement view-count access

### Single advertisement

`GET /advertisement/:id/view-count`

The endpoint now checks ownership. Only the product's seller or a platform admin can query it. Other accounts receive `403`.

### Platform-wide list

New endpoint: `GET /advertisement/platform/list/view-count`

This endpoint is **platform-admin-only**. It supports:

- `page`, `limit`
- `startAt`, `endAt` as ISO-8601 date-time values
- optional `sellerId`; omit it for all sellers, or provide it for one seller

```http
GET /api/admin/advertisement/platform/list/view-count?sellerId=SELLER_UUID&startAt=2026-09-01T00:00:00%2B08:00&endAt=2026-10-01T00:00:00%2B08:00
```

The existing `GET /advertisement/list/view-count` remains the authenticated seller's own advertisement list.

## 9. Refrigerated shipping-fee maximum

`POST /delivery/helper/fee` now compares `homeDeliveryRefrig` with `HOME_DELIVERY_REFRIG_FEE`, not `HOME_DELIVERY_FEE`.

All validation ceilings now use the environment configuration as the backend source of truth. Current configured values are:

| Field | Current maximum |
| --- | ---: |
| `homeDelivery` | 60 |
| `homeDeliveryRefrig` | 160 |
| `OKMART_LOW_TMP_C2C` | 160 |
| `FAMIC2C` | 69 |
| `UNIMARTC2C` | 69 |
| `HILIFEC2C` | 58 |
| `OKMARTC2C` | 58 |

## 10. Admin-to-app-user push notification

New endpoint: `POST /system/send-app-notification`

Important scope:

- only a platform admin may call it;
- targets are **app users**, not seller/admin accounts;
- supported targeting is explicit `userIds`, `groupIds`, or both;
- a group includes its owner and members;
- sending to all users is deliberately **not supported**;
- users without an FCM device token are resolved but receive no device delivery.

At least one target array and either `notification` or `data` are required.

```json
{
  "userIds": ["APP_USER_UUID"],
  "groupIds": ["APP_GROUP_UUID"],
  "notification": {
    "title": "系統通知",
    "body": "通知內容"
  },
  "data": {
    "command": "explore"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "targetedUserCount": 8,
    "tokenCount": 6,
    "batchCount": 1
  }
}
```

The low-level `POST /system/send-notification` endpoint that accepts raw FCM `tokens` is also now platform-admin-only.

The response counts resolved users and tokens submitted for delivery; it is not a per-device delivery receipt.

## Completion and scope check

- Items 1–10 are now implemented and documented. Item 6 is delivered as the
  account-wallet feature described in
  [ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md](ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md).
- Item 3 (`PUT /account/change-password`) remains the same FE contract and was reverified as part of this work.
- There are no remaining Admin FE product decisions in this handoff.
- These changes affect `/api/admin/**` behavior only. The app-user `/api/auth`, advertisement-list, treasure-box, order, and other non-admin API contracts are unchanged.
- Swagger continues to publish only `/api/admin/**` endpoints.

## Error handling FE should add

- `401`: access token missing, invalid, or expired; attempt refresh where appropriate.
- `403`: the authenticated account lacks the required admin/ownership permission.
- `409`: advertisement state or activation prerequisites conflict with the operation.
- `400`: request validation failed; display the returned validation details.
