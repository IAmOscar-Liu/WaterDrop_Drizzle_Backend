# Flutter — batch checkout validation

Date: 2026-10-23

Status: **Part A implemented; deployment required before Flutter switches to this endpoint.** No schema change or migration is required. Part B now has a separate [synchronous logistics verification handoff](FLUTTER_LOGISTICS_VERIFICATION_API_CHANGES.md). This app-only endpoint is excluded from admin Swagger. Flutter code was not changed in this delivery.

## Request

```http
POST /api/cart/validate-checkout
Authorization: Bearer APP_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "items": [
    {
      "cartItemId": "9758ceeb-d0ec-49f8-a470-dc3995628860",
      "productVariantId": "fa3e06ae-e13a-4530-b261-94f165a91457",
      "quantity": 2,
      "expectedUnitPrice": 299
    }
  ]
}
```

Send the **complete selected cart set**, frozen after pending cart operations finish. The user is derived from the bearer token. A valid admin/seller login cannot use this endpoint, and the app user must still exist.

- `items`: 1–4 rows; each `cartItemId` and `productVariantId` must be unique. UUIDs are case-insensitive and normalized to lowercase.
- `quantity`: JSON number, positive integer, maximum 2,147,483,647; must equal the saved cart quantity.
- `expectedUnitPrice`: finite, nonnegative JSON number, taken from the selected variant price displayed to the buyer. Numeric strings are rejected. Comparison uses the stored variant price as a number, with **no new rounding or two-decimal restriction**. For example, `299` and `299.0` are equal; a stored `99.125` must be sent as `99.125`. Do not use the product's aggregate/minimum price or calculate the unit price from rounded totals.
- Unknown fields are rejected, including `userId`, `productId`, totals and unknown per-item fields.

## Response

Completed checks return HTTP 200 and `{ "success": true, "data": ... }`, including business failures. Only **`data.canCheckout === true`** allows Flutter to continue.

| Field in `data` | Meaning |
| --- | --- |
| `canCheckout` | True only when the selected set and every item pass. |
| `checkedAt` | UTC ISO timestamp from the read transaction; not a reservation expiry or validation token. |
| `issues` | Overall issues, currently selection-set changes. Each issue is `{code,message}`. |
| `items` | One result per requested item, in request order. |
| `cartItems` | The **entire owned cart**, including unchecked rows, in the same format as `GET /api/cart/list` data. Includes existing product, variant, seller and category fields. Empty only when the actual cart is empty. |

Each entry in `data.items` has:

```json
{
  "cartItemId": "9758ceeb-d0ec-49f8-a470-dc3995628860",
  "productId": "8f2c3806-e018-4f19-8b85-b5becc2abe42",
  "productVariantId": "fa3e06ae-e13a-4530-b261-94f165a91457",
  "productName": "商品名稱",
  "variantName": "藍色",
  "requestedQuantity": 2,
  "currentQuantity": 2,
  "currentUnitPrice": 299,
  "availableStock": 1,
  "canCheckout": false,
  "issues": [{ "code": "INSUFFICIENT_STOCK", "message": "庫存不足" }]
}
```

The IDs/names/quantity/price/stock describe the **current owned cart row**, while `cartItemId` and `requestedQuantity` identify the request. If the variant changed, `productVariantId` is the current variant, and `CART_ITEM_CHANGED` requires reconfirmation. Unnamed/default variants can have `variantName:null` and follow the same rules.

For a foreign or missing cart row, all latest-data fields are null (`productId`, `productVariantId`, names, `currentQuantity`, `currentUnitPrice`, `availableStock`); only the submitted cart ID/quantity are echoed. Both cases return `CART_ITEM_UNAVAILABLE`, without identifying the owner. The full cart contains only the authenticated user's rows.

`availableStock` is the selected variant's `stock - reserve`, normalized to zero if negative. Missing/invalid stock is **null**, not zero, and blocks checkout. Invalid/missing price also returns null and blocks checkout. Unavailable products/variants remain failures even when a numeric price/stock is present.

| Code | Meaning |
| --- | --- |
| `CART_SELECTION_CHANGED` | Submitted IDs differ from the server's checked set; also appears on requested rows that are now unchecked. |
| `CART_ITEM_UNAVAILABLE` | Missing or foreign cart row. |
| `CART_ITEM_CHANGED` | Saved quantity or selected variant changed. |
| `PRODUCT_UNAVAILABLE` | Missing, deleted or inactive product. |
| `VARIANT_UNAVAILABLE` | Missing/inactive variant or mismatched product relation. |
| `PRICE_CHANGED` | Current variant price differs from the supplied snapshot. |
| `PRICE_UNAVAILABLE` | Cannot establish a finite nonnegative variant price. |
| `INSUFFICIENT_STOCK` | Requested quantity exceeds current available stock. |
| `STOCK_UNAVAILABLE` | Cannot establish stock/reserve values. |

Multiple issues can apply to a row. An overall selection error can block checkout even if individual rows pass. For example, submitting one valid row while two are checked returns overall `canCheckout:false` and `CART_SELECTION_CHANGED`.

HTTP 400 uses the existing validation envelope for malformed requests. Missing/invalid authentication or a nonexistent app user returns 401; account tokens are rejected (401/403 depending on account authentication). Database/system failures return a non-success response, normally 500. Never interpret those failures as permission to continue.

## Flutter integration

1. Wait for cart writes/sync to finish; freeze the selected rows and current account/cart revision.
2. Call this endpoint once, replacing the initial cart GET and per-product availability GETs.
3. If the account/cart revision changed while waiting, discard the stale result and revalidate.
4. Otherwise, replace the cart with `cartItems`. On failure, stay on the cart and show the issues. Price, selection or quantity changes require another user confirmation; do not silently reduce quantity, choose another variant, or proceed.
5. On success, continue using the returned cart data for the existing logistics-field validation, shipping calculation and checkout flow. Those requests are not replaced by this endpoint.
6. Any optional unavailable-item cleanup remains a separate explicit cart mutation. The validation endpoint never deletes or adjusts rows.

Retries simply obtain a new snapshot; no idempotency key is needed because the endpoint is read-only. It does not create orders, reserve stock, deduct coins, change the cart or call ECPay.

## Consistency and limits

User lookup, complete cart data and validation run in a read-only PostgreSQL `REPEATABLE READ` transaction. The existing cart relation query and serializer are reused inside that transaction; no per-item product queries or reservation locks are added.

Stock, prices and selection can change after the transaction finishes. Existing order-creation locking and stock checks remain in place; a passing precheck can still be followed by an order rejection.

**Separate follow-up:** this A-only delivery does not change `POST /api/order`. Its existing client-supplied unit-price/total handling still needs server-side pricing hardening. The new precheck is not a trusted order quote and does not fix direct order-price tampering. Part B is delivered separately as a synchronous request; see its handoff above, which supersedes the proposed callback/job design.

## Validation

```bash
npm run build
npm run test:checkout-validation
```

The integration suite uses the existing disposable PostgreSQL test harness; it does not migrate configured local/development/staging databases or send emails, pushes or ECPay requests. It checks authentication, owned/foreign/missing rows, strict inputs, default/multiple variants, exact stock boundaries, price and selection changes, unavailable products/variants, unknown values, unchanged cart data, consistent snapshots, database failures and final-order stock rejection after precheck.
