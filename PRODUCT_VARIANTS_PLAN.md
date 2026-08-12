# Product Variants Plan

## Goal

Allow one product to have multiple variants, for example size and color, where each variant has its own stock and reserve quantity. Keep product-level fields for shared product information such as name, description, images, seller, categories, advertisement, delivery flags, status, and type.

This document tracks the product variant rollout plan and implementation status.

## Original State

Before the variant rollout, `productTable` stored stock directly on the product:

- `products.stock`
- `products.reserve`
- `products.sku`

The rest of the system assumes cart/order/refund lines are keyed by `productId`:

- `cart_items` has `productId`, `quantity`, and a unique key on `(userId, productId)`.
- `order_items` has `productId`, `quantity`, `pendingQuantity`, `unitPriceAtSale`, `productNameAtSale`, and a unique key on `(orderId, productId)`.
- Order creation validates `product.stock - product.reserve`.
- Order payment subtracts `pendingQuantity` from product `stock` and `reserve`.
- Order expiration/cancellation subtracts `pendingQuantity` from product `reserve`.
- Product listing hides sold-out products with `products.stock > products.reserve`.
- Advertisement listing only shows advertised products where `products.stock > products.reserve`.
- Refund, delivery, chatroom, collection, and sales summary mostly join through `order_items.productId`.

## Recommended Model

Add a `product_variants` table and make stock/reserve belong to variants.

Resolved model decisions:

- Product price is shared across all variants. Variants do not support price overrides in this version.
- Variant SKU is optional.
- Variant option names and values are stored as free-form JSON in `optionValues`.
- Inactive variants remain visible in admin order/refund history through order item snapshots and/or explicit variant relations.
- Refund completion should restock returned variant inventory when business rules mark the return as accepted/completed.
- Product management should never physically delete variants. Use `status = "inactive"` instead so refund, order, delivery, and admin history can always resolve the variant.

Recommended columns:

```ts
export const productVariantTable = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productTable.id, { onDelete: "cascade" }),
    name: text("name"),
    sku: text("sku"),
    optionValues: jsonb("option_values").notNull(),
    stock: integer("stock").notNull(),
    reserve: integer("reserve").notNull().default(0),
    sortOrder: integer("sort_order").default(0).notNull(),
    status: productStatusEnum("status").default("active").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    productSkuUnique: uniqueIndex("product_variants_product_sku_uk").on(
      t.productId,
      t.sku,
    ),
  }),
);
```

`optionValues` should store a stable object such as:

```json
{
  "size": "M",
  "color": "Black"
}
```

`name` and `optionValues` serve different purposes:

- `optionValues` is structured data for logic, filtering, validation, and UI controls. Example: `{ "size": "M", "color": "Black" }`.
- `name` is an optional display label for humans. Example: `"Black / M"` or `"Limited Edition"`.

Keeping both lets the backend and frontend reason over structured options while still allowing sellers/admins to control a clean display label. If `name` is empty, the API can derive a display label from `optionValues`.

This keeps the first version simple and flexible. A more normalized option model can be added later if the app needs global option definitions, option ordering, or inventory imports.

## Compatibility Decision

Recommended rollout: support both simple and variant products during migration.

- A product with no explicit variants gets one default variant.
- New stock logic uses variants.
- Product-level `stock`, `reserve`, and `sku` are removed in Phase 6. Variant rows are the authoritative inventory and SKU source.

## Schema Changes

### 1. Add Product Variant Table

Add `productVariantTable` and relations:

- `productRelations.variants = many(productVariantTable)`
- `productVariantRelations.product = one(productTable)`
- export `ProductVariant` and `NewProductVariant`

Indexes:

- `product_variants_product_id_idx` on `productId`
- Optional unique index on `(productId, sku)` only if non-null SKUs should be unique per product.
- Because SKU is optional, be aware PostgreSQL allows multiple `NULL` values in unique indexes.

### 2. Add Variant References To Line Items

Add nullable `productVariantId` first:

