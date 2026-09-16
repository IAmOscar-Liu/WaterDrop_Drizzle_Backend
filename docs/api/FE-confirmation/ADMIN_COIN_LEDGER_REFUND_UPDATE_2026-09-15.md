# Admin Frontend Swagger Update — 2026-09-15

Audience: admin web frontend developers.

Scope: authenticated endpoints under `/api/admin`. App-user endpoints and the
local/development manual-coin command are intentionally excluded.

## Swagger UI

Swagger UI is served at `/api-docs` and now includes only `/api/admin` APIs.
Groups are displayed in this order:

1. Account
2. Product
3. Advertisement
4. Order
5. Delivery
6. Refund
7. Chatroom
8. File
9. System

All endpoints in this document require the existing bearer token unless stated
otherwise.

Successful service responses use this envelope:

```ts
type SuccessResponse<T> = {
  success: true;
  data: T;
};
```

Failed responses use the existing `success: false` service-response format.
The frontend should use the HTTP status and display or map `message` when
available.

## Required frontend work

- Add the advertisement lifecycle fields and new accounting totals.
- Add an advertisement coin-ledger view.
- Support archive, financial-close, replacement creation, and optional balance
  transfer as separate operations.
- Update refund models and forms for fractional-TWD conversion, editable refund
  fields, refund logs, and trade-number search.
- Preserve exact advertisement accounting strings; do not perform financial
  arithmetic with JavaScript floating-point numbers.

## Advertisement changes

### Advertisement fields

Advertisement responses can now include:

```ts
type AdvertisementLifecycleFields = {
  archivedAt: string | null;
  archiveGraceEndsAt: string | null;
  financiallyClosedAt: string | null;
  replacementOfAdvertisementId: string | null;
};
```

Meanings:

| Field | Meaning |
| --- | --- |
| `archivedAt` | Time the advertisement permanently entered `archived`. |
| `archiveGraceEndsAt` | Existing issued assignments may finish until this time, subject to treasure-box expiry. |
| `financiallyClosedAt` | Time all remaining ad funding was financially closed. |
| `replacementOfAdvertisementId` | Archived ad directly replaced by this advertisement. |

Advertisement status values remain:

```ts
type AdvertisementStatus = "active" | "paused" | "depleted" | "archived";
```

`archived` is terminal and cannot be reactivated. `paused` and `depleted` are
not terminal.

### Advertisement statistics

Advertisement statistics now include:

```ts
type AdvertisementAccountingStats = {
  totalSpent: number;
  sellerReturnedCurrencyAmount: string;
  returnedCoinAmount: string;
  netSettledSpentAmount: string;
};
```

| Field | Meaning |
| --- | --- |
| `totalSpent` | Gross TWD charged for ad views; returns do not reduce it. |
| `sellerReturnedCurrencyAmount` | Accumulated TWD-equivalent amount returned to the ad balance. |
| `returnedCoinAmount` | Accumulated coins returned to the ad balance. |
| `netSettledSpentAmount` | Gross view spend minus settled seller returns, never below zero. |

The three new accounting totals are decimal strings.

### Advertisement transaction fields

Advertisement transactions can now include:

```ts
type AdvertisementTransaction = {
  id: string;
  advertisementId: string;
  amount: number;
  coinAmount: string | null;
  coinToCurrencyRate: string | null;
  sourceSellerId: string | null;
  adViewCountId: string | null;
  balanceBefore: string | null;
  balanceAfter: string | null;
  idempotencyKey: string | null;
  type:
    | "deposit"
    | "view_debit"
    | "seller_return_credit"
    | "balance_transfer_out"
    | "balance_transfer_in"
    | "manual_adjustment";
};
```

### GET `/api/admin/advertisement/{id}/coin-ledger`

Returns accounting details for an advertisement owned by the authenticated
seller. Platform administrators may inspect all advertisements.

There are no pagination parameters. The response currently contains the newest
100 cohorts, newest 100 seller returns, and newest 200 funding transactions.

