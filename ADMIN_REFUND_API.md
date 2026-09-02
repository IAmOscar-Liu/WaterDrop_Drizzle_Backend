# Admin Refund API Guide

This document describes the current backend behavior for the admin/frontend
refund workflow. It is intended as the handoff document for frontend
implementation.

## Quick Reference

Base path: `/api/admin/refund`

All endpoints require bearer authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/refund/list` | Paginated refund list |
| `GET` | `/api/admin/refund/{refundItemId}` | Refund detail, including logs |
| `POST` | `/api/admin/refund` | Create a refund item |
| `PATCH` | `/api/admin/refund/{refundItemId}/status` | Update refund fields or status |

The update endpoint is `PATCH`, not `PUT`.

## Important Business Rules

- A refund belongs to one purchased `orderItem`.
- Partial refunds by quantity are supported.
- Multiple partial refund records can exist for the same order item.
- The combined quantity of all non-cancelled refunds cannot exceed the
  purchased quantity.
- A cancelled refund releases its quantity for a new refund request.
- `refundAmount` is the refund amount **per unit**, not the total.
- `refundAmount` must be greater than zero and cannot exceed the historical
  `unitPriceAtSale`.
- Refund financial values are rounded to two decimal places by the backend.
- Product price and coin calculations use purchase snapshots. Current product
  price and current user level do not affect the refund.
- Coin fields are backend-calculated and read-only for frontend clients.
- `completed` and `cancelled` are terminal statuses.
- Quantity and unit refund amount can be changed in the same request that marks
  a refund `completed`.

## Current Cash-Refund Limitation

Changing a refund to `completed` does **not** currently call ECPay or transfer
cash automatically.

The backend calculates and stores `paidRefundAmount`, restores inventory, and
returns eligible coins. Any actual cash payment/refund process is currently
outside this API.

`extraRefundAmount` is also stored separately. It is not included in
`paidRefundAmount`, does not affect coins, and is not sent to ECPay.

If the UI needs to display an expected total cash refund, the current fields
would normally be presented as:

```text
expected cash refund = paidRefundAmount + extraRefundAmount
```

This is a display calculation only; the backend does not expose a combined
cash-total field or execute that payment.

## Refund Data Model

```ts
type RefundStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled";

type RefundCoinMonthSummary = {
  coin: number;
  expired: boolean;
  returnedCoin: number;
};

type RefundSummary = {
  totalCoin: number;
  returnableCoin: number;
  coinByMonth: Record<string, RefundCoinMonthSummary>;
};

type RefundItem = {
  id: string;
  orderItemId: string;
  quantity: number;
  status: RefundStatus;
  reason: string;
  note: string | null;

  // Per-unit product refund amount.
  refundAmount: number | null;

  // Total product cash portion after proportional coin deduction.
  paidRefundAmount: number | null;

  // Separate cash adjustment; not included in paidRefundAmount.
  extraRefundAmount: number;

  // Proportional coin amount associated with this refund.
  coins: number;

  // Coins actually eligible to return when completed.
  returnableCoins: number | null;

  metadata: Record<string, unknown> | null;
  summary: RefundSummary | null;
  createdAt: string;
  updatedAt: string;
};
```

### Financial field meanings

| Field | Meaning | Frontend writable? |
| --- | --- | --- |
| `quantity` | Number of purchased units covered by this refund | Yes, before terminal status |
| `refundAmount` | Per-unit product refund amount | Yes, before terminal status |
| `paidRefundAmount` | Total product cash portion after coin deduction | No |
| `extraRefundAmount` | Additional separate adjustment | Yes |
| `coins` | Proportional coins associated with the refund | No |
| `returnableCoins` | Non-expired coins actually returned on completion | No |
| `summary` | Completion-time coin breakdown | No |

`paidRefundAmount` already includes `quantity`. Do not multiply it by quantity
again in the UI.

## Purchase Snapshot Behavior

Refund calculations use these order snapshots:

- `orderItem.unitPriceAtSale`: historical purchased unit price;
- `order.subTotal`: historical product subtotal;
- `order.discountCoin`: total coins used for the order;
- `order.coinInfo`: original coin usage grouped by month.

The refund calculation does not read the current variant price or current user
level. Later changes to either do not change an existing refund.

For historical product display, use:

```ts
orderItem.variantAtSale = {
  name: string | null;
  sku: string | null;
  optionValues: Record<string, unknown> | null;
  price: number; // unitPriceAtSale
};
```

Do not use `orderItem.product.price` as the historical purchase price. Product
root price is current/computed product data.

`orderItem.variantImage` is the current first image of the live variant. It is
not an image snapshot from the purchase date.

## Refund and Coin Formula

The backend calculates:

```text
product refund total = refundAmount * quantity

