**Refund Admin API Swagger Updates**

Base path: `/api/admin/refund`

Added admin refund APIs:

| Method  | Path                                      | Description                                   |
| ------- | ----------------------------------------- | --------------------------------------------- |
| `GET`   | `/api/admin/refund/list`                  | List refund items with filters and pagination |
| `GET`   | `/api/admin/refund/{refundItemId}`        | Get one refund item by ID                     |
| `POST`  | `/api/admin/refund`                       | Create a refund item                          |
| `PATCH` | `/api/admin/refund/{refundItemId}/status` | Update refund item status only                |

**GET `/api/admin/refund/list`**

Query params:

| Field       | Type             | Required | Notes                                             |
| ----------- | ---------------- | -------- | ------------------------------------------------- |
| `page`      | integer          | No       | Default `1`                                       |
| `limit`     | integer          | No       | Default `10`                                      |
| `userId`    | uuid             | No       | Filter by order user                              |
| `productId` | uuid             | No       | Filter by product                                 |
| `startAt`   | date-time string | No       | Filter by refund created time                     |
| `endAt`     | date-time string | No       | Filter by refund created time                     |
| `status`    | string           | No       | `pending`, `processing`, `completed`, `cancelled` |

Response data:

```ts
{
  refunds: RefundWithOrderItem[],
  total: number,
  page: number,
  limit: number,
  totalPages: number
}
```

**GET `/api/admin/refund/{refundItemId}`**

Path params:

| Field          | Type | Required |
| -------------- | ---- | -------- |
| `refundItemId` | uuid | Yes      |

Response data:

```ts
RefundWithOrderItem;
```

**POST `/api/admin/refund`**

Request body:

| Field          | Type    | Required | Notes                                    |
| -------------- | ------- | -------- | ---------------------------------------- |
| `orderItemId`  | uuid    | Yes      | The order item to refund                 |
| `quantity`     | integer | Yes      | Must be positive                         |
| `reason`       | string  | No       | Optional refund reason                   |
| `note`         | string  | No       | Nullable                                 |
| `refundAmount` | number  | No       | Defaults to order item `unitPriceAtSale` |
| `metadata`     | object  | No       | Nullable                                 |

Only `orderItemId` and `quantity` are required.

The related order must have status `paid` in all environments.

In staging and production, the related delivery must already have status
`delivered`; otherwise refund creation will be rejected.

**PATCH `/api/admin/refund/{refundItemId}/status`**

Path params:

| Field          | Type | Required |
| -------------- | ---- | -------- |
| `refundItemId` | uuid | Yes      |

Request body:

| Field    | Type   | Required | Notes                                             |
| -------- | ------ | -------- | ------------------------------------------------- |
| `status` | string | Yes      | `pending`, `processing`, `completed`, `cancelled` |

Notes:

- Status is the only mutable refund item field.
- Once a refund item is `completed`, status cannot be changed again.
- Completing a refund may update coin summary data.

**Refund Response Shape**

`RefundWithOrderItem` includes:

```ts
{
  id: string,
  orderItemId: string,
  quantity: number,
  status: "pending" | "processing" | "completed" | "cancelled",
  reason: string,
  note: string | null,
  refundAmount: number | null,
  metadata: object | null,
  summary: {
    totalCoin: number,
    coinByMonth: Record<string, number>
  } | null,

  orderItem: {
    // order item fields
    product: Product,
    order: {
      // order fields
      user: {
        name: string | null,
        email: string
      }
    }
  }
}
```

**Delivery Swagger Update**

`GET /api/admin/delivery/{deliveryId}` now documents that each delivery `items[]` entry includes:

```ts
{
  product: Product,
  refundItems: RefundItem[]
}
```
