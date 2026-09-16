# Flutter Coin Ledger API Changes

This document is the handoff for the Flutter app. It covers app-user APIs only;
seller/admin accounting endpoints and internal coin-ledger tables are out of
scope.

## Required Flutter Changes

1. Always send `advertisementId` when reporting a completed video.
2. Refresh the advertisement list when video completion returns HTTP `409`.
3. Refresh the treasure-box list when opening a box returns HTTP `410`.
4. Treat every coin value as a decimal with up to two decimal places, not as an
   integer.
5. Continue sending the user's current IANA timezone during login.
6. Use the new refund cash/coin fields when displaying a refund.

## Common Response Envelope

Successful APIs return:

```json
{
  "success": true,
  "data": {}
}
```

Business failures return the HTTP status shown in `statusCode`:

```json
{
  "success": false,
  "statusCode": 409,
  "message": "No valid issued assignment exists for this advertisement."
}
```

Validation failures use HTTP `400`, and `message` is an array:

```json
{
  "success": false,
  "statusCode": 400,
  "message": [
    {
      "field": "advertisementId",
      "message": "Validation error"
    }
  ]
}
```

Branch on the HTTP status or `statusCode`. Do not branch on the English
`message`, because message text is not an API enum.

## Advertisement List and Assignment

### `GET /api/advertisement/list`

The request and response JSON are unchanged:

```json
{
  "success": true,
  "data": {
    "advertisements": [],
    "total": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 0
  }
}
```

The authenticated request now also assigns every returned advertisement to the
user for their current local date. This is server-side state; there is no
assignment ID or token for Flutter to store.

- Multiple list requests on the same local date are safe.
- The same user/advertisement/local-date assignment is reused instead of
  duplicated or overwritten.
- An archived advertisement disappears from new lists immediately.
- An advertisement that was assigned before it was archived may still be
  completed until the earlier of the configured archive grace period (normally
  24 hours) and the user's local midnight.
- Do not keep an advertisement list across a local-date change.

Recommended client behavior:

- Fetch a fresh list when entering or refreshing the ad screen.
- Keep the `id` of the advertisement actually played.
- If completion returns `409`, discard that item and fetch a fresh list.

## Video Completion

### `POST /api/treasureBox/video-complete`

`advertisementId` is now required and must be a UUID:

```json
{
  "advertisementId": "69340444-c52a-47f8-b948-63694c43e9d2"
}
```

Send the ID belonging to the video that the user actually finished. Do not send
the currently selected list index, a product ID, or an ID from a newly refreshed
list.

The successful response remains the updated daily-stat object plus
`isAwarded`:

```json
{
  "success": true,
  "data": {
    "id": "daily-stat-uuid",
    "userId": "user-uuid",
    "totalViews": 2,
    "viewedAds": ["ad-uuid-1", "ad-uuid-2"],
    "treasureBoxesEarned": 1,
    "canWatchMore": true,
    "remainingViews": 18,
    "nextTreasureBoxIn": 2,
    "groupAdViewsCountYesterday": 20,
    "createdAt": "2026-09-13T01:00:00.000Z",
    "updatedAt": "2026-09-13T01:05:00.000Z",
    "isAwarded": true
  }
}
```

Important failures:

| HTTP status | Meaning | Flutter action |
|---|---|---|
| `400` | Missing or invalid UUID | Treat as an app/request bug; do not retry unchanged |
| `403` | User has reached the daily viewing limit | Stop offering another ad and refresh daily stats |
| `404` | User or advertisement no longer exists | Refresh the screen; show a generic unavailable state |
| `409` | Assignment is absent, expired, already completed, or outside archive grace | Do not count the view locally; refresh the ad list |

A failed `409` request does not increment daily ad counts and does not create a
treasure box. The user must complete an advertisement from a refreshed list.

Disable the completion button while the request is in flight. A second request
for the same assignment returns `409`; the endpoint should not be used as a
client-side retry counter.

## Treasure Boxes

### `GET /api/treasureBox/list`

The endpoint still returns an array. The backend now includes additional
accounting/deadline fields on each row:

```dart
enum TreasureBoxAccountingStatus {
  claimable,
  acquired,
  unacquired,
  zeroReward,
}
```

Wire values are:

- `claimable`
- `acquired`
- `unacquired`
- `zero_reward`

Relevant model fields are:

```dart
class TreasureBox {
  String id;
  String userId;
  num coinsAwarded;
  bool isOpened;
  bool? isActive;
  String? accountingStatus;
  DateTime? claimDeadlineAt;
  DateTime? localClaimDeadlineAt;
  DateTime? archiveGraceDeadlineAt;
  DateTime? earnedAt;
  DateTime? openedAt;
  DateTime? acquiredAt;
}
```

Flutter may ignore the remaining accounting fields. If it shows a countdown,
use `claimDeadlineAt` as the authoritative instant and parse it as UTC/ISO 8601.
Do not calculate the deadline only from the phone's next midnight because an
archived advertisement can produce an earlier deadline.

The list normally contains only active boxes, but cleanup runs periodically.
Therefore, being present in the list is not a guarantee that a box is still
openable at that exact millisecond.

### `POST /api/treasureBox/open/{treasureBoxId}`

On success, `data` is the opened treasure-box row. The credited balance is not
returned separately. Refresh `GET /api/auth/profile` after success to obtain the
authoritative `coins` balance.

Important failures:

| HTTP status | Meaning | Flutter action |
|---|---|---|
| `400` | Box was already opened | Disable/remove it and refresh the box list and profile |
| `404` | Box does not exist or is not owned by the user | Remove it from local state and refresh |
| `410` | Box passed its claim deadline | Do not retry; refresh the box list |