refund subtotal ratio =
  product refund total / order.subTotal

cash-paid ratio =
  (order.subTotal - order.discountCoin / 10) / order.subTotal

paidRefundAmount =
  product refund total * cash-paid ratio

coins =
  order.discountCoin * refund subtotal ratio
```

Negative cash-paid ratios are clamped to zero. Persisted refund and coin values
are rounded to two decimal places.

The conversion currently encoded by the backend is:

```text
10 coins = NT$1
```

### Detailed partial-refund example

Suppose an order has:

```text
Order subtotal:              NT$1,000
Coins used:                  2,000 coins = NT$200
Cash-paid portion:           NT$800 (80%)

Purchased item quantity:     3
Historical unit price:       NT$250
Requested refund quantity:   2
Per-unit refundAmount:       NT$250
extraRefundAmount:           NT$60
```

The backend calculates:

```text
Product refund total:
  2 * NT$250 = NT$500

paidRefundAmount:
  NT$500 * 80% = NT$400

coins:
  2,000 * (NT$500 / NT$1,000) = 1,000 coins

Separate extra adjustment:
  NT$60

Expected cash display, if needed:
  NT$400 + NT$60 = NT$460
```

When completed:

- stock is increased by `2`;
- up to `1,000` coins are returned;
- expired source-month coins are not added back to the user's live balance;
- `returnableCoins` records the amount actually returned;
- `summary.coinByMonth` explains returned versus expired coins.

### Multiple partial refunds

For a purchased quantity of `3`:

```text
Refund A: pending, quantity 1
Refund B: processing, quantity 1
Remaining refundable quantity: 1
```

A new refund with quantity `2` is rejected. A new refund with quantity `1` is
allowed.

If Refund A becomes `cancelled`, its quantity no longer counts, so the remaining
refundable quantity becomes `2`.

Refund A cannot later transition from `cancelled` to `completed`. A new refund
record must be created instead.

## Status Workflow

### Transition matrix

| Current status | Allowed next status |
| --- | --- |
| `pending` | `processing`, `completed`, `cancelled` |
| `processing` | `pending`, `completed`, `cancelled` |
| `completed` | None; terminal |
| `cancelled` | None; terminal |

Sending the same current status is an idempotent status operation. It does not
trigger a status-change notification. A new log can still be created if a new
`message` is supplied.

### Completion side effects

When status actually changes to `completed`, one database transaction:

1. locks the refund and related order data;
2. uses the final quantity and per-unit refund amount;
3. restocks the purchased product variant;
4. calculates the proportional coin allocation from order snapshots;
5. returns non-expired coins to the user;
6. reverses corresponding monthly `coinsSpent` values;
7. saves `returnableCoins` and `summary`;
8. updates the refund status;
9. inserts a refund log.

Push/in-app notification work is triggered after the transaction. No
status-change email is sent.

## Refund Logs

```ts
type RefundLog = {
  id: string;
  refundItemId: string;
  status: RefundStatus;
  message: string | null;
  createdAt: string;
};
```

- New refunds start with a `pending` log and message `申請退貨`.
- Detail logs are ordered newest first.
- Existing historical refunds may have `logs: []` because logs were not
  backfilled.
- `message` belongs to the history log.
- `note` belongs to the refund item itself.
- A log is added when status actually changes or a supplied message differs
  from the latest log message.
- Updating quantity, financial fields, reason, note, or metadata alone does not
  create a log.
- The list endpoint does not include logs.

## Notifications

| Event | Push/in-app | Email |
| --- | --- | --- |
| Refund created | Yes | Yes |
| Status actually changed | Yes | No |
| Message-only update | No | No |
| Quantity/amount/note-only update | No | No |

Notification work is fire-and-forget. API success means the database operation
succeeded; it does not guarantee external notification delivery.

Push data uses:

```ts
{
  command: "refund_updated";
  orderId: string;
  refundItemId: string;
}
```

The client should open order detail.

## `GET /api/admin/refund/list`

Returns refund items newest first.

### Query parameters

| Field | Type | Required | Behavior |
| --- | --- | --- | --- |
| `page` | positive integer | No | Default `1` |
| `limit` | positive integer | No | Default `10` |
| `userId` | UUID | No | Exact order-user filter |
| `productId` | UUID | No | Exact product filter |
| `merchantTradeNo` | string | No | Order or delivery trade-number prefix; ignored when shorter than 4 characters |
| `startAt` | ISO date-time | No | Inclusive refund `createdAt` lower bound |
| `endAt` | ISO date-time | No | Inclusive refund `createdAt` upper bound |
| `status` | `RefundStatus` | No | Exact status filter |

Admin accounts see all matching refunds. Any non-admin authenticated account is
scoped to products whose `sellerId` matches that account.

### Response

```ts
type ListRefundsData = {
  refunds: RefundWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};
