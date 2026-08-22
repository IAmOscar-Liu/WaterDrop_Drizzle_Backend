# Product Variant Price and Images Rollout Plan

## Goal

Move the authoritative sell price to `product_variants` while preserving the existing product response contract during the transition.

- Add `product_variants.price` with the same PostgreSQL/Drizzle type as `products.price` (`doublePrecision`).
- Add `product_variants.images` with the same PostgreSQL/Drizzle type as `products.images` (`text[]`).
- Introduce `product_variants.price` as nullable, backfill it from the parent product, and make it required in a second migration.
- Keep a root-level `product.price` in API responses, but define it as the smallest price among the product's variants.
- Add `price` to every `variantAtSale` response object.
- Preserve `order_items.unitPriceAtSale` and all order/refund calculations that use it.
- Keep `products.price` during Phase 1, then remove it in Phase 2 after every variant price has been backfilled.

## Contract Decisions

### Current variant price versus historical sale price

- `product.variants[].price` is the variant's current catalog price.
- `variantAtSale.price` is historical and must come from the existing `order_items.unitPriceAtSale`, not the current variant row.
- Do not add a second order-item price snapshot column. `unitPriceAtSale` remains the source of truth for line totals, refund defaults, refund limits, revenue reporting, and other historical calculations.

### Root product price

- For API compatibility, every returned product keeps a root `price` field.
- Its value is the minimum non-null price among the variants included for that product.
- Public product responses derive the minimum from active variants because inactive variants are not purchasable and are already excluded from those response variant lists.
- Admin product responses derive the minimum from all variants so the value matches the complete admin variant list.
- During the nullable transition, if no included variant has a price, fall back to `products.price`. After the backfill and the second migration, this fallback should no longer be needed for valid data.
- Until `products.price` is removed, product create/update writes should also keep it synchronized to the minimum submitted/persisted variant price. This preserves correct root prices in existing repository paths that still return a raw product relation without loading variants.

### Variant write contract

- New variants must provide a non-negative `price`, even while the database column is temporarily nullable.
- Existing variant updates may omit `price`; omission means keep the current value.
- Variant `images` follows the existing product image shape: `string[] | null` in storage and responses, and optional on create/update requests unless product requirements change separately.
- Root product `price` should no longer be accepted as an independently editable value. The backend derives it from variants. If temporary request compatibility is required, ignore/overwrite the supplied root value with the computed minimum rather than allowing divergence.
- Root product `images` remains unchanged in this rollout; adding variant images does not remove the existing product images field.

## Branch and Rollout Sequence

Implement the work as two sequential branches:

1. **Phase 1 — current `feat/variant-price` branch**
   - Add nullable variant `price` and `images` fields plus all compatible API/application changes.
   - Add the price and first-product-image backfill script.
   - Generate and run the expansion migration.
   - Run `src/back-fill.ts` and verify that no variant price remains null.
2. **Phase 2 — follow-up branch created after Phase 1 is complete**
   - Make variant price required.
   - Remove `products.price` and all transitional dependencies on it.
   - Generate and run the constraint/cleanup migration.

Do not combine the two database migrations: existing rows need the Phase 1 backfill window before Phase 2 can enforce `NOT NULL` and drop `products.price`.

## Phase 1: Current `feat/variant-price` Branch

Phase 1 must be deployable while `products.price` still exists. It contains the expansion schema, compatible application/API changes, the first migration, and the backfill script.

### Schema

Update `src/db/schema.ts`:

```ts
price: doublePrecision("price"),
images: text("images").array(),
```

- Place the fields on `productVariantTable` near the other variant content fields.
- Keep `price` nullable for the first migration.
- Keep `images` nullable, matching `productTable.images`.
- Do not change `productTable.price`, `productTable.images`, or `orderItemTable.unitPriceAtSale` in this phase.

