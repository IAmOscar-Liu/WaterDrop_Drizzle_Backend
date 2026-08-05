# Product Variants API Changes

## Purpose

This document lists API contract changes for product variants. It is a frontend handoff for both admin web and the Flutter app.

Phase 3 and Phase 4 code support has been implemented. Phase 5 schema constraints are implemented on the constraints branch; generated database migrations still need to be run per environment.

## Shared Response Schemas

### ProductVariant Summary vs Detail

List and detail endpoints may return different shapes, matching the current Swagger style where list endpoints are lighter and detail endpoints can include richer relations.

Use a compact variant shape for lists and selection UI:

```ts
type ProductVariantSummary = {
  id: string;
  productId: string;
  name: string | null;
  sku: string | null;
  optionValues: Record<string, unknown>;
  availableStock: number;
  status: "active" | "inactive";
};
```

Use the full variant shape for product detail and admin inventory screens:

```ts
type ProductVariantDetail = {
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
  createdAt: string;
  updatedAt: string;
};
```

Notes:

- Product price is shared across variants, so variants do not include `price`.
- `sku` is optional.
- `optionValues` is free-form JSON, for example `{ "size": "M", "color": "Black" }`.
- Variants are never physically deleted by product management. Removed variants become `inactive`.
- `availableStock` is calculated as `stock - reserve`.

### Product List vs Detail

Existing product fields remain. Product list responses add variant summaries:

```ts
type ProductListItem = Product & {
  variants: ProductVariantSummary[];
  availableStock: number;
};
```

Product detail responses can return full variant detail rows:

```ts
type ProductDetail = Product & {
  variants: ProductVariantDetail[];
  availableStock: number;
};
```

During transition, product-level `stock`, `reserve`, and `sku` may remain for backward compatibility:

```ts
stock = sum(active variants.stock);
reserve = sum(active variants.reserve);
availableStock = sum(active variants.stock - variants.reserve);
```

### Purchased Product Shape

Order/refund/delivery item APIs format the purchased variant inside `product` when a full product relation is returned:

```ts
type PurchasedProductSummary = Product & {
  variant: ProductVariantSummary | null;
};

type PurchasedProductDetail = Product & {
  variant: ProductVariantDetail | null;
};

type OrderItemWithVariant = OrderItem & {
  product: PurchasedProductSummary | PurchasedProductDetail;
  variantNameAtSale: string | null;
  variantSkuAtSale: string | null;
  variantOptionValuesAtSale: Record<string, unknown> | null;
  variantAtSale: {
    name: string | null;
    sku: string | null;
    optionValues: Record<string, unknown> | null;
  };
};
```

For historical display, prefer `variantAtSale` or the raw snapshot fields (`variantNameAtSale`, `variantSkuAtSale`, and `variantOptionValuesAtSale`) when present. The nested live `product.variant` is for current admin/debug context and inventory links. List endpoints should use summary variants; detail endpoints may use detail variants.

## Admin Web APIs

### `GET /api/admin/product/list`

Request query:

- Existing: `page`, `limit`, `categoryId`, `search`, `status`, `minPrice`, `maxPrice`
- Planned optional additions:
  - `variantStatus?: "active" | "inactive"`
  - `hasStock?: boolean`

Response body:

