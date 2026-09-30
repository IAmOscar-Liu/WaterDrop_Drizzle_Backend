# Chatroom authorization fix

Status: implemented locally; not deployed. SSE is not implemented by this change.

This closes the room-access gap identified in [the SSE backend review](FLUTTER_CHATROOM_SSE_BACKEND_REVIEW.md). No database schema change or migration is required.

## Access rules

The backend now carries the authenticated identity through controller, service, and repository checks for room detail, history, sending, and mark-read requests.

| Caller | Allowed room scope | Sender/reader role |
| --- | --- | --- |
| App user | Their own active rooms | `user` |
| Seller | Active rooms whose `accountId` is that seller | `seller` |
| Seller employee | Active rooms whose `accountId` is their active parent seller | `seller` |
| Platform admin | All active rooms, including general support | `admin` |

Seller employee room lists now use the same parent-seller scope. Admin list status filters remain supported, including listing inactive rooms; detail/history/send/read require active rooms. The app list still contains only the user's active rooms that have messages.

App requests require an existing user. Admin requests require an active, non-deleted account; employees must belong to an active seller. Supplying a different `senderType`, `readerType`, user ID, or account ID cannot grant access. The route selects the user/account identity namespace and the repository derives its authorized role.

## Affected endpoints

App:

- `GET /api/chatroom/{chatRoomId}`
- `GET /api/chatroom/history/{chatRoomId}`
- `POST /api/chatroom/message/{chatRoomId}`
- `PUT /api/chatroom/message/{chatRoomId}/read`
- `POST /api/chatroom/create`
- `GET /api/chatroom/list` (also verifies the user still exists)

Admin:

- `GET /api/admin/chatroom/list`
- `GET /api/admin/chatroom/history/{chatRoomId}`
- `POST /api/admin/chatroom/message/{chatRoomId}`
- `PUT /api/admin/chatroom/message/{chatRoomId}/read`

Success response shapes and pagination are unchanged. Existing required sender/reader fields remain, but must match the authenticated role. Automatic mark-read-on-send and the existing “other sender roles” read predicate are preserved; this fix does not introduce new read semantics.

Room access is checked before returning history and inside the transaction for message/read writes. Authorized room rows are locked while those transactions execute, so room access changes cannot race an in-flight room write. Unauthorized attempts do not insert messages/attachments or change existing read states.

## Room creation relationships

- A supplied `orderId` must belong to the authenticated user, including when finding/reactivating an existing room.
- A supplied variant must belong to the supplied product.
- For a product room, `accountId` must match the product seller. If omitted, the backend derives it from the product.
- A supplied/derived recipient must be an active, non-deleted seller or platform admin. Employee IDs are not valid recipient IDs.
- If both product/variant and order are supplied, the order must contain that product variant.
- A seller-specific order room without product fields must still refer to an order containing that seller's product.
- General support rooms without account/product/order fields continue to work. An own-order general support room is also allowed.

These checks run before associating an order with an existing room or reactivating it.

## Errors

The existing `{ success: false, statusCode, message }` envelope is retained.

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid request shape or inconsistent product/seller/order association. App sender/reader roles other than `user` fail validation. |
| `401` | Missing/invalid token or the app identity no longer identifies a user. |
| `403` | Admin account/seller scope unavailable, or the supplied admin sender/reader role does not match the authenticated role. |
| `404` | Room missing, inactive, or outside caller scope. Also used for missing/foreign orders and unavailable room recipients/variants. |

Foreign rooms and nonexistent rooms use the same response status. Clients should handle unavailable rooms without retrying a write under another role.

## Internal messages and documentation

Refund automation uses an explicit internal `sendSystemChatMessage` repository entry point. HTTP services require a `ChatroomActor` and cannot select the internal entry point through a request field. Automated writes retain their existing message roles and active-room check.

Swagger remains admin-only. Admin chat documentation now describes account scopes, role matching, and authorization errors. Flutter developers should use this Markdown handoff.

## Verification

- `npm run build`
- `npm run test:chatroom-auth`: authenticated HTTP integration tests in a disposable PostgreSQL database; covers foreign/missing/inactive rooms, spoofed roles, user/account namespace checks, no mutation on denied writes, allowed owner/seller/employee/admin access, creation relationships, inactive seller scope, and internal messages.
- `npm run test:api`: existing API regression suite, including the refund workflow and its generated chat message.

Deployment remains a separate step. This change adds no SSE endpoint, replay storage, history cursor, or migration.

## Refund permission follow-up

Refund creation and updates now permit platform admins and the product's own seller; employees cannot write refunds. Refund detail uses the same seller scope as the list. Existing app users may still request refunds for their own orders. The full policy and tests are documented in the [admin refund guide](FE-confirmation/ADMIN_REFUND_API.md#authorization).

The automated chat context now separates the acting role from the recipient: the room belongs to the product seller, while the message carries the authenticated actor's role. User-, seller-, and admin-created refund messages are covered by integration tests. Read-only product/order lookups during room creation no longer take locks that conflict with concurrent refund writes; room mutations remain transactional.