```

```json
{
  "success": true,
  "data": {
    "refunds": [],
    "total": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 0
  }
}
```

List rows include related order item, product, delivery, order, and user/bank
display data. They do not include `logs`.

## `GET /api/admin/refund/{refundItemId}`

Returns the same related display data as a list row and adds:

```ts
logs: RefundLog[];
```

The related user contains:

```ts
{
  id: string;
  name: string | null;
  email: string;
  bankCode: string | null;
  bankName: string | null;
  bankAccount: string | null;
}
```

Use this endpoint when opening refund detail or history. A missing refund returns
`404`.

## `POST /api/admin/refund`

Creates a new `pending` refund.

### Request body

```ts
type CreateAdminRefundBody = {
  orderItemId: string;
  quantity: number;
  reason?: string;
  note?: string | null;
  refundAmount?: number;
  extraRefundAmount?: number;
  metadata?: Record<string, unknown> | null;
};
```

| Field | Required | Rules |
| --- | --- | --- |
| `orderItemId` | Yes | UUID of the purchased order item |
| `quantity` | Yes | Positive integer within remaining refundable quantity |
| `reason` | No | Non-empty when supplied; stored as `""` when omitted |
| `note` | No | Refund-level internal/application note |
| `refundAmount` | No | Per-unit, greater than `0`, at most historical unit price; defaults to historical unit price |
| `extraRefundAmount` | No | Non-negative separate adjustment; defaults to `0` |
| `metadata` | No | JSON object or `null` |

Amounts are rounded to two decimal places before validation and persistence.
For example, `10.075` becomes `10.08`; a value that rounds to `0` is rejected as
a zero-value product refund.

### Preconditions

- The order item must exist.
- The order must exist and have status `paid`.
- The order item must have a delivery.
- In staging and production, the delivery must be `delivered`.
- Requested quantity plus all other non-cancelled refund quantities must not
  exceed the purchased quantity.
- The resulting per-unit refund amount must be greater than zero and cannot
  exceed the rounded historical unit price.

### Example: create a partial refund

```json
{
  "orderItemId": "2d9251f2-5fa5-47e1-88a4-bad6beb43b52",
  "quantity": 1,
  "reason": "商品有瑕疵",
  "note": "外盒破損",
  "refundAmount": 250,
  "extraRefundAmount": 60,
  "metadata": {
    "source": "admin"
  }
}
```

The response is the created `RefundItem`. Fetch detail if logs and related order
display data are needed.

## `PATCH /api/admin/refund/{refundItemId}/status`

Despite the `/status` suffix, this endpoint can update more than status.

At least one recognized field is required:

```ts
type UpdateAdminRefundBody = {
  status?: RefundStatus;
  quantity?: number;
  refundAmount?: number;
  reason?: string;
  note?: string | null;
  message?: string;
  extraRefundAmount?: number;
  metadata?: Record<string, unknown> | null;
};
```

### Field behavior

| Field | Rules |
| --- | --- |
| `status` | Must follow the transition matrix |
| `quantity` | Positive integer; mutable only while current status is pending or processing |
| `refundAmount` | Positive per-unit amount; mutable only while current status is pending or processing |
| `reason` | Non-empty when supplied |
| `note` | Refund-level note; independent from logs |
| `message` | Non-empty refund-log message; does not update `note` |
| `extraRefundAmount` | Non-negative separate adjustment, rounded to two decimals |
| `metadata` | JSON object or `null` |

The backend currently allows `reason`, `note`, `extraRefundAmount`, and
`metadata` to be edited even after a refund is terminal. Quantity,
`refundAmount`, and status cannot be changed after `completed` or `cancelled`.

### Complete and change quantity atomically

This is supported:

```json
{
  "status": "completed",
  "quantity": 2,
  "refundAmount": 250,
  "message": "已確認退貨並完成退款"
}
```

The backend validates the final quantity, recalculates `paidRefundAmount` and
coins, restocks quantity `2`, applies coin completion side effects, changes the
status, and inserts the log in one transaction.

This request is rejected when the current status is already `completed` or
`cancelled`.

### Processing example

```json
{
  "status": "processing",
  "message": "賣家已收到申請，正在確認商品狀況"
}
```

### Cancel example

```json
{
  "status": "cancelled",
  "message": "買家取消退貨申請"
}
```

After cancellation, create a new refund if another request is needed. Do not
attempt to restore the cancelled refund to pending or completed.

### Message-only example

```json
{
  "message": "等待買家補充照片"
}
```

This creates a log only when the message differs from the latest log message.
It does not send a notification and does not change `note`.

## Error Responses

General service error shape:

```ts
type ErrorResponse = {
  success: false;
  statusCode: number;
  message: unknown;
};
```

Zod request-validation errors return `message` as an array:

```json
{
  "success": false,
  "statusCode": 400,
  "message": [
    {
      "field": "refundAmount",
      "message": "Too small: expected number to be >0"
    }
  ]
}
```

Some refund business-validation failures currently return `message` as a
JSON-encoded string:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "{\"error\":[{\"orderItemId\":\"...\",\"reason\":\"Refund quantity exceeds remaining refundable quantity\",\"quantity\":2,\"remaining\":1}]}"
}
```

