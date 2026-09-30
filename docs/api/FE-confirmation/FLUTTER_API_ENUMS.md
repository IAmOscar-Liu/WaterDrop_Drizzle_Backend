# Flutter API Enum Fields

This document lists enum-like string fields used by non-admin APIs under `/api/*`.

## Enum Definitions

```dart
enum OAuthProvider { google, apple, github, facebook, line, password, other }
enum ProductStatus { active, inactive }
enum ProductType { normal, refrigeration, virtual }
enum ChatRoomStatus { active, inactive }
enum ChatMessageSenderType { user, admin, seller }
enum OrderPayment { Credit, ATM }
enum OrderStatus { pending, paymentProcessing, paid, failed, expired, canceled }
enum RefundStatus { pending, processing, completed, cancelled }
enum DeliveryStatus {
  pending,
  shipped,
  readyForPickup,
  delivered,
  returned,
  cancelled,
  exception,
  unknown
}
enum DeliveryLogisticsType { CVS, homeDelivery, virtual }
enum AdvertisementStatus { active, paused, depleted, archived }
enum AdvertisementTransactionType { deposit }
enum NotificationType {
  systemAlert,
  orderStatus,
  promotion,
  coinsEarned,
  chatMessage,
  other
}
```

Wire values are still strings. For Dart enum mapping, keep the original API wire values:

- `payment-processing`
- `ready_for_pickup`
- `home_delivery`
- `system_alert`
- `order_status`
- `coins_earned`
- `chat_message`

## `/api/auth`

### `POST /api/auth/login`

Request:

- `oauthProvider`: `OAuthProvider`

Response:

- `data.user.oauthProvider`: `OAuthProvider`

### `GET /api/auth/profile`

Response:

- `data.oauthProvider`: `OAuthProvider`

Other auth endpoints currently have no enum fields in request/response.

## `/api/product`

### `GET /api/product/list`

Response:

- `data.products[].status`: `ProductStatus`
- `data.products[].type`: `ProductType`
- `data.products[].variants[].status`: `ProductStatus`
- `data.products[].seller.role`: account role from admin domain, usually `admin | seller | employee`

### `GET /api/product/{id}`

Response:

- `data.status`: `ProductStatus`
- `data.type`: `ProductType`
- `data.variants[].status`: `ProductStatus`
- `data.seller.role`: account role from admin domain, usually `admin | seller | employee`

### `GET /api/product/categories/list`

No enum fields.

## `/api/advertisement`

### `GET /api/advertisement/list`

Response:

- `data.advertisements[].product.status`: `ProductStatus`
- `data.advertisements[].product.type`: `ProductType`
- `data.advertisements[].product.variants[].status`: `ProductStatus`

The public advertisement list only returns ads whose stats are active and funded, but the stats object is not returned by this endpoint.

## `/api/cart`

### `GET /api/cart/list`

Response:

- `data[].product.status`: `ProductStatus`
- `data[].product.type`: `ProductType`
- `data[].product.variants[].status`: `ProductStatus`
- `data[].variant.status`: `ProductStatus`
- `data[].product.seller.role`: account role from admin domain, usually `admin | seller | employee`

### `POST /api/cart/item`

No enum fields in request. Response is the cart item row and may include no nested product enum fields.

### `PUT /api/cart/item/toggle`

No enum fields.

### `PUT /api/cart/item/{cartItemId}/variant`

No enum fields in request. Response is the cart item row and may include no nested product enum fields.

## `/api/collection`

### `GET /api/collection/list`

Response:

- `data.collections[].product.status`: `ProductStatus`
- `data.collections[].product.type`: `ProductType`
- `data.collections[].product.variants[].status`: `ProductStatus`
- `data.collections[].product.seller.role`: account role from admin domain, usually `admin | seller | employee`

### `POST /api/collection`

No enum fields.

### `DELETE /api/collection`

No enum fields.

## `/api/order`

### `GET /api/order/list`

Request query:

- `statusIn[]`: `OrderStatus[]`
- `order`: sort direction, `asc | desc`

Default `statusIn` used by backend when omitted:

```ts
["paid", "payment-processing"]
```

Response:

- `data.orders[].orderStatus`: `OrderStatus`
- `data.orders[].orderPayment`: `OrderPayment`
- `data.orders[].deliveries[].status`: `DeliveryStatus`
- `data.orders[].deliveries[].LogisticsType`: `DeliveryLogisticsType`

### `GET /api/order/{id}`

Response:

- `data.orderStatus`: `OrderStatus`
- `data.orderPayment`: `OrderPayment`
- `data.items[].product.status`: `ProductStatus`
- `data.items[].product.type`: `ProductType`
- `data.items[].variant.status`: `ProductStatus`
- `data.items[].refundItems[].status`: `RefundStatus`
- `data.deliveries[].status`: `DeliveryStatus`
- `data.deliveries[].LogisticsType`: `DeliveryLogisticsType`
- `data.deliveries[].items[]` uses `variantAtSale` for historical variant display; no enum fields there unless adding nested product later.
- `data.deliveries[].logs[].status`: `DeliveryStatus`

### `POST /api/order`

Request:

- `orderPayment`: `OrderPayment`

Response:

- `data.orderStatus`: `OrderStatus`
- `data.orderPayment`: `OrderPayment`
- nested item/product fields can include the same product/variant enums as `GET /api/order/{id}`.

### `PUT /api/order/{orderId}`

Request:

- `status`: `OrderStatus`

Response:

- `data.orderStatus`: `OrderStatus`
- `data.orderPayment`: `OrderPayment`

### `POST /api/order/send-notification`

No enum fields.

## `/api/refund`

### `POST /api/refund`

No enum fields in request.

Response:

- `data.status`: `RefundStatus`
- `data.orderItem.delivery.status`: `DeliveryStatus`
- `data.orderItem.delivery.LogisticsType`: `DeliveryLogisticsType`
- `data.orderItem.order.orderStatus`: `OrderStatus`
- `data.orderItem.order.orderPayment`: `OrderPayment`

## `/api/chatroom`

### `GET /api/chatroom/list`

Response:

- `data.rooms[].status`: `ChatRoomStatus`
- `data.rooms[].lastMessage.senderType`: `ChatMessageSenderType`
- `data.rooms[].order.orderStatus`: `OrderStatus`
- `data.rooms[].order.delivery.status`: `DeliveryStatus`
- `data.rooms[].order.delivery.LogisticsType`: `DeliveryLogisticsType`

### `POST /api/chatroom/create`

No enum fields in request. Response includes:

- `data.status`: `ChatRoomStatus`

### `GET /api/chatroom/{chatRoomId}`

Response:

- `data.status`: `ChatRoomStatus`

### `GET /api/chatroom/history/{chatRoomId}`

Response:

- `data.messages[].senderType`: `ChatMessageSenderType`

### `POST /api/chatroom/message/{chatRoomId}`

Request:

- `senderType`: `ChatMessageSenderType`, but Flutter should only send `user`

Response:

- `data.senderType`: `ChatMessageSenderType`

### `PUT /api/chatroom/message/{chatRoomId}/read`

Request:

- `readerType`: `ChatMessageSenderType`, but Flutter should only send `user`

## `/api/notification`

### `GET /api/notification/list`

Request query:

- `types[]` or `types`: `NotificationType[]`

Response:

- `data.notifications[].type`: `NotificationType`

### `GET /api/notification/stats`

Response:

- object keys are `NotificationType` plus `total`

### `GET /api/notification/{id}`

Response:

- `data.type`: `NotificationType`

### `POST /api/notification/mark-as-read`

No enum fields.

### `DELETE /api/notification`

No enum fields.

## `/api/delivery`

### `POST /api/delivery/create`

This route exists in the non-admin router, but delivery creation is normally handled by payment/logistics flows. If Flutter calls it directly, request body can include:

- `status`: `DeliveryStatus`
- `LogisticsType`: `DeliveryLogisticsType`

Response:

- `data.status`: `DeliveryStatus`
- `data.LogisticsType`: `DeliveryLogisticsType`

### `GET /api/delivery/shipping-fee-and-tax-rate`

No enum fields.

### `POST /api/delivery/shipping-fee`

No enum fields.

## `/api/ecpay`

Most `/api/ecpay/*` routes are payment/logistics integration endpoints rather than normal app data APIs.

Enum-like request/response strings that Flutter may encounter:

- `ChoosePayment`: `Credit | ATM`
- `LogisticsType`: `CVS | home_delivery | virtual`
- `LogisticsSubType`: fixed string set from ECPay, currently used values include:
  - `FAMI`
  - `UNIMART`
  - `FAMIC2C`
  - `UNIMARTC2C`
  - `HILIFEC2C`
  - `OKMARTC2C`
  - `OKMART_LOW_TMP_C2C`

`LogisticsSubType` is not a database enum, but Flutter can still model it as an app enum if these are the only supported choices.

## `/api/treasureBox`

No enum fields in current request/response payloads.

## `/api/system`

No enum fields in current request/response payloads.

## `/api/file`

No enum fields in current request/response payloads.