```ts
type AdvertisementCoinLedger = {
  fundingAccount: {
    id: string;
    advertisementId: string;
    sourceSellerId: string;
    coinToCurrencyRate: string;
    sellerFundingAvailableAmount: string;
    platformAdvanceOutstandingAmount: string;
    platformFundedConsumedAmount: string;
    platformPromotionalExpenseAmount: string;
    status: "active" | "closing" | "closed" | "exception";
    openedAt: string;
    closedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  cohorts: AdvertisementCoinSettlementCohort[];
  sellerReturns: SellerCoinReturnTransaction[];
  fundingTransactions: AdvertisementCoinFundingTransaction[];
};
```

Representative response:

```json
{
  "success": true,
  "data": {
    "fundingAccount": {
      "id": "11111111-1111-4111-8111-111111111111",
      "advertisementId": "22222222-2222-4222-8222-222222222222",
      "sourceSellerId": "33333333-3333-4333-8333-333333333333",
      "coinToCurrencyRate": "10.000000",
      "sellerFundingAvailableAmount": "15.00",
      "platformAdvanceOutstandingAmount": "0.00",
      "platformFundedConsumedAmount": "0.00",
      "platformPromotionalExpenseAmount": "0.00",
      "status": "active",
      "openedAt": "2026-09-13T01:00:00.000Z",
      "closedAt": null,
      "createdAt": "2026-09-13T01:00:00.000Z",
      "updatedAt": "2026-09-13T01:05:00.000Z"
    },
    "cohorts": [],
    "sellerReturns": [],
    "fundingTransactions": []
  }
}
```

All coin and currency amounts inside this endpoint are exact decimal strings.
Use a decimal library or display them as received.

Error handling:

| Status | Meaning |
| --- | --- |
| `403` | Authenticated seller does not own the advertisement. |
| `404` | Advertisement or funding account was not found. |
| `409` | Coin ledger is not enabled in the environment. |

#### Settlement cohorts

A cohort is one advertisement's funding/accounting group for one Taipei
business date.

```ts
type AdvertisementCoinSettlementCohort = {
  id: string;
  fundingAccountId: string;
  businessDate: string;
  claimSettlementAt: string | null;
  openingPlatformAdvanceAmount: string;
  sellerFundedAmount: string;
  acquiredRewardAmount: string;
  advanceCreatedAmount: string;
  advanceRepaidAmount: string;
  advanceCancelledAtExpiryAmount: string;
  sellerSurplusReturnedAmount: string;
  closingPlatformAdvanceAmount: string;
  status: "open" | "settling" | "settled" | "exception";
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

#### Seller returns

```ts
type SellerCoinReturnTransaction = {
  id: string;
  sourceSellerId: string;
  advertisementId: string;
  fundingAccountId: string;
  settlementCohortId: string | null;
  rewardAllocationId: string | null;
  userCoinLotId: string | null;
  reason:
    | "unacquired_surplus"
    | "expired_unused"
    | "refund_after_expiry"
    | "manual";
  coinAmount: string;
  coinToCurrencyRate: string;
  currencyEquivalent: string;
  destinationType: "advertisement_balance";
  destinationReferenceId: string;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};
