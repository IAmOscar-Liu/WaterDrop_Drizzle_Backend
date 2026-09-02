# Product Variants Frontend API Changes

This file is for the admin/frontend developer. It excludes Flutter-only behavior and backend-only ECPay logistics details.

## Product Variant Model

Price and inventory belong to variants. Product responses keep a computed root
`price` equal to the minimum eligible variant price:

```ts
type ProductVariant = {
  id: string;
  productId: string;
  name: string | null;
  sku: string | null;
  price: number;
  images: string[] | null;
  optionValues: Record<string, unknown>;
  stock: number;
  reserve: number;
  availableStock: number;
  sortOrder: number;
  status: "active" | "inactive";
  metadata: Record<string, unknown> | null;
};
```

Products have two valid active-variant modes:

- Simple product: exactly one active variant, and its `name` must be `null` or omitted. Named historical variants may remain only when inactive. Do not show a variant selector.
- Variant product: at least two active variants, and every active variant must have a non-empty `name`. The unnamed default variant must be absent or inactive. Show variant selection.

At most one unnamed default variant row may exist. The backend rejects no active variants, one active named variant, or a mix of active named and unnamed variants.

Variants are not deleted. To remove a variant from sale, update it with `status: "inactive"`.

## Admin Product Create

`POST /api/admin/product/create`

Request body:

```ts
{
  sellerId: string;
  name: string;
  description: string;
  variants: Array<{
    name?: string | null;
    sku?: string | null;
    price: number;
    images?: string[] | null;
    optionValues: Record<string, unknown>;
    stock: number;
    sortOrder?: number;
    status?: "active" | "inactive";
    metadata?: Record<string, unknown> | null;
  }>;
  avatar?: string | null;
  type?: "normal" | "refrigeration" | "virtual";
  allowHomeDelivery?: boolean;
  images?: string[] | null;
  categoryIds?: string[];
  status?: "active" | "inactive";
  metadata?: Record<string, unknown> | null;
}
```

Rules:

- `variants` is required.
- Simple product: send exactly one active variant with `name: null`; any named variants must be inactive.
- Variant product: send at least two active named variants; the default unnamed variant must be absent or inactive.
- `stock` is required for every new variant.
- `price` is required for every new variant.
- `reserve` is read-only and cannot be sent.
- Product-level `stock`, `reserve`, and `sku` are not accepted.

## Admin Product Update

`PUT /api/admin/product/{id}`

Request body:

```ts
{
  variants?: Array<{
    id?: string;
    name?: string | null;
    sku?: string | null;
    price?: number;
    images?: string[] | null;
    optionValues?: Record<string, unknown>;
    stock?: number;
    sortOrder?: number;
    status?: "active" | "inactive";
    metadata?: Record<string, unknown> | null;
  }>;
}
```

Variant update behavior:

- If `id` is provided, backend updates that existing variant.
- If `id` is omitted, backend creates a new variant.
- New variants require `price`, `optionValues`, and `stock`.
- Existing variants cannot be deleted.
- To hide/remove a variant from sale, set `status: "inactive"`.
- If a variant has `reserve > 0`, `stock` cannot be reduced below `reserve`.
- After update, the active persisted variant set must still be valid:
  - exactly one active unnamed default variant with all named variants inactive, or
  - at least two active named variants with the unnamed default absent or inactive.
- Inactive historical named variants may remain in either mode, but only one unnamed default row may exist.

## Admin Product Responses

Product list/detail responses include `variants`.

Admin product responses include inactive variants so the UI can manage history-safe status changes.

```ts
type ProductDetail = Product & {
  availableStock: number;
  variants: ProductVariant[];
};
```

Use variant-level `stock`, `reserve`, and `availableStock` for inventory UI.

## Order, Delivery, Refund Display

Historical order item variant display uses `variantAtSale`, not the live variant row.

```ts
variantAtSale: {
  name: string | null;
  sku: string | null;
  optionValues: Record<string, unknown> | null;
  price: number;
}

variantImage: string | null;
```

`variantImage` is a sibling of `variantAtSale`. It is the current first image
of the live variant and is not a historical snapshot. It is `null` when the
variant currently has no image.

Admin order, delivery, and refund APIs should not display `product.variant` when `variantAtSale` is present.

Admin order list `merchantTradeNo` searches order or delivery merchant trade number prefix.

Admin delivery list `merchantTradeNo` searches delivery merchant trade number prefix only.

Admin users do not create deliveries directly from the admin frontend.

## Refund Logs

Refund logs are append-only status/message history:

```ts
type RefundLog = {
  id: string;
  refundItemId: string;
  status: "pending" | "processing" | "completed" | "cancelled";
  message: string | null;
  createdAt: string;
};
```

- `GET /api/admin/refund/{id}` returns `logs: RefundLog[]` at the refund root.
- `GET /api/admin/order/{id}` returns `logs` under every
  `items[].refundItems[]` object.
- Logs are ordered newest first. Existing refunds may return `logs: []` because
  they are not backfilled.
- New refund requests start with a pending log whose message is `申請退貨`.
- `PATCH /api/admin/refund/{id}/status` accepts optional non-empty
  `message: string` in addition to the existing fields.
- `refundAmount` is a per-unit amount and must be greater than zero and no
  greater than the order item's `unitPriceAtSale`; the backend rounds it and
  other refund financial values to two decimal places.
- Partial quantities are supported, but all non-cancelled refunds for an order
  item cannot exceed its purchased quantity.
- Coin fields are backend-calculated and read-only for admin/frontend clients.
- Both `completed` and `cancelled` refund statuses are terminal.
- A log is appended only when status changes or the provided message differs
  from the latest log message.
- Creating a refund sends the user fire-and-forget push and email notifications
  linked to order detail.
- An actual status change sends a fire-and-forget push/in-app notification only;
  message-only updates do not notify and no status-change email is sent.
- Refund-level `note` remains independent from log `message`.
- Refund and order list APIs do not include logs.

## Chatroom Display

Product-specific chat rooms include `productVariantId` and compact product display data:

```ts
product: {
  id: string;
  name: string;
  images: string[] | null;
  variantName: string | null;
  variantImage: string | null;
} | null;
```

Use `variantName` beside the product name when present. `variantImage` is the
current first image of the selected variant and is `null` when it has no image.