```ts
{
  success: true;
  data: {
    products: ProductListItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

Behavior change:

- Product availability is true when any active variant has `stock - reserve > 0`.
- Admin list may include inactive variant summaries in each product response for management/history context.
- Keep this response lighter than product detail. Do not include every deep relation solely for the list page.

### `GET /api/admin/product/{id}`

Request path:

- Existing: `id`

Response body:

```ts
{
  success: true;
  data: ProductDetail & {
    advertisement?: Advertisement | null;
    productsToCategories: ProductCategoryRelation[];
  };
}
```

Behavior change:

- Include all variants, including inactive variants.
- Detail can include full variant inventory fields such as `stock`, `reserve`, `sortOrder`, and `metadata`.

### `POST /api/admin/product/create`

Request body additions:

```ts
{
  sellerId: string;
  name: string;
  description: string;
  price: number;
  stock?: number;
  sku?: string | null;
  variants?: Array<{
    name?: string | null;
    sku?: string | null;
    optionValues: Record<string, unknown>;
    stock: number;
    sortOrder?: number;
    status?: "active" | "inactive";
    metadata?: Record<string, unknown> | null;
  }>;
}
```

Validation:

- During transition, accept either legacy `stock` or `variants`.
- If only legacy `stock` is provided, backend creates a default variant.
- If `variants` is provided, every variant requires non-negative integer `stock`.
- `reserve` is not writable from the API.
- `optionValues` must be a plain object.
- Variant `sku` is optional.

Response body:

```ts
{
  success: true;
  data: ProductDetail;
}
```

### `PUT /api/admin/product/{id}`

Request body additions:

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

Validation/behavior:

- Existing variant updates are matched by `id`.
- Variant rows without `id` are created.
- Variants are never physically deleted; use `status: "inactive"`.
- `reserve` is not writable from the API.
- If a variant has pending reserved quantity, reducing `stock` below `reserve` fails.
- If legacy `stock` is provided without `variants`, backend updates the first/default variant for transition compatibility.

Response body:

```ts
{
  success: true;
  data: ProductDetail;
}
```

### `GET /api/admin/product/{id}/sales-summary`

Request query:

- Existing: `startAt`, `endAt`
- Planned optional addition:
  - `variantId?: string`

Response body:

```ts
{
  success: true;
  data: {
    product: ProductDetail;
    variant?: ProductVariantDetail | null;
    stats: {
      startAt: string | null;
      endAt: string | null;
      totalQuantity: number;
      totalRevenue: number;
    };
  };
}
```

### `GET /api/admin/order/list`

Request query:

- No required variant query changes.
- Optional future filter:
  - `variantId?: string`

Response body change:

Current Swagger for `AdminOrderListItem` is intentionally lighter than order detail. Keep the list item compact.

Each order list item should include enough variant identity/snapshot data for table display:

```ts
items: Array<{
  id: string;
  productId: string;
  productVariantId: string;
  productNameAtSale: string;
  variantNameAtSale: string | null;
  variantSkuAtSale: string | null;
  variantOptionValuesAtSale: Record<string, unknown> | null;
  variantAtSale: {
    name: string | null;
    sku: string | null;
    optionValues: Record<string, unknown> | null;
  };
}>
```

### `GET /api/admin/order/{id}`

Response body change:

- Detail should include the richer purchased product shape:

```ts
items: Array<OrderItem & {
  product: PurchasedProductDetail;
  variantNameAtSale: string | null;
  variantSkuAtSale: string | null;
  variantOptionValuesAtSale: Record<string, unknown> | null;
  variantAtSale: {
    name: string | null;
    sku: string | null;
    optionValues: Record<string, unknown> | null;
  };
}>
```

- Prefer snapshot fields for historical display.

### `GET /api/admin/refund/list`

Request query:

- Existing: `page`, `limit`, `userId`, `productId`, `merchantTradeNo`, `startAt`, `endAt`, `status`
- Planned optional addition:
  - `variantId?: string`

Response body change:

```ts
refunds: Array<RefundItem & {
  orderItem: OrderItem & {
    product: PurchasedProductSummary;
    variantNameAtSale: string | null;
    variantSkuAtSale: string | null;
    variantOptionValuesAtSale: Record<string, unknown> | null;
    variantAtSale: {
      name: string | null;
      sku: string | null;
      optionValues: Record<string, unknown> | null;
    };
  };
}>
```

### `GET /api/admin/refund/{id}`

Response body change:

- Same nested `orderItem.product.variant` format as refund list, but detail may use `PurchasedProductDetail` and include richer order/delivery/user relations.

### Admin Refund Status Update

Request body:

- No new required request fields for variant support.

Behavior change:

- When a refund is accepted/completed and restocking is required, restock the linked `orderItem.productVariantId`.
- Restock happens in the same transaction as refund completion.

### Admin Chatroom APIs

Product-specific chat rooms now carry `productVariantId` so conversations can distinguish multiple variants of the same product.

General customer-support rooms remain:

```ts
{
  productId: null;
  productVariantId: null;
  orderId: null;
}
```

Product inquiry rooms should use:

```ts
{
  productId: string;
  productVariantId: string;
  orderId: null;
}
```

After the user buys the product, the existing product/variant room can be updated with `orderId`.

`GET /api/admin/chatroom/list`

Request query:

- Existing: `page`, `limit`, `productId`, `status`, `supportOnly`
- Planned optional addition:
  - `productVariantId?: string`

Response body change:

```ts
chatRooms: Array<ChatRoom & {
  productVariantId: string | null;
  product: Product | null;
  variant: ProductVariantSummary | null;
}>
```

When resolving delivery context for a chat room, backend matches order items by both `productId` and `productVariantId`.

### Admin Delivery Creation / ECPay Logistics Create

Request body change:

Replace product id array usage with paired product+variant selection:

```ts
{
  items: Array<{
    productId: string;
    variantId: string;
  }>;
}
```

If the actual field name remains `productIds` for compatibility, its element shape should become:

```ts
productIds: Array<{
  productId: string;
  variantId: string;
}>
```

Response body change:

- Delivery list `items` include snapshot fields and `variantAtSale`.
- Delivery detail `items` include `product.variant` for the linked live variant plus `variantAtSale` for historical display.

### ECPay / Merchant Trade Callback Related Data

`merchantTradeTable` has:

```ts
productIds: string[];
variantIds: string[];
```

Contract:

- Arrays are positionally aligned.
- `productIds[index]` corresponds to `variantIds[index]`.
- Backend validates equal array lengths before updating `order_items`.

## Flutter App APIs

### `GET /api/product/list`

Request query:

- Existing: `page`, `limit`, `categoryId`, `search`, `minPrice`, `maxPrice`
- No required new query fields.
- Optional future filters:
  - `variantOption.<key>=<value>`, for example `variantOption.color=Black`
  - `hasStock=true`

Response body:

```ts
{
  success: true;
  data: {
    products: ProductListItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

Behavior change:

- A product appears in the public list when any active variant has `stock - reserve > 0`.
- Flutter should choose a variant before adding to cart/order.
- Public list includes active variant summaries needed for selection, not inactive variants.

### `GET /api/product/{id}`

Response body:

```ts
{
  success: true;
  data: ProductDetail & {
    seller: SellerSummary;
    productsToCategories: ProductCategoryRelation[];
  };
}
```

Behavior change:

- Include active variants for user purchase selection.
- Public product detail includes active variants for purchase selection.
- Product detail may include more variant fields than list.

### `GET /api/advertisement/list`

Response body change:

```ts
{
  success: true;
  data: {
    advertisements: Array<Advertisement & {
      product: Product & {
        variants: ProductVariantSummary[];
      };
    }>;
  };
}
```

Behavior change:

- Advertisement product payload keeps the active variant object list so the app can add directly when only one variant is available, or open variant selection when multiple variants are available.

### `GET /api/cart/list`

Response body change:

```ts
{
  success: true;
  data: Array<CartItem & {
    product: Product & {
      variants: ProductVariantSummary[];
    };
    variant: ProductVariantSummary | null;
  }>;
}
```

Behavior change:

- Cart item `product` includes active `variants`, matching product list/detail navigation needs in the Flutter app.
- The cart item's selected variant remains available as top-level `variant`.

### `POST /api/cart/item`

Request body change:

```ts
{
  productId: string;
  productVariantId: string;
  quantity: number;
}
```

Validation:

- `productVariantId` is required now.
- Variant must belong to `productId`.
- Variant must be active and have enough available stock.

Response body:

```ts
{
  success: true;
  data: CartItem & {
    productVariantId: string;
  };
}
```

### `PUT /api/cart/item/toggle`

Request body change:

```ts
{
  productId: string;
  productVariantId: string;
  checked: boolean;
}
```

Validation:

- `productVariantId` is required now.
- The cart row is selected by authenticated user, `productId`, and `productVariantId`.

Response body:

```ts
{
  success: true;
  data: CartItem & {
    productVariantId: string;
  };
}
```

### `PUT /api/cart/item/{cartItemId}/variant`

Request path:

- `cartItemId: string`

Request body:

```ts
{
  productVariantId: string;
}
```

Behavior:

- Changes the selected variant for an existing cart item.
- New variant must belong to the same product as the current cart item.
- New variant must be active.
- If another cart row already exists for the target variant, backend merges both rows:
  - target row quantity becomes `current.quantity + target.quantity`
  - target row checked state becomes `current.checked || target.checked`
  - current row is deleted
- Merged quantity must not exceed target variant available stock.
- This endpoint is designed for the cart unique constraint moving from `(userId, productId)` to `(userId, productVariantId)`. The schema has been updated; run the generated constraint migration before relying on multiple variants of the same product in one cart.

Response body:

```ts
{
  success: true;
  data: CartItem & {
    productVariantId: string;
  };
}
```

### `POST /api/order`

Request body item change:

```ts
{
  idempotencyKey: string;
  items: Array<{
    productId: string;
    productVariantId: string;
    quantity: number;
    unitPriceAtSale: number;
    productNameAtSale: string;
    variantNameAtSale?: string | null;
    variantSkuAtSale?: string | null;
    variantOptionValuesAtSale?: Record<string, unknown> | null;
  }>;
}
```

Backend should derive/snapshot variant fields from the locked variant row when possible. Flutter can still send display snapshots if the current flow already builds order item snapshots client-side.

Validation:

- Every item must include `productVariantId`.
- `productVariantId` must be unique within a single order request.
- Variant must belong to `productId`.
- Variant must be active.
- Backend locks variant rows and validates total requested quantity by variant against `stock - reserve`.

Response body change:

- Order items include `product.variant` and variant snapshot fields.
- Detail-style order responses can include `PurchasedProductDetail`; lighter list-style responses can use `PurchasedProductSummary` or snapshot fields only.

### `GET /api/order/list`

Request query:

- Existing: `page`, `limit`, `statusIn`, `order`
- No required variant query changes.

Response body change:

- If order list includes order items, each item should include `product.variant` summary or variant snapshot fields.
- Each order item includes variant snapshot fields.

### `GET /api/order/{id}`

Response body change:

- Detail may include richer `product.variant` data than order list.

### `POST /api/refund`

Request body:

- No new required fields. Refund still uses `orderItemId`.

Response/body behavior:

- Refund display data comes from `orderItem.product.variant` and variant snapshot fields.
- Completed/accepted refunds restock the linked variant inventory on the backend.

### `POST /api/chatroom/create`

Request body change:

```ts
{
  accountId?: string | null;
  productId?: string | null;
  productVariantId?: string | null;
  orderId?: string | null;
}
```

Validation:

- `productVariantId` is required when `productId` is provided.
- `productVariantId` must belong to `productId`.
- General support chat rooms omit both `productId` and `productVariantId`.

Response body change:

```ts
{
  success: true;
  data: ChatRoom & {
    productVariantId: string | null;
  };
}
```

### `GET /api/chatroom/list`

Response body change:

- Product-specific chat rooms include `productVariantId`.
- Product inquiry/order chat rooms are unique by user, account, product, variant, and order context after Phase 5 constraints.

## Migration Notes For Clients

- Phase 1/read phase: clients can start reading `variants` while still using legacy `stock`.
- Phase 2/write phase: clients must send `productVariantId` for cart and order item creation.
- Flutter app notification: cart add/update, cart toggle, and order create now require `productVariantId` together with `productId`.
- Public product UI should disable or hide variants where `stock - reserve <= 0`.
- Admin product UI should show inactive variants and use status changes instead of delete actions.
- Order/refund history UI should prefer `variant*AtSale` snapshots over live variant values.
- Phase 5 database constraints are still pending in deployed databases until migrations are generated and run. Until the old cart/order unique constraints are replaced, adding two different variants of the same product to one cart/order may still be blocked by the database.
- Chatroom migration note: after adding nullable `chat_rooms.productVariantId`, rerun `src/back-fill.ts`. It fills product-specific chat rooms from the matching order item variant when possible, otherwise from the product default variant. General support rooms remain null.