Frontend should display a safe fallback message if it cannot parse this legacy
business-error string.

Common business error reasons include:

- `Order item not found`
- `Order not found`
- `Order is not paid`
- `Order item delivery not found`
- `Delivery not found`
- `Delivery is not delivered`
- `Order item already fully refunded`
- `Invalid refund quantity`
- `Refund quantity exceeds remaining refundable quantity`
- `Refund amount must be greater than zero`
- `Refund amount exceeds unit price at sale`
- `Cannot change status once refund is completed`
- `Cannot change status once refund is cancelled`
- `Cannot change quantity or refund amount once refund is completed or cancelled`

## Recommended Frontend Behavior

- Label `refundAmount` as **per-unit refund amount**.
- Display a calculated product refund total as
  `refundAmount * quantity` only when useful; do not confuse it with
  `paidRefundAmount`.
- Treat `paidRefundAmount`, `coins`, `returnableCoins`, and `summary` as
  read-only.
- Show `returnableCoins` only after completion; before completion it may be
  `null`.
- Display `extraRefundAmount` separately.
- Use `variantAtSale.price` for purchased price and `variantAtSale.name` for
  historical variant display.
- Do not use the current product price for refund limits or historical display.
- Disable status controls after `completed` or `cancelled`.
- Allow quantity and refund amount edits while pending/processing.
- Allow submitting final quantity/refund amount together with `completed`.
- Use detail endpoint for logs; do not expect logs in list rows.
- After a successful mutation, refetch refund detail or the relevant order
  detail so backend-calculated coin and summary values are authoritative.
- Do not show cash as automatically refunded through ECPay; that integration is
  not currently implemented.
