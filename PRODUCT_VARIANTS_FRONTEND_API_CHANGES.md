# Product Variants Frontend API Changes

This file is for the admin/frontend developer. It excludes Flutter-only behavior and backend-only ECPay logistics details.

## Product Variant Model

Product price is shared by all variants. Inventory belongs to variants:

```ts
type ProductVariant = {
  id: string;
  productId: string;
  name: string | null;
  sku: string | null;
  optionValues: Record<string, unknown>;
  stock: number;
  reserve: number;
  availableStock: number;
  sortOrder: number;
  status: "active" | "inactive";
  metadata: Record<string, unknown> | null;
};
```

Products have two valid variant modes:

- Simple product: exactly one variant, and `name` must be `null` or omitted. Do not show a variant selector.
- Variant product: at least two variants, and every variant must have a non-empty `name`. Show variant selection.

Avoid the middle state of one named variant. The backend rejects it.

Variants are not deleted. To remove a variant from sale, update it with `status: "inactive"`.

## Admin Product Create

`POST /api/admin/product/create`

Request body:

```ts
{
  sellerId: string;
  name: string;
  description: string;
  price: number;
  variants: Array<{
    name?: string | null;
    sku?: string | null;
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
- Simple product: send one variant with `name: null`.
- Variant product: send at least two variants, all with non-empty `name`.
- `stock` is required for every new variant.
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
- New variants require `optionValues` and `stock`.
- Existing variants cannot be deleted.
- To hide/remove a variant from sale, set `status: "inactive"`.
- If a variant has `reserve > 0`, `stock` cannot be reduced below `reserve`.
- After update, the full persisted variant set must still be valid:
  - exactly one unnamed default variant, or
  - at least two named variants.

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
}
```

Admin order, delivery, and refund APIs should not display `product.variant` when `variantAtSale` is present.

Admin order list `merchantTradeNo` searches order or delivery merchant trade number prefix.

Admin delivery list `merchantTradeNo` searches delivery merchant trade number prefix only.

Admin users do not create deliveries directly from the admin frontend.

## Chatroom Display

Product-specific chat rooms include `productVariantId` and compact product display data:

```ts
product: {
  id: string;
  name: string;
  images: string[] | null;
  variantName: string | null;
} | null;
```

Use `variantName` beside the product name when present.