Before generating, confirm that `drizzle.config.ts` targets the intended environment and output directory. Generate the first migration with `npm run db:generate`; the user will run `npm run db:migrate` in each intended environment.

Expected first migration behavior:

```sql
alter table product_variants add column price double precision;
alter table product_variants add column images text[];
```

Do not hand-edit generated Drizzle snapshots.

### Product validation and writes

Update the admin product request contract in `src/middleware/admin/product.ts` and the write logic in `src/repository/product.ts`:

- Add `price` and `images` to `ProductVariantWriteInput`.
- Require a non-negative variant price for newly created variants.
- Allow an optional non-negative price for updates to existing variants.
- Accept optional nullable arrays of strings for variant images.
- Pass both fields through `buildCreateVariantValues` and existing-variant update statements.
- Reject or prevent creation of a variant with a missing/null price at the API layer, despite the temporary nullable database column.
- For product creation, derive `products.price` from the minimum submitted variant price before inserting the product.
- For product updates, calculate the minimum across the complete persisted variant set after applying updates/inserts, then update `products.price` in the same transaction.
- Lock/read the complete variant set as needed so concurrent product edits cannot leave `products.price` out of sync.
- Continue preventing physical deletion of variants; inactive variants remain part of the admin minimum until the contract is deliberately changed.

### Product reads and price filters

Update product response shaping in `src/repository/product.ts`:

- Extend the existing aggregate helper so it computes root `price` as well as aggregate inventory.
- Compute the minimum from non-null variant prices and use the temporary `products.price` fallback only when no variant price is available.
- Apply this consistently to admin/public list and detail responses.
- Change `minPrice`/`maxPrice` filtering to use the product's minimum eligible variant price rather than the legacy `products.price` column. Use an aggregate/correlated subquery so the count query and paginated data query have identical filtering semantics.
- Keep public filtering scoped to active variants. Keep admin filtering consistent with the admin root-price rule (all variants).

Review every repository that exposes a product object, including:

- `src/repository/product.ts`
- `src/repository/cart.ts`
- `src/repository/collection.ts`
- `src/repository/advertisement.ts`
- `src/repository/order.ts`
- `src/repository/delivery.ts`
- `src/repository/refund.ts`
- `src/repository/chatroom.ts`
- `src/repository/account.ts`

Where a path loads variants, compute the root minimum directly from those variants. Where it returns a raw product relation without variants, the synchronized transitional `products.price` provides the same value. Document this compatibility dependency so it is removed deliberately when `products.price` is later dropped.

### Historical `variantAtSale` responses

Update all three serializer helpers:

- `src/repository/order.ts`
- `src/repository/delivery.ts`
- `src/repository/refund.ts`

Each `variantAtSale` object becomes:

```ts
variantAtSale: {
  name: variantNameAtSale,
  sku: variantSkuAtSale,
  optionValues: variantOptionValuesAtSale,
  price: unitPriceAtSale,
}

variantImage: currentVariant.images?.[0] ?? null,
```

- Destructure/read `unitPriceAtSale` without removing it from the root order-item response.
- Do not read the live `productVariantTable.price` for historical order, delivery, or refund display.
- Do not change order creation inputs or the existing calculation of `lineTotal = unitPriceAtSale * quantity` in this rollout.
- Do not change refund validation/default behavior that uses `unitPriceAtSale`.

### Swagger and frontend handoff

Update Swagger in the same implementation turn:

- `src/routers/admin/admin-product.ts`
  - Add nullable `price` and `images` to `ProductVariant` responses for the expansion phase.
  - Add required `price` and optional `images` to new-variant request objects.
  - Add optional `price` and `images` to existing-variant update objects.
  - Explain that root product `price` is derived from the minimum variant price and is not independently editable.
  - Keep `minPrice`/`maxPrice` documented as root/minimum-variant price filters.
- `src/routers/admin/admin-advertisement.ts`
  - Ensure nested product variants expose the updated shared `ProductVariant` schema and root product price semantics.
