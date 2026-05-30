import { Router } from "express";
import ChatroomController from "../../controller/chatroom";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

const router = Router();
/**
 * @swagger
 * tags:
 *   name: Chatroom
 *   description: Chatroom management for administrators
 *
 * components:
 *   schemas:
 *     ChatMessage:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         chatRoomId:
 *           type: string
 *         senderType:
 *           type: string
 *           enum: [user, admin, seller]
 *         content:
 *           type: string
 *         isRead:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         attachments:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *               name:
 *                 type: string
 *                 nullable: true
 *               createdAt:
 *                 type: string
 *                 format: date-time
 *               updatedAt:
 *                 type: string
 *                 format: date-time
 *               size:
 *                 type: number
 *                 nullable: true
 *               chatMessageId:
 *                 type: string
 *                 format: uuid
 *               url:
 *                 type: string
 *                 example: "https://pub-your-bucket.r2.dev/images/uuid.jpg"
 *               mimeType:
 *                 type: string
 *                 nullable: true
 *                 example: "image/jpeg"
 *
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         email:
 *           type: string
 *           format: email
 *         oauthProvider:
 *           type: string
 *           enum: [google, apple, github, facebook, line, password, other]
 *         oauthId:
 *           type: string
 *         coins:
 *           type: integer
 *         referralCode:
 *           type: string
 *         phone:
 *           type: string
 *           nullable: true
 *         address:
 *           type: string
 *           nullable: true
 *         avatar_url:
 *           type: string
 *           nullable: true
 *         termsAcceptedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         groupId:
 *           type: string
 *           nullable: true
 *         timezone:
 *           type: string
 *           nullable: true
 *
 *     ChatRoom:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         productId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         userId:
 *           type: string
 *           format: uuid
 *         accountId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [active, inactive]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     AdminChatRoomListItem:
 *       allOf:
 *         - $ref: '#/components/schemas/ChatRoom'
 *         - type: object
 *           properties:
 *             user:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *             product:
 *               type: object
 *               nullable: true
 *               description: Null when accountId is null. These rooms are for general customer support instead of a specific product, and only admin accounts receive them because they can support customers directly.
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 images:
 *                   type: array
 *                   items:
 *                     type: string
 *                   nullable: true
 *             totalUnread:
 *               type: integer
 *             lastMessage:
 *               $ref: '#/components/schemas/ChatMessage'
 *             order:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 orderStatus:
 *                   type: string
 *                   enum: [pending, paid, failed, expired, canceled]
 *                 merchantTradeNo:
 *                   type: string
 *                 totalAmount:
 *                   type: integer
 *                 discountCoin:
 *                   type: integer
 *                 delivery:
 *                   type: object
 *                   properties:
 *                     LogisticsType:
 *                       type: string
 *                       enum: [CVS, home_delivery, virtual]
 *                     LogisticsSubType:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [pending, shipped, delivered, returned, cancelled]
 *                     RtnCode:
 *                       type: string
 *                     RtnMsg:
 *                       type: string
 *
 *     ListChatRoomsResponse:
 *       type: object
 *       properties:
 *         rooms:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdminChatRoomListItem'
 *         total:
 *           type: integer
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         totalPages:
 *           type: integer
 *
 *     PaginatedChatMessages:
 *       type: object
 *       properties:
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChatMessage'
 *         total:
 *           type: integer
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         totalPages:
 *           type: integer
 *
 *   responses:
 *     UnauthorizedError:
 *       description: Access token is missing or invalid.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: Unauthorized
 */

/**
 * @swagger
 * /api/admin/chatroom/list:
 *   get:
 *     summary: List chat rooms
 *     tags: [Chatroom]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *         required: false
 *         description: Optional product ID to filter chat rooms by.
 *       - in: query
 *         name: supportOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         required: false
 *         description: When true, only returns general customer support chat rooms where accountId and productId are both null.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         required: false
 *         description: Optional status to filter chat rooms by.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         required: false
 *         description: Page number for pagination.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         required: false
 *         description: Number of items per page.
 *     responses:
 *       200:
 *         description: A paginated list of chat rooms. When accountId is null, product is also null; the room is for general customer support rather than a specific product, and only admin accounts receive those rooms because they can support customers directly.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListChatRoomsResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  "/list",
  isAuth,
  validateZod({ query: adminValidation.chatroom.listQuery }),
  ChatroomController.listAdminChatRooms,
);

/**
 * @swagger
 * /api/admin/chatroom/history/{chatRoomId}:
 *   get:
 *     summary: Get chat history for a specific room
 *     tags: [Chatroom]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatRoomId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the chat room.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of messages per page.
 *       - in: query
 *         name: startAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional start date (ISO 8601 format) to filter chat messages.
 *       - in: query
 *         name: endAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional end date (ISO 8601 format) to filter chat message.
 *     responses:
 *       200:
 *         description: A paginated list of chat messages.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedChatMessages'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Chat room not found.
 */
router.get(
  "/history/:chatRoomId",
  isAuth,
  validateZod({
    params: adminValidation.chatroom.historyParams,
    query: adminValidation.chatroom.historyQuery,
  }),
  ChatroomController.getChatHistory,
);

/**
 * @swagger
 * /api/admin/chatroom/message/{chatRoomId}:
 *   post:
 *     summary: Send a message as an admin
 *     tags: [Chatroom]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatRoomId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the chat room to send a message to.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - senderType
 *             properties:
 *               senderType:
 *                 type: string
 *                 enum: [admin, seller]
 *               content:
 *                 type: string
 *                 description: The text content of the message. Required if attachments is empty.
 *               attachments:
 *                 type: array
 *                 nullable: true
 *                 description: Array of attachments. Required if content is empty.
 *                 items:
 *                   type: object
 *                   required: [url]
 *                   properties:
 *                     url:
 *                       type: string
 *                       example: "https://pub-your-bucket.r2.dev/images/uuid.jpg"
 *                     mimeType:
 *                       type: string
 *                       example: "image/jpeg"
 *                     name:
 *                       type: string
 *                     size:
 *                       type: number
 *     responses:
 *       '200':
 *         description: Message sent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ChatMessage'
 *       400:
 *         description: Invalid input (e.g., empty message).
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Chat room not found or is not active.
 */
router.post(
  "/message/:chatRoomId",
  isAuth,
  validateZod({
    params: adminValidation.chatroom.messageParams,
    body: adminValidation.chatroom.sendMessageBody,
  }),
  ChatroomController.sendMessage,
);

/**
 * @swagger
 * /api/admin/chatroom/message/{chatRoomId}/read:
 *   put:
 *     summary: Mark messages in a room as read
 *     description: Marks all unread messages sent by the user in a specific chat room as read.
 *     tags: [Chatroom]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatRoomId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the chat room.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - readerType
 *             properties:
 *               readerType:
 *                 type: string
 *                 enum: [admin, seller]
 *     responses:
 *       200:
 *         description: Messages marked as read successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ChatMessage'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Chat room not found or is not active.
 */
router.put(
  "/message/:chatRoomId/read",
  isAuth,
  validateZod({
    params: adminValidation.chatroom.messageParams,
    body: adminValidation.chatroom.readBody,
  }),
  ChatroomController.markMessagesAsRead,
);

export default router;