```

Recommended labels:

| Reason | Suggested label |
| --- | --- |
| `unacquired_surplus` | Unclaimed reward returned |
| `expired_unused` | Unused coins expired |
| `refund_after_expiry` | Refunded expired coins returned |
| `manual` | Manual return |

#### Funding transactions

`fundingTransactions[].type` values are:

```text
view_funded
reward_acquired_seller_funded
platform_advance_created
platform_advance_repaid
funding_source_reclassified
platform_advance_cancelled_expiry
platform_advance_written_off_archive
coin_consumed
coin_consumption_reversed
seller_surplus_returned
seller_unused_returned
seller_refund_after_expiry_returned
manual_adjustment
```

The object also includes nullable links such as `settlementCohortId`,
`adViewCountId`, `treasureBoxRewardAllocationId`, `userCoinLotId`, and
`sellerReturnTransactionId`, plus `coinAmount`, `currencyEquivalent`,
`coinToCurrencyRate`, `idempotencyKey`, `metadata`, and `createdAt`.

### POST `/api/admin/advertisement/{id}/financial-close`

Request body: none.

Financial closure:

- requires the ad to be `archived`;
- requires `archiveGraceEndsAt` to have passed;
- requires all treasure-box claims attributed to the ad to be resolved;
- returns remaining seller-funded surplus to the archived ad balance;
- writes off any remaining platform advance as a platform promotional expense;
- sets the funding account to `closed` and populates
  `financiallyClosedAt`.

The operation is idempotent after successful closure: calling it again returns
the already closed advertisement.

Response data is the updated `Advertisement` object. Handle `403`, `404`, and
`409`; a `409` means the lifecycle prerequisites are not yet satisfied or the
ledger is disabled.

### Creating a replacement advertisement

Use the existing endpoint:

```http
POST /api/admin/advertisement/create
```

The same `productId` may be used again only after the previous advertisement is
archived and financially closed. The backend automatically sets the new ad's
`replacementOfAdvertisementId`; the frontend does not send it.

Creation returns `409` when the product still has a non-archived advertisement
or its latest archived advertisement has not been financially closed.

### POST `/api/admin/advertisement/{id}/balance-transfer`

Transfers remaining currency balance from a financially closed archived ad to
its direct replacement.

Request:

```json
{
  "destinationAdvertisementId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "amount": 20,
  "idempotencyKey": "transfer-archived-ad-20260915-001"
}
```

`idempotencyKey` must contain 8–200 characters. Generate one key for each user
intent and retain it when retrying the same request. Do not reuse it for another
transfer.

Response:

```ts
type AdvertisementBalanceTransfer = {
  id: string;
  sourceAdvertisementId: string;
  destinationAdvertisementId: string;
  sourceSellerId: string;
  coinAmount: string;
  coinToCurrencyRate: string;
  currencyAmount: string;
  sourceBalanceBefore: string;
  sourceBalanceAfter: string;
  destinationBalanceBefore: string;
  destinationBalanceAfter: string;
  idempotencyKey: string;
  createdAt: string;
};
```

Rules:

- Source and destination must be different.
- Source must be archived and financially closed.
- Destination cannot be archived.
- Destination must be the source's direct replacement for the same product and
  seller.
- Source must have enough balance.
- A transfer does not automatically activate the destination ad.
- Returning money to a depleted or paused ad also does not activate it.

Handle `400` for invalid amount or insufficient balance, `403` for ownership,
`404` for missing ads, and `409` for an invalid lifecycle/replacement pair.

### Recommended advertisement UI flow

```text
Archive old ad
  -> wait until archiveGraceEndsAt and claims resolve
  -> financially close old ad
  -> create replacement using the same productId
  -> optionally transfer old balance to the replacement
  -> explicitly activate the replacement when eligible
