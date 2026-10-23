import { Router } from "express";
import controller from "../../controller/adminChatroomSync";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

const router = Router();
const validation = adminValidation.chatroomSync;
// Route-local auth keeps all legacy middleware and handlers untouched.
router.get("/events", isAuth, validateZod({ query: validation.eventsQuery }), controller.events);
router.get("/sync/list", isAuth, validateZod({ query: validation.listQuery }), controller.list);
router.get("/sync/history/:chatRoomId", isAuth, validateZod({ params: validation.roomParams, query: validation.historyQuery }), controller.history);
router.post("/sync/message/:chatRoomId", isAuth, validateZod({ params: validation.roomParams, body: validation.sendBody }), controller.send);
router.put("/sync/message/:chatRoomId/read", isAuth, validateZod({ params: validation.roomParams, body: validation.readBody }), controller.read);
export default router;

/**
 * @swagger
 * components:
 *   schemas:
 *     AdminSyncChatMessage:
 *       allOf:
 *         - $ref: "#/components/schemas/ChatMessage"
 *         - type: object
 *           properties:
 *             clientMessageId:
 *               type: string
 *               format: uuid
 *               nullable: true
 *             version:
 *               type: integer
 *               minimum: 1
 *     AdminSyncChatListState:
 *       type: object
 *       properties:
 *         version:
 *           type: integer
 *           minimum: 1
 *         totalRooms:
 *           type: integer
 *           minimum: 0
 *         totalUnread:
 *           type: integer
 *           minimum: 0
 *     AdminSyncChatRoom:
 *       allOf:
 *         - $ref: "#/components/schemas/AdminChatRoomListItem"
 *         - type: object
 *           properties:
 *             version:
 *               type: integer
 *               minimum: 1
 *             lastActivityAt:
 *               type: string
 *               format: date-time
 *               description: UTC ordering timestamp preserving PostgreSQL microseconds.
 *             listVisible:
 *               type: boolean
 *             lastMessage:
 *               allOf:
 *                 - $ref: "#/components/schemas/AdminSyncChatMessage"
 *               nullable: true
 *             product:
 *               type: object
 *               nullable: true
 *               properties:
 *                 price:
 *                   type: number
 *                   nullable: true
 *     AdminSyncChatList:
 *       type: object
 *       properties:
 *         rooms:
 *           type: array
 *           items:
 *             $ref: "#/components/schemas/AdminSyncChatRoom"
 *         page:
 *           type: integer
 *           minimum: 0
 *         limit:
 *           type: integer
 *           minimum: 0
 *         total:
 *           type: integer
 *           minimum: 0
 *         totalPages:
 *           type: integer
 *           minimum: 0
 *         listState:
 *           $ref: "#/components/schemas/AdminSyncChatListState"
 *         listSnapshot:
 *           type: string
 *           nullable: true
 *         listSnapshotExpiresAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *     AdminSyncChatHistory:
 *       type: object
 *       properties:
 *         messages:
 *           type: array
 *           items:
 *             $ref: "#/components/schemas/AdminSyncChatMessage"
 *         page:
 *           type: integer
 *           minimum: 0
 *           description: Omitted on before-cursor pages.
 *         total:
 *           type: integer
 *           minimum: 0
 *           description: Omitted on before-cursor pages.
 *         totalPages:
 *           type: integer
 *           minimum: 0
 *           description: Omitted on before-cursor pages.
 *         limit:
 *           type: integer
 *           minimum: 0
 *         hasMore:
 *           type: boolean
 *         nextCursor:
 *           type: string
 *           nullable: true
 *     AdminSyncChatSend:
 *       type: object
 *       properties:
 *         senderType:
 *           type: string
 *           enum:
 *             - admin
 *             - seller
 *           description: Optional; if supplied must match authenticated role (employees act as seller).
 *         content:
 *           type: string
 *         clientMessageId:
 *           type: string
 *           format: uuid
 *           description: Reuse for retry of same content and attachments; persistent room/account-scoped deduplication.
 *         attachments:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 minLength: 1
 *               name:
 *                 type: string
 *                 nullable: true
 *               mimeType:
 *                 type: string
 *                 nullable: true
 *               size:
 *                 type: number
 *                 minimum: 0
 *                 nullable: true
 *             required:
 *               - url
 *           nullable: true
 *       description: Non-whitespace content or at least one attachment required. Each attachment requires url.
 *     AdminSyncChatEvent:
 *       type: object
 *       properties:
 *         schemaVersion:
 *           type: integer
 *           enum:
 *             - 1
 *         chatRoomId:
 *           type: string
 *           format: uuid
 *         message:
 *           $ref: "#/components/schemas/AdminSyncChatMessage"
 *         readerType:
 *           type: string
 *           enum:
 *             - user
 *             - admin
 *             - seller
 *         readAt:
 *           type: string
 *           format: date-time
 *         messages:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *               version:
 *                 type: integer
 *                 minimum: 1
 *               isRead:
 *                 type: boolean
 *                 enum:
 *                   - true
 *         room:
 *           $ref: "#/components/schemas/AdminSyncChatRoom"
 *         roomVersion:
 *           type: integer
 *           minimum: 1
 *         reason:
 *           type: string
 *         listState:
 *           $ref: "#/components/schemas/AdminSyncChatListState"
 * /api/admin/chatroom/events:
 *   get:
 *     tags:
 *       - Chatroom
 *     security:
 *       - bearerAuth: []
 *     summary: Durable admin/seller chat SSE
 *     description: >-
 *       One account-scoped stream across all accessible rooms, including empty rooms. Platform admins see all active
 *       rooms; sellers/employees see only their seller rooms. Independent from app chat and notification cursors.
 *       stream.ready has schemaVersion/cursor; message.created carries message, messages.read carries
 *       readerType/readAt/messages, chatroom.updated carries room/listState, chatroom.removed carries
 *       roomVersion/reason/listState. Durable frames have signed id and AdminSyncChatEvent data. Heartbeat comments every
 *       15s; reset requires full REST bootstrap. JWT expiry closes the stream. 48h replay; 3 connections/account/process,
 *       200 admin-chat connections/process.
 *     parameters:
 *       - name: Last-Event-ID
 *         in: header
 *         required: false
 *         description: Optional checkpoint returned by this account/scope stream.
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: text/event-stream; see AdminSyncChatEvent and the FE handoff for event-specific payloads.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *             example: |+
 *               retry: 3000
 *               event: stream.ready
 *               data: {"schemaVersion":1,"cursor":"OPAQUE_ADMIN_CURSOR"}
 *
 *       "400":
 *         description: Validation, cursor or snapshot mismatch; JSON error envelope with code when applicable.
 *       "401":
 *         description: Missing/expired access token.
 *       "403":
 *         description: Inactive/non-account identity, wrong role, owner or seller scope.
 *       "404":
 *         description: Room inaccessible, unknown or inactive.
 *       "409":
 *         description: CLIENT_MESSAGE_ID_CONFLICT or ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE.
 *       "410":
 *         description: Replay or snapshot expired; bootstrap again.
 *       "429":
 *         description: "Stream or snapshot limit; stream returns Retry-After: 15."
 * /api/admin/chatroom/sync/list:
 *   get:
 *     tags:
 *       - Chatroom
 *     security:
 *       - bearerAuth: []
 *     summary: Versioned active admin chatrooms with optional frozen pagination
 *     description: >-
 *       Empty/inactive rooms are hidden. listState counts all active accessible rooms and unread user messages,
 *       independent of filters. Snapshots freeze membership/order for 15m, max 10000 rooms and 5/account. New snapshot
 *       starts on page 1. Repeat identical filters/limit with token. Revoked entries leave holes; use frozen totalPages.
 *       Order status/trade-number changes and displayed delivery changes publish chatroom.updated transactionally.
 *       Delivery events target rooms for matching order items. Unchanged polls do not bump revisions.
 *       Catalog metadata still refreshes via REST.
 *       Failed checkouts return orderId and order as null, including historical failed orders with delivery data.
 *       A payment failure publishes chatroom.updated to clear previously displayed order/delivery status.
 *     parameters:
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000000
 *           default: 1
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Page size.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - name: productId
 *         in: query
 *         required: false
 *         description: Filter product.
 *         schema:
 *           type: string
 *           format: uuid
 *       - name: productVariantId
 *         in: query
 *         required: false
 *         description: Filter variant.
 *         schema:
 *           type: string
 *           format: uuid
 *       - name: supportOnly
 *         in: query
 *         required: false
 *         description: Platform admin only; accountId/productId must both be null. Cannot combine with product filters.
 *         schema:
 *           type: string
 *           enum:
 *             - "true"
 *             - "false"
 *       - name: snapshot
 *         in: query
 *         required: false
 *         description: Create snapshot; cannot combine true with listSnapshot.
 *         schema:
 *           type: string
 *           enum:
 *             - "true"
 *             - "false"
 *       - name: listSnapshot
 *         in: query
 *         required: false
 *         description: Owner/scope/query/page-size bound snapshot token.
 *         schema:
 *           type: string
 *           maxLength: 4096
 *     responses:
 *       "200":
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum:
 *                     - true
 *                 data:
 *                   $ref: "#/components/schemas/AdminSyncChatList"
 *       "400":
 *         description: Validation, cursor or snapshot mismatch; JSON error envelope with code when applicable.
 *       "401":
 *         description: Missing/expired access token.
 *       "403":
 *         description: Inactive/non-account identity, wrong role, owner or seller scope.
 *       "404":
 *         description: Room inaccessible, unknown or inactive.
 *       "409":
 *         description: CLIENT_MESSAGE_ID_CONFLICT or ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE.
 *       "410":
 *         description: Replay or snapshot expired; bootstrap again.
 *       "429":
 *         description: "Stream or snapshot limit; stream returns Retry-After: 15."
 * /api/admin/chatroom/sync/history/{chatRoomId}:
 *   get:
 *     tags:
 *       - Chatroom
 *     security:
 *       - bearerAuth: []
 *     summary: Versioned admin chat history with keyset pagination
 *     description: >-
 *       Newest first by (createdAt, id). before cannot combine with page/startAt/endAt. Date-filtered offset pages return
 *       null nextCursor. Room authorization is checked for every request.
 *     parameters:
 *       - name: chatRoomId
 *         in: path
 *         required: true
 *         description: Active room in the authenticated account scope.
 *         schema:
 *           type: string
 *           format: uuid
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000000
 *           default: 1
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Page size.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - name: before
 *         in: query
 *         required: false
 *         description: Opaque room-bound history cursor.
 *         schema:
 *           type: string
 *           maxLength: 2048
 *       - name: startAt
 *         in: query
 *         required: false
 *         description: Inclusive lower history timestamp.
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: endAt
 *         in: query
 *         required: false
 *         description: Inclusive upper history timestamp.
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       "200":
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum:
 *                     - true
 *                 data:
 *                   $ref: "#/components/schemas/AdminSyncChatHistory"
 *       "400":
 *         description: Validation, cursor or snapshot mismatch; JSON error envelope with code when applicable.
 *       "401":
 *         description: Missing/expired access token.
 *       "403":
 *         description: Inactive/non-account identity, wrong role, owner or seller scope.
 *       "404":
 *         description: Room inaccessible, unknown or inactive.
 *       "409":
 *         description: CLIENT_MESSAGE_ID_CONFLICT or ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE.
 *       "410":
 *         description: Replay or snapshot expired; bootstrap again.
 *       "429":
 *         description: "Stream or snapshot limit; stream returns Retry-After: 15."
 * /api/admin/chatroom/sync/message/{chatRoomId}:
 *   post:
 *     tags:
 *       - Chatroom
 *     security:
 *       - bearerAuth: []
 *     summary: Send admin chat message with persistent retry deduplication
 *     description: >-
 *       Account role is derived from token. Uses existing auto-read-on-send semantics (other sender roles). A retry
 *       returns current canonical message without additional events or app push. Successful new sends preserve app-user
 *       FCM behavior; no admin push notification is sent.
 *     parameters:
 *       - name: chatRoomId
 *         in: path
 *         required: true
 *         description: Active room in the authenticated account scope.
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AdminSyncChatSend"
 *     responses:
 *       "200":
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum:
 *                     - true
 *                 data:
 *                   $ref: "#/components/schemas/AdminSyncChatMessage"
 *       "400":
 *         description: Validation, cursor or snapshot mismatch; JSON error envelope with code when applicable.
 *       "401":
 *         description: Missing/expired access token.
 *       "403":
 *         description: Inactive/non-account identity, wrong role, owner or seller scope.
 *       "404":
 *         description: Room inaccessible, unknown or inactive.
 *       "409":
 *         description: CLIENT_MESSAGE_ID_CONFLICT or ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE.
 *       "410":
 *         description: Replay or snapshot expired; bootstrap again.
 *       "429":
 *         description: "Stream or snapshot limit; stream returns Retry-After: 15."
 * /api/admin/chatroom/sync/message/{chatRoomId}/read:
 *   put:
 *     tags:
 *       - Chatroom
 *     security:
 *       - bearerAuth: []
 *     summary: Mark chat messages read and publish versioned receipts
 *     description: >-
 *       Preserves other-role read semantics: a seller reads user/admin messages; an admin reads user/seller messages.
 *       Marks all currently unread matching messages, not only displayed history. No-op returns [] and emits nothing.
 *       Unread list counts only user messages.
 *     parameters:
 *       - name: chatRoomId
 *         in: path
 *         required: true
 *         description: Active room in the authenticated account scope.
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               readerType:
 *                 type: string
 *                 enum:
 *                   - admin
 *                   - seller
 *                 description: Optional role assertion; normally send {}.
 *     responses:
 *       "200":
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum:
 *                     - true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/AdminSyncChatMessage"
 *       "400":
 *         description: Validation, cursor or snapshot mismatch; JSON error envelope with code when applicable.
 *       "401":
 *         description: Missing/expired access token.
 *       "403":
 *         description: Inactive/non-account identity, wrong role, owner or seller scope.
 *       "404":
 *         description: Room inaccessible, unknown or inactive.
 *       "409":
 *         description: CLIENT_MESSAGE_ID_CONFLICT or ADMIN_CHAT_LIST_SNAPSHOT_TOO_LARGE.
 *       "410":
 *         description: Replay or snapshot expired; bootstrap again.
 *       "429":
 *         description: "Stream or snapshot limit; stream returns Retry-After: 15."
 */