An unopened box expires at the user's local midnight. If an archived ad's grace
deadline comes first, that earlier instant applies. A zero-reward box may have
`accountingStatus: "zero_reward"` and `coinsAwarded: 0`; opening it is still a
valid operation.

## Timezone Handling

Daily ad counts, advertisement assignments, and treasure boxes use the user's
local timezone. Acquired coins expire at the end of the next month in that same
timezone context.

Continue sending an IANA timezone name on every login:

```json
{
  "name": "App User",
  "email": "user@example.com",
  "oauthProvider": "google",
  "oauthId": "provider-user-id",
  "timezone": "America/Los_Angeles"
}
```

In Flutter, obtain this as an IANA identifier such as `Asia/Taipei`,
`America/Los_Angeles`, or `Europe/London`; do not send a fixed UTC offset such as
`UTC+8`.

If timezone is missing or invalid, the backend uses `Asia/Taipei`. Deadlines
already assigned to an ad or treasure box use their stored timezone snapshot,
so changing the device timezone does not rewrite an existing deadline.

## Decimal Coin Values

The conversion rate is:

```text
NT$1 = 10 coins
```

Coins may now contain up to two decimal places. Valid examples include `15`,
`7.5`, and `52.25`.

Update all Flutter models and calculations that currently use `int` for:

- `user.coins`
- `user.coinsExpireSoon`
- `treasureBox.coinsAwarded`
- `order.discountCoin`
- `order.coinInfo[month]`
- refund `coins`, `cashRemainderCoins`, and `returnableCoins`
- any cart/checkout state derived from coin values

Parse JSON coin values as `num`, then use integer hundredths or a decimal
library for calculations. For example:

```dart
int toCoinUnits(num coins) => (coins.toDouble() * 100).round();
num fromCoinUnits(int units) => units / 100;
```

Do not round coins to a whole number for display or before sending
`discountCoin`. Hide only unnecessary trailing zeroes: display `15`, `7.5`, and
`52.25`, not `15.00`, `8`, or `52`.

## Order and Coin Spending

### `POST /api/order`

The request shape is unchanged, but `discountCoin` can be fractional:

```json
{
  "discountCoin": 4.25
}
```

- Send no more than two decimal places.
- Do not send coin source months or coin-lot IDs. The backend spends the
  earliest-expiring eligible coins first.
- `coinInfo` is response/accounting data and remains initially `null`. After the
  order becomes `paid`, it records the amount consumed from each earning month,
  for example `{ "2026-07": 2, "2026-08": 48 }`.
- During `payment-processing`, coins are reserved and the visible user balance
  is reduced. If payment fails, expires, or is cancelled, unexpired reserved
  coins return to the user. Coins that expire while reserved remain reserved
  until that bounded payment process resolves; if it fails after expiry, those
  expired coins are not restored.

After a payment result or a non-paid terminal status, refresh the order and user
profile instead of adjusting the balance only in local state.

## Refund Display

### `POST /api/refund`

The request fields are unchanged. The response now includes these calculated
fields:

```dart
class RefundAmounts {
  num? paidRefundAmount;
  num extraRefundAmount;
  int? cashRefundAmount;
  num cashRemainderCoins;
  num coins;
  num? returnableCoins;
}
```

Interpret them as follows:

| Field | Meaning |
|---|---|
| `cashRefundAmount` | Actual whole-TWD cash payout |
| `cashRemainderCoins` | Fractional TWD remainder converted at 10 coins per TWD |
| `coins` | Original order coins associated with this refund |
| `returnableCoins` | Coins actually credited when completed; includes eligible original coins and conversion coins |

Example:

```text
Paid product refund:  NT$94.53
Extra refund:         NT$0.72
Raw cash total:       NT$95.25
cashRefundAmount:     NT$95
cashRemainderCoins:   2.5 coins
```

Use `cashRefundAmount` for the cash amount shown to the user. Explain in a note
that the fractional TWD part is converted at `NT$1 = 10 coins`; do not present
the fractional part as TWD cash.

Creating the refund leaves it in `pending` and does not credit coins yet. Coin
credit happens only when the refund reaches `completed`:

- Original spent coins are restored only if their original coin lots have not
  expired.
- Original coins whose lots have expired are not restored to the user.
- `cashRemainderCoins` are issued as new coins at completion and expire at the
  end of the next month in the user's timezone.
- The completed refund's `returnableCoins` is the authoritative total actually
  credited to the user.

The app can receive the existing refund-status notification, then refresh
`GET /api/order/{id}` and `GET /api/auth/profile`. Nested refund items in order
detail expose the same fields and may also contain `summary.coinByMonth` for an
audit breakdown; Flutter does not need that breakdown for the normal user UI.

## No Flutter API Needed for Internal Accounting

Flutter does not send or store any of the following:

- seller ID or advertisement funding source for a coin
- coin-lot ID
- advertisement assignment ID
- settlement cohort or platform-advance data
- seller-return transaction data

Those values are derived and maintained by the backend. The user's public coin
balance remains `data.coins` from `GET /api/auth/profile`.

## Flutter Acceptance Checklist

- A video-complete request always contains the played advertisement's UUID.
- Repeated taps cannot submit video completion concurrently.
- HTTP `409` on video completion refreshes the ad list and does not increment
  local progress.
- HTTP `410` on box opening refreshes the box list.
- A box countdown uses `claimDeadlineAt` when provided.
- Login sends a valid current IANA timezone.
- Coin models, checkout inputs, and UI support `7.5` and `52.25` without
  integer rounding.
- Order payment-result screens refresh the profile balance.
- Refund UI shows whole-TWD `cashRefundAmount` and explains converted
  `cashRemainderCoins`.
- Pending refunds do not increase the displayed balance; completed refunds
  trigger an order/profile refresh.