- `src/routers/admin/admin-order.ts`
  - Add `variantAtSale.price` everywhere the object is declared.
- `src/routers/admin/admin-delivery.ts`
  - Add `variantAtSale.price` to list and detail item shapes.
- `src/routers/admin/admin-refund.ts`
  - Add `variantAtSale.price` while retaining the documented `unitPriceAtSale` refund behavior.

Also update the existing product-variant frontend handoff documentation if it remains an active contract, because it currently states that price is shared at product level.

### Backfill variant prices and initial images

Replace the current contents of `src/back-fill.ts` with a focused, rerunnable variant price and initial-image backfill. Preserve the user's environment choice in `package.json`; do not silently switch the script to another database environment.

Required behavior:

1. Load environment configuration before initializing the database client.
2. Count and log:
   - total variants;
   - variants whose price is null;
   - variants whose parent product cannot be resolved, if any.
3. Update only rows where `product_variants.price is null`.
4. Set each missing variant price to its parent `products.price` using one set-based SQL update (or bounded batches if the target database requires it).
5. Do not overwrite a variant price that is already populated; this makes the script safe to rerun and preserves prices created after the first deployment.
6. For variants whose `images` is null, set it to a one-element array containing the parent product's first image when that image exists.
7. Do not overwrite a populated variant image array, including an intentionally empty array.
8. Recount null prices and eligible missing images after the update and fail with a non-zero exit code if any remain.
9. Log the number of price rows and image rows updated plus a concise before/after summary.
10. Always close the database client in `finally`.

Conceptual update:

```sql
update product_variants as variant
set
  price = product.price,
  updated_at = now()
from products as product
where variant.product_id = product.id
  and variant.price is null;

update product_variants as variant
set
  images = array[product.images[1]],
  updated_at = now()
from products as product
where variant.product_id = product.id
  and variant.images is null
  and product.images[1] is not null;
```

Before proceeding to the constraint migration, verify:

```sql
select count(*)
from product_variants
where price is null;
```

The result must be `0`.

### Phase 1 execution order

After the Phase 1 code is ready:

1. Confirm `drizzle.config.ts` targets the intended environment.
2. Generate the expansion migration with `npm run db:generate`.
3. Run `npm run build`.
4. Commit/deploy the Phase 1 application and migration as appropriate for the target environment.
5. The user runs `npm run db:migrate` to add nullable `product_variants.price` and `product_variants.images`.
6. The user runs `npm run back-fill`.
7. Verify that `product_variants.price is null` returns zero rows before creating or deploying Phase 2.

## Phase 2: Follow-up Constraint and Product-Price Removal Branch

Create the Phase 2 branch only after the Phase 1 migration and backfill have succeeded in the relevant environment. Phase 2 makes variant price authoritative at both the application and database levels.

### Schema and second migration

Update `src/db/schema.ts`:

1. Change `productVariantTable.price` in `src/db/schema.ts` to:

   ```ts
   price: doublePrecision("price").notNull(),
   ```

2. Remove `price: doublePrecision("price").notNull()` from `productTable`.
3. Keep `productTable.images`; only product-level price is removed in this phase.
4. Confirm there are no null variant prices in every target environment.
5. Generate the second migration with `npm run db:generate` against the intended Drizzle environment.
6. The user runs `npm run db:migrate`.

Expected second migration behavior:

```sql
alter table product_variants alter column price set not null;
alter table products drop column price;
```

Keep `product_variants.images` nullable.

### Remove transitional application behavior

- Remove product create/update writes that synchronize `products.price`.
- Remove the fallback from computed root price to `products.price`.
- Remove product-level price from Drizzle insert/update inputs and admin product request parsing.
- Continue returning root `product.price` as a computed API field containing the minimum eligible variant price; removing the database column must not remove this response field.
- Ensure every repository returning product data explicitly computes/projects the root price from variants rather than relying on a raw product table row.
- Recheck product list/detail, advertisements, cart, collection, chatroom, account relations, order, delivery, and refund response paths.
- Keep `minPrice`/`maxPrice` filters based on minimum eligible variant price.
- Preserve `variantAtSale.price = unitPriceAtSale` and all existing `unitPriceAtSale` calculations.