- `cart_items.product_variant_id`
- `order_items.product_variant_id`
- `chat_rooms.product_variant_id`

Update relations:

- `cartItemRelations.variant`
- `orderItemRelations.variant`
- `chatRoomRelations.variant`
- `productVariantRelations.cartItems`
- `productVariantRelations.orderItems`

Update unique keys:

- Cart should become unique by `(userId, productVariantId)` for variant-aware rows.
- Order items should become unique by `(orderId, productVariantId)` for variant-aware rows.
- Product-specific chat rooms should include `productVariantId` in their identity.

During transition, nullable variant ids make unique constraints tricky. Prefer a staged migration:

1. Add nullable `productVariantId`.
2. Backfill all existing cart/order/chat room rows that reference products.
3. Make line item `productVariantId` not null.
4. Add a conditional chat room constraint so product-specific rooms require `productVariantId`, while general support rooms can keep both `productId` and `productVariantId` null.
5. Replace old unique constraints.

### 3. Snapshot Variant Details On Orders

Add order item snapshot fields so historical orders survive variant edits:

- `variantNameAtSale`
- `variantSkuAtSale`
- `variantOptionValuesAtSale`

Keep `productNameAtSale` and `unitPriceAtSale` unchanged.

## Data Migration

1. Create one default variant for every existing product:

   - `productId = products.id`
   - `name = null` or `"Default"`
   - `sku = products.sku`
   - `optionValues = {}`
   - `stock = products.stock`
   - `reserve = products.reserve`
   - `status = products.status`

2. Backfill `cart_items.product_variant_id` by joining the default variant for each `productId`.

3. Backfill `order_items.product_variant_id` by joining the default variant for each `productId`.

4. Backfill order item variant snapshot fields from the default variant.

5. Backfill `chat_rooms.product_variant_id`:

   - For rooms with `orderId`, prefer the matching `order_items.product_variant_id` for the same `orderId` and `productId`.
   - Otherwise, use the product's default variant.
   - General support chat rooms with `productId = null` keep `productVariantId = null`.

6. After application code is deployed and verified, make line item `productVariantId` not null and add conditional chat room product/variant consistency constraints.

7. Phase 6 cleanup migration: remove `products.stock`, `products.reserve`, and `products.sku`.

## API Shape

### Admin Product Create/Update

Add `variants` to request body:

```json
{
  "name": "T-shirt",
  "price": 390,
  "variants": [
    {
      "name": "Black / M",
      "sku": "TS-BLK-M",
      "optionValues": { "color": "Black", "size": "M" },
      "stock": 20,
      "status": "active"
    }
  ]
}
```

Rules:

- Create requires `variants`.
- Simple products use exactly one default variant with `name = null`.
- Variant products use at least two variants, and every variant must have a non-empty `name`.
- If `variants` is passed, create/update variant rows in the same transaction as product/category updates.
- `reserve` should not be directly writable from API except internal stock workflows.
- Updating variants should support:
  - create new variants
  - update existing variants by `id`
  - deactivate variants
- Do not support variant deletion from product management. Even unused variants should be deactivated instead of deleted to keep refund/order logic simple and consistent.

### Product List/Detail Responses

List and detail responses do not have to be identical. Follow the current Swagger pattern: list endpoints can return lighter summaries, while detail endpoints can include richer relations.

Product list responses should include enough variant data for inventory display and purchase selection:

```ts
product: {
  ...product,
  variants: ProductVariantSummary[],
  availableStock,
}
```

Product detail responses can include the full variant rows plus existing detail relations:

```ts
product: {
  ...product,
  variants: ProductVariantDetail[],
  advertisement,
  productsToCategories,
  seller, // public detail only
}
```

After Phase 6 cleanup, product response should not expose top-level `stock`, `reserve`, or `sku`. It can keep computed aggregate availability for list sorting/display:

- `availableStock = sum(active variants.stock - variants.reserve)`

Variant inventory is exposed through `variants`.

### Order/Refund Response Formatting

Keep DB/repository relations separate:

```ts
orderItem.product;
orderItem.variant;
```

Format API responses with `variantAtSale` as the purchased variant display object. Keep live DB relations available inside repositories, but do not expose a redundant live `product.variant` object when `variantAtSale` is already present.

```ts
orderItem: {
  product,
  variantAtSale: {
    name,
    sku,
    optionValues,
  },
}
```

Use the same `variantAtSale` display shape in refund and delivery responses, while keeping the existing list/detail distinction for surrounding relations:

- Refund list can include `orderItem.product`, `orderItem.variantAtSale`, and delivery/order/user summary.
- Refund detail can include richer order/delivery/user relations, but should still use `orderItem.variantAtSale` for variant display.

```ts
refundItem: {
  orderItem: {
    product,
    variantAtSale: {
      name,
      sku,
      optionValues,
    },
  },
}
```

For historical display, prefer `variantAtSale`, which is derived from the `variant*AtSale` snapshot fields. Live variant rows may be joined internally for validation or inventory logic, but API display should not depend on mutable live variant values.

### Cart API

Add `productVariantId` to add/update cart item.

Rules:

- Validate the variant belongs to the product if both ids are supplied.
- Prefer requiring `productVariantId` once frontend supports variants.
- Cart uniqueness should be per user + variant, not just per user + product.

### Order API

Order item input must include `productVariantId`.

Order creation should:

- lock variants with `.for("update")`, sorted by variant id
- validate `variant.stock - variant.reserve >= quantity`
- insert order items with `productId` and `productVariantId`
- snapshot variant name/sku/options
- increment `product_variants.reserve`

Order payment should:

- decrement `product_variants.reserve`
- decrement `product_variants.stock`
- clear cart rows by `productVariantId`

Order expiration/cancellation should:

- decrement `product_variants.reserve`
- leave `product_variants.stock` unchanged

## Repository Changes

### `src/repository/product.ts`

- Add variant-aware create/update helpers.
- Include variant summaries in `listProducts` and `listAdminProducts`.
- Include full variant detail rows in `getProductById` and `getProductWithSellerById`.
- Replace public availability condition from `products.stock > products.reserve` to an aggregate/exists check on active variants.
- Update `decreaseProductStock` or replace it with `decreaseProductVariantStock`.
- Update sales summary to optionally group/filter by variant.

### `src/repository/cart.ts`

- Add `productVariantId` to upsert/delete/toggle flows.
- Replace unique target `(userId, productId)` with `(userId, productVariantId)` after migration.
- Include variant relation in list results.
- Fix toggle/delete selectors to include `userId` and variant id, not product id alone.

### `src/repository/order.ts`

- Move stock validation/reserve/final stock updates from `productTable` to `productVariantTable`.
- Lock variants in deterministic order before reserve mutation.
- Insert order item variant snapshots.
- Delete paid cart items by `productVariantId`.

### `src/repository/advertisement.ts`

- Replace product availability filters with `exists` active variant availability.
- Decide whether advertisements are product-level only or variant-aware. Recommended first version: keep advertisements product-level.

### `src/repository/refund.ts`

- Keep refunds tied to `orderItemId`.
- Include order item variant snapshot and/or variant relation in refund list/detail responses.
- On accepted/completed refund flows, restock the returned quantity to the matching `productVariantTable` row.
- Restock updates should happen in the same transaction as refund status completion and lock the variant row with `.for("update")`.

### `src/repository/delivery.ts`

- Delivery creation should continue using product selection shape, but the item selector has been changed from `productIds: string[]` to `{ productId: string; variantId: string }[]`.
- Update `orderItemTable` by matching both `productId` and `productVariantId` so each delivery targets the intended purchased variant lines.
- Prefer keeping this product+variant selector shape for now instead of switching to `orderItemIds`.

### `src/repository/chatroom.ts`

- Add `productVariantId` to product-specific chat room identity.
- Keep general customer support rooms as `productId = null` and `productVariantId = null`.
- Product inquiry rooms use `productId` and `productVariantId` with `orderId = null`.
- After the user buys the product, the existing product/variant room can be updated with `orderId`.
- When resolving delivery context from a chat room, match order items by both `productId` and `productVariantId`.