```

## Refund changes

### Refund model

Admin refund responses include these financial fields:

```ts
type RefundItemFinancials = {
  refundAmount: number | null;
  paidRefundAmount: number | null;
  extraRefundAmount: number;
  cashRefundAmount: number | null;
  cashRemainderCoins: number;
  coins: number;
  returnableCoins: number | null;
  summary: RefundSummary | null;
};
```

Meanings:

| Field | Meaning |
| --- | --- |
| `refundAmount` | Unit refund price before proportional order-level coin deduction. |
| `paidRefundAmount` | Product refund paid as money after the proportional coin deduction. |
| `extraRefundAmount` | Additional money for shipping, fees, or manual adjustment. |
| `cashRefundAmount` | Whole-TWD payout after combining paid and extra refund amounts and rounding down. |
| `cashRemainderCoins` | Fractional TWD converted using NT$1 = 10 coins. |
| `coins` | Original order coins reversed for this refund. |
| `returnableCoins` | Coins actually credited at completion, including fractional-cash conversion; `null` before completion. |
| `summary` | Final per-month coin result; `null` before completion. |

Example:

```text
paidRefundAmount = 57.06
extraRefundAmount = 0
cashRefundAmount = 57
cashRemainderCoins = 0.6
```

The user receives NT$57 in cash. The NT$0.06 remainder becomes 0.6 coins when
the refund changes to `completed`.

### Refund summary

```ts
type RefundSummary = {
  totalCoin: number;
  returnableCoin: number;
  originalReturnableCoin: number;
  cashRemainderCoin: number;
  cashRemainderExpiresAt: string | null;
  cashRemainderSourceSellerId: string | null;
  coinByMonth: Record<
    string,
    {
      coin: number;
      expired: boolean;
      returnedCoin: number;
    }
  >;
};
```

`coinByMonth` keys use `YYYY-MM`. Original order coins from an expired lot are
not restored to the user. Such an entry has `expired: true` and
`returnedCoin: 0`; its funding is returned through the accounting ledger.

Fractional-cash conversion coins form a new seller-funded lot and expire at the
end of the next month in the user's timezone. Their expiry is reported by
`cashRemainderExpiresAt`.

### GET `/api/admin/refund/list`

The list endpoint now accepts:

```ts
type RefundListQuery = {
  page?: number;
  limit?: number;
  userId?: string;
  productId?: string;
  merchantTradeNo?: string;
  startAt?: string;
  endAt?: string;
  status?: "pending" | "processing" | "completed" | "cancelled";
};
```

`merchantTradeNo` searches both the order and delivery trade-number prefixes.
The backend ignores values shorter than four characters, so the frontend should
wait for at least four characters before sending the filter.

### GET `/api/admin/refund/{refundItemId}`

The detail response includes `logs` in reverse chronological order:

```ts
type RefundLog = {
  id: string;
  refundItemId: string;
  status: "pending" | "processing" | "completed" | "cancelled";
  message: string | null;
  createdAt: string;
};
```

Older refunds may have an empty `logs` array.

### POST `/api/admin/refund`

Request:

```ts
type CreateRefundRequest = {
  orderItemId: string;
  quantity: number;
  reason?: string;
  note?: string | null;
  refundAmount?: number;
  extraRefundAmount?: number;
  metadata?: Record<string, unknown> | null;
};
```

Only `orderItemId` and `quantity` are required. `refundAmount` defaults to the
historical unit sale price; `extraRefundAmount` defaults to zero. Monetary input
is rounded to two decimal places.

On creation, the backend creates a pending log with message `申請退貨` and sends
the user a push notification and email. The created response already contains
the calculated cash/coin preview, but `summary` and `returnableCoins` remain
`null` until completion.

### PATCH `/api/admin/refund/{refundItemId}/status`

Despite the historical `/status` suffix, this endpoint can update any
combination of:

```ts
type UpdateRefundRequest = {
  status?: "pending" | "processing" | "completed" | "cancelled";
  quantity?: number;
  refundAmount?: number;
  reason?: string;
  note?: string | null;
  message?: string;
  extraRefundAmount?: number;
  metadata?: Record<string, unknown> | null;
};
```

At least one field is required.

Important behavior:

- `quantity`, `refundAmount`, and `extraRefundAmount` are editable only while
  the current status is `pending` or `processing`.
- `completed` and `cancelled` are terminal statuses.
- Changing to `completed` restocks the product variant and performs all cash
  and coin accounting atomically.
- `message` is a refund-log message and is independent of `note`.
- A log is appended only when status changes or `message` differs from the
  latest log message.
- A real status change sends a push notification. Message-only or other field
  edits do not send a notification, and status updates do not send email.
- Completion can return `503` when fractional cash must become coins but the
  coin ledger is disabled.

The frontend should show the calculated preview fields before completion, then
replace them with the returned completed refund and its final `summary`.

## Manual app-user coin credits

Manual app-user credits remain an environment-restricted backend CLI operation.
There is no `/api/admin` endpoint for this operation, so no admin frontend
control should be added for it.

## Compatibility notes

- Existing advertisement and refund fields remain available.
- New advertisement accounting decimals are strings.
- Refund financial fields are numbers.
- Nullable fields must remain nullable in frontend models.
- Unknown transaction types should fall back to a generic label so future
  accounting additions do not break the UI.