### Phase 2 execution order

1. Verify Phase 1 backfill completion in the target environment.
2. Implement the schema and application cleanup on the follow-up branch.
3. Generate the second migration.
4. Run `npm run build` and focused API checks.
5. Commit/deploy the Phase 2 application and migration together as appropriate.
6. The user runs `npm run db:migrate` to enforce non-null variant prices and remove `products.price`.

## Verification Checklist

### Static validation

- Run `npm run build` after Phase 1 code changes.
- Run `npm run build` again after Phase 2 makes the Drizzle field non-null and removes product-level price.
- Inspect generated migrations and snapshots without hand-editing them.

### Backfill validation

- A variant with `price = null` receives its parent product price.
- A variant with an existing price is unchanged.
- A second run updates zero rows and still succeeds.
- The script fails if any null price remains.
- The script closes its database connection on success and failure.

### Product API validation

- Create a simple product with one priced, unnamed variant.
- Create a multi-variant product with distinct prices and images.
- Update an existing variant's price and verify the returned root product price changes to the new minimum.
- Add a cheaper variant and verify the root price and price filters update.
- Mark a cheap variant inactive and verify public versus admin minimum-price behavior follows the contract above.
- Verify product detail, public/admin lists, cart, collection, advertisement, chatroom, order, delivery, refund, and account-related product objects return the expected root price.
- Verify `minPrice` and `maxPrice` use minimum variant price consistently in both pagination totals and returned rows.

### Historical price validation

- Create an order whose `unitPriceAtSale` matches the purchased variant's price at checkout.
- Change the live variant price afterward.
- Verify order, delivery, and refund APIs still return the original value in both `unitPriceAtSale` and `variantAtSale.price`.
- Verify line totals, sales revenue, refund defaults, and maximum refund checks remain based on `unitPriceAtSale`.

## Implementation Checklist

### Phase 1 — current `feat/variant-price` branch

- [x] Add nullable `product_variants.price` and nullable `product_variants.images`.
- [x] Add variant price/images validation and persistence.
- [x] Require price for every newly created variant while the database column is temporarily nullable.
- [x] Derive root API product price from the minimum eligible variant price.
- [x] Temporarily synchronize `products.price` to the minimum persisted variant price.
- [x] Move product price filters to minimum eligible variant price.
- [x] Add `variantAtSale.price` from `unitPriceAtSale` in order, delivery, and refund serializers.
- [x] Update all affected Swagger schemas and frontend handoff documentation.
- [x] Implement the idempotent variant price and first-product-image `src/back-fill.ts` script.
- [x] Generate the first migration.
- [x] Run `npm run build`.
- [ ] Run focused Phase 1 API checks.
- [x] User runs the first migration in the target environment.
- [x] User runs and verifies the backfill in the target environment.
- [x] Confirm zero null variant prices before starting Phase 2.

### Phase 2 — follow-up branch

- [x] Make `product_variants.price` non-nullable in the Drizzle schema.
- [x] Remove `products.price` from the Drizzle schema.
- [x] Remove product-level price from database insert/update inputs and request parsing.
- [x] Remove temporary synchronization writes to `products.price`.
- [x] Remove the root-price fallback to `products.price`.
- [x] Replace every raw product-price dependency with an explicit minimum-variant-price projection.
- [x] Keep computed root `product.price` in API responses.
- [x] Keep `variantAtSale.price` historical and backed by `unitPriceAtSale`.
- [ ] Generate the second migration containing `SET NOT NULL` and `DROP products.price`.
- [ ] Run `npm run build` and focused Phase 2 API checks.
- [ ] User runs the second migration in the target environment.