### ECPay / Merchant Trade Flow

- `merchantTradeTable` now includes `variantIds`.
- Keep `productIds` and `variantIds` positionally aligned: `productIds[0]` corresponds to `variantIds[0]`.
- When reading merchant trade rows for delivery/payment callbacks, treat product and variant arrays as paired values and validate they have matching lengths before updating order items.

## Controller, Service, Middleware Changes

### Middleware

Update `src/middleware/admin/product.ts`:

- Add variant Zod schemas.
- Validate `optionValues` is a plain object.
- Validate variant `stock` as non-negative integer.
- Validate update variant entries have either `id` or enough fields to create a new variant.

If public cart/order validation exists outside admin middleware, add `productVariantId` there too.

### Controller

Keep controller changes thin:

- read `variants` from request body
- pass them to service
- parse new query params only if adding variant filters

### Service

Service should:

- preserve `ServiceResponse`
- orchestrate side effects after repository transactions
- keep phase-specific compatibility rules visible and remove them once the cleanup phase lands

## Deployment Phases

### Phase 1: Additive Schema

- Add `product_variants`.
- Add nullable `productVariantId` and snapshot fields to cart/order items.
- Add relations and inferred types.
- Generate migration.

### Phase 2: Backfill

- Create default variants from existing products.
- Backfill cart/order item `productVariantId`.
- Backfill variant snapshot fields.
- Verify row counts:
  - every product has at least one variant
  - every cart item has a variant
  - every order item has a variant
  - aggregate product stock/reserve matches default variant stock/reserve

### Phase 3: Code Reads

- Include variant summaries in product list responses.
- Include full variant details in product detail responses.
- Keep computed `availableStock` in responses.
- Add helper functions for aggregate availability.

### Phase 4: Code Writes

- Update admin product create/update to write variants.
- Update cart/order flows to require/use variants.
- Move reserve/stock mutation to variant rows.

### Phase 5: Constraints

- Make `cart_items.product_variant_id` and `order_items.product_variant_id` not null.
- Replace old unique constraints.
- Add required indexes.

### Phase 6: Cleanup

- Remove product-level `stock`, `reserve`, and `sku`.
- Remove compatibility code after all clients use variants.
- Update Swagger examples and frontend documentation.

### Environment Rollout Order

For development and staging, apply the branches step by step:

1. Merge `feat/migration/backfill`, run the additive schema migration, then run `src/back-fill.ts`.
2. Merge `feat/constraints`, then run the constraint migration.
3. Merge `feat/cleanup`, then run the cleanup migration.

## Open Decisions

All initial product variant decisions are resolved:

- Product price is shared across all variants.
- Variant SKU is optional.
- Variant options use free-form JSON in `optionValues`.
- Inactive variants remain visible in admin order/refund history.
- Variants are never physically deleted by product management; inactive status is the only removal path.
- Completed/accepted refunds restock returned variant inventory.
- Delivery creation uses `{ productId: string; variantId: string }[]`, not `orderItemIds`.
- Merchant trade product and variant arrays are positionally aligned.

## TODO / Progress Tracker

Use this section to track implementation progress. Keep each phase buildable and deployable by itself when possible.

- [x] Planning: document variant model, migration strategy, API shape, and resolved business decisions.
- [x] Phase 1: Additive schema
  - [x] Add `productVariantTable`.
  - [x] Add product variant relations and inferred types.
  - [x] Add nullable `productVariantId` to `cart_items`.
  - [x] Add nullable `productVariantId` to `order_items`.
  - [x] Add nullable `productVariantId` to product-specific `chat_rooms`.
  - [x] Add order item variant snapshot fields.
  - [x] Confirm `merchantTradeTable.variantIds` is present and documented.
  - [x] Generate migration for additive schema.
  - [x] Generate migration for nullable `chat_rooms.productVariantId`.
