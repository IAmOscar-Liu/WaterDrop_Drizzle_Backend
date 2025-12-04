import { Router } from "express";
import ChatroomController from "../../controller/chatroom";
import isAuth from "../../middleware/isAuth";

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
 *         userId:
 *           type: string
 *           format: uuid
 *         accountId:
 *           type: string
 *           format: uuid
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
 *               $ref: '#/components/schemas/User'
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
 *         description: A paginated list of chat rooms.
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
router.get("/list", isAuth, ChatroomController.listAdminChatRooms);

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
router.get("/history/:chatRoomId", isAuth, ChatroomController.getChatHistory);

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
 *               - content
 *             properties:
 *               senderType:
 *                 type: string
 *                 enum: [admin, seller]
 *               content:
 *                 type: string
 *                 description: The text content of the message.
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
router.post("/message/:chatRoomId", isAuth, ChatroomController.sendMessage);

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
 *               - senderType
 *             properties:
 *               senderType:
 *                 type: string
 *                 enum: [user, admin, seller]
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
  ChatroomController.markMessagesAsRead
);

export default router;
