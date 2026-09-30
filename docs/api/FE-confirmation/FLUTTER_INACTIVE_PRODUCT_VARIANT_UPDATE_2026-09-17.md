# Flutter inactive product and variant API update

Date: 2026-09-17  
Audience: Flutter app developers  
Scope: App APIs only; Flutter does not call the admin product-management APIs.

## Summary

A seller or platform admin can make a product or product variant inactive while
an app user is viewing it. Backend now prevents unavailable products and
variants from remaining purchasable through cart and order APIs.

There are three different lifecycle cases:

| Admin action | Cart result | Collection result |
| --- | --- | --- |
| Product status becomes `inactive` | All variants of the product are removed from every user's cart. | Product is hidden, but the saved collection row is preserved. It reappears if the product is reactivated. |
| One variant becomes `inactive` | That variant is removed from every user's cart. Other active variants remain. | No change because a collection saves a product, not a variant. |
| Product is soft-deleted | All variants are removed from every user's cart. | Product is permanently removed from every user's collection. |

The status change and related cart/collection cleanup are performed in the same
database transaction.

## Product list and detail

### `GET /api/product/list`

Flutter should request active products explicitly:

```http
GET /api/product/list?status=active&page=1&limit=20
```

Only active variants are included in each product's `variants` array. An
inactive variant can therefore disappear when the list is refreshed.

Important: when `status` is omitted, the endpoint does not currently apply an
implicit product-status filter. Always send `status=active` for customer-facing
lists.

### `GET /api/product/{id}`

The response includes active variants only. Flutter must treat the product as
unavailable when either condition is true:

```dart
product.status != ProductStatus.active || product.deletedAt != null
```

Do not show add-to-cart or buy actions for an unavailable product. If the
selected variant is no longer in `product.variants`, clear the selection and
ask the user to choose from the refreshed active variants.

## Cart APIs

### `GET /api/cart/list`

After a product or selected variant becomes inactive, its affected cart rows
are deleted. A refreshed cart list will no longer contain those rows.

Flutter should reconcile local cart state by cart-item ID or
`productVariantId`; it should not continue displaying a locally cached row that
is absent from the latest response.

### `POST /api/cart/item`

Request shape is unchanged:

```json
{
  "productId": "product-uuid",
  "productVariantId": "variant-uuid",
  "quantity": 1
}
```

New/confirmed availability failures:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Product is unavailable"
}
```

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Product variant is inactive"
}
```

The endpoint may also return `404` with `Product not found` or
`Product variant not found`.

To manually remove a stale cart row, send the same product and variant IDs with
`quantity: 0`:

```json
{
  "productId": "product-uuid",
  "productVariantId": "variant-uuid",
  "quantity": 0
}
```

Removal does not require the product or variant to still be active. It is
idempotent: the request also succeeds when the cart row has already been
removed by backend lifecycle cleanup.

### `PUT /api/cart/item/{cartItemId}/variant`

Changing a cart item's variant now also verifies that the parent product is
active and not soft-deleted. It may return the same `400` availability errors
shown above. The original cart row may already have been removed by backend, in
which case the endpoint returns `404` with `Cart item not found`.

### Cart error handling

For any availability-related `400` or `404` response:

1. Refresh `GET /api/cart/list`.
2. Replace the local cart state with the server response.
3. Inform the user that the product or selected variant is no longer available.

Do not automatically substitute another variant because price, options, and
stock may differ.

## Collection APIs

### `GET /api/collection/list`

Inactive products are omitted from the response and from its pagination
`total`. The collection record remains stored, so the product can reappear if
it is reactivated.

Flutter should not interpret a temporarily missing product as a user-initiated
removal and should not send `DELETE /api/collection` for it automatically.

Inactivating a single variant does not remove or hide the product-level
collection as long as the product itself remains active.

### `POST /api/collection`

Request shape is unchanged:

```json
{
  "productId": "product-uuid"
}
```

The product must be active and not soft-deleted. An unavailable product returns:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Product is unavailable"
}
```

A missing product returns `404` with `Product not found`.

### `DELETE /api/collection`

Flutter can manually remove a saved inactive product when it still knows the
product ID:

```json
{
  "productId": "product-uuid"
}
```

Deletion does not require the product to be active. Because inactive products
are hidden from `GET /api/collection/list`, Flutter must use the product ID from
its previously loaded/cached state if it offers this manual action. A collection
already removed by product soft-delete returns `404` with
`Collection not found`.

## Order creation

### `POST /api/order`

Backend validates every order item again inside the order transaction. It
rejects the complete order when any product or variant is missing, deleted, or
inactive. Possible per-item reasons include:

- `Product not found`
- `Product deleted`
- `Product inactive`
- `Variant not found`
- `Variant inactive`
- `Insufficient stock`

The current `400` response stores the item-error object as a JSON string in
`message`:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "{\"error\":[{\"productId\":\"product-uuid\",\"productVariantId\":\"variant-uuid\",\"productName\":\"Example\",\"reason\":\"Variant inactive\"}]}"
}
```

Flutter should parse `message` as JSON when possible, show which item became
unavailable, and then refresh both the product/cart data. Keep a fallback for a
plain-text `message` in case the failure is not an item-validation error.

## Recommended Flutter flow

1. Fetch customer-facing products with `status=active`.
2. Use only variants present in the latest product response.
3. Before checkout, use the latest `GET /api/cart/list` response.
4. Treat add-to-cart, variant-change, collection, and order availability errors
   as recoverable stale-data cases.
5. Refresh the affected API and replace local cached state.

There are no successful response-shape changes and no new Flutter request
fields in this update.