- [x] Phase 2: Backfill
  - [x] Write `src/back-fill.ts` backfill script.
  - [x] Create one default variant for every existing product.
  - [x] Backfill `cart_items.productVariantId`.
  - [x] Backfill `order_items.productVariantId`.
  - [x] Backfill order item variant snapshot fields.
  - [x] Update `src/back-fill.ts` to backfill product-specific `chat_rooms.productVariantId`.
  - [x] Run chat room variant backfill.
  - [x] Backfill `merchant_trades.variantIds`.
  - [x] Verify every product/cart item/order item has a variant.
  - [x] Verify every product-specific chat room has a variant.
  - [x] Verify merchant trades have `variantIds`.
  - [x] Verify aggregate product stock/reserve matches variant stock/reserve.
- [x] Phase 3: Read support
  - [x] Include variant summaries in product list responses.
  - [x] Include full variant details in product detail responses.
  - [x] Format order list item responses with lightweight variant snapshots/summaries.
  - [x] Format order detail item responses with `variantAtSale`.
  - [x] Format refund list responses with `refundItem.orderItem.variantAtSale`.
  - [x] Format refund detail responses with `refundItem.orderItem.variantAtSale`.
  - [x] Update product and advertisement availability filters to use active variant availability.
  - [x] Keep backward-compatible aggregate `stock`, `reserve`, and `availableStock` fields during transition.
- [x] Phase 4: Write support
  - [x] Update admin product create/update to create/update/deactivate variants.
  - [x] Prevent physical variant deletion.
  - [x] Update cart add/update/toggle flows to require/use `productVariantId`.
  - [x] Update order creation to lock variants and reserve variant stock.
  - [x] Update payment/expiration/cancellation stock mutations to use variants.
  - [x] Update delivery creation to match `{ productId, variantId }[]`.
  - [x] Update ECPay merchant trade handling to pair `productIds` with `variantIds`.
  - [x] Update chatroom create/list/refund chat flows to use `productVariantId`.
  - [x] Update refund completion to restock returned variant inventory.
  - [x] Add cart variant-switch flow that merges rows when the target variant already exists.
  - [x] Build verification: `npm run build`.
- [x] Phase 5: Constraints
  - [x] Make `cart_items.productVariantId` not null in schema.
  - [x] Make `order_items.productVariantId` not null in schema.
  - [x] Add product-specific chat room check constraint requiring `productVariantId` when `productId` is present.
  - [x] Replace cart unique constraint in schema with `(userId, productVariantId)`.
  - [x] Replace order item unique constraint with `(orderId, productVariantId)`.
  - [x] Replace chat room uniqueness with product variant-aware identity.
  - [x] Add merchant trade check constraint requiring `cardinality(productIds) = cardinality(variantIds)`.
  - [x] Add product variant inventory check constraints for non-negative stock/reserve and reserve not exceeding stock.
  - [x] Add required variant indexes.
  - [x] Build verification: `npm run build`.
  - [x] Generate Phase 5 constraint migration.
  - [x] Run Phase 5 constraint migration.
  - [x] Verify one user can hold multiple variants of the same product in cart after constraint migration.
  - [x] Verify one order can hold multiple variants of the same product after constraint migration.
- [x] Phase 6: Cleanup
  - [x] Remove product-level `stock`, `reserve`, and `sku` from schema.
  - [x] Remove compatibility code after clients use variants.
  - [x] Update Swagger and frontend handoff docs to final non-transition shape.
  - [x] Generate Phase 6 cleanup migration.
  - [x] Run Phase 6 cleanup migration locally.

## Suggested First Implementation Slice

Start with the additive, backward-compatible slice:

1. Add `productVariantTable` and relations.
2. Add nullable `productVariantId` and variant snapshot columns to cart/order items.
3. Generate migration and add backfill SQL.
4. Update product reads to include variants.
5. Do not change cart/order write APIs until the backfill is verified.

This gives frontend and backend a stable read model before stock mutation moves from product rows to variant rows.
