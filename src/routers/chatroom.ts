import { Router } from "express";
import ChatroomController from "../controller/chatroom";
import isAuth from "../middleware/isAuth";
import { chatroomValidation } from "../middleware/chatroom";
import validateZod from "../middleware/validateZod";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Chatroom
 *   description: User chatroom APIs
 *
 * components:
 *   schemas:
 *     ChatRoom:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         accountId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         productId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         productVariantId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: Required for product-specific chat rooms. Null for general support rooms.
 *         orderId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [active, inactive]
 *         product:
 *           allOf:
 *             - $ref: '#/components/schemas/Product'
 *             - type: object
 *               properties:
 *                 variantName:
 *                   type: string
 *                   nullable: true
 *                   description: Display name for the selected variant, derived from variant.name or option values.
 *           nullable: true
 *         variant:
 *           $ref: '#/components/schemas/ProductVariant'
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     ChatMessage:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         chatRoomId:
 *           type: string
 *           format: uuid
 *         senderType:
 *           type: string
 *           enum: [user, admin, seller]
 *         content:
 *           type: string
 *           nullable: true
 *         isRead:
 *           type: boolean
 *         attachments:
 *           type: array
 *           items:
 *             type: object
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     ListUserChatRoomsResponse:
 *       type: object
 *       properties:
 *         rooms:
 *           type: array
 *           items:
 *             allOf:
 *               - $ref: '#/components/schemas/ChatRoom'
 *               - type: object
 *                 properties:
 *                   totalUnread:
 *                     type: integer
 *                   lastMessage:
 *                     $ref: '#/components/schemas/ChatMessage'
 *                     nullable: true
 *                   order:
 *                     type: object
 *                     nullable: true
 *         total:
 *           type: integer
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         totalPages:
 *           type: integer
 */

/**
 * @swagger
 * /api/chatroom/list:
 *   get:
 *     tags: [Chatroom]
 *     summary: List current user's active chat rooms
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       '200':
 *         description: A paginated list of active chat rooms with messages.
 */
router.get(
  "/list",
  isAuth,
  validateZod({ query: chatroomValidation.listQuery }),
  ChatroomController.listChatRooms,
);

/**
 * @swagger
 * /api/chatroom/create:
 *   post:
 *     tags: [Chatroom]
 *     summary: Find or create a chat room
 *     description: Product-specific rooms require productId and productVariantId. General support rooms omit both.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accountId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               productId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               productVariantId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               orderId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: Existing or newly created chat room.
 */
router.post(
  "/create",
  isAuth,
  validateZod({ body: chatroomValidation.createBody }),
  ChatroomController.findOrCreateChatRoom,
);

router.get(
  "/:chatRoomId",
  isAuth,
  validateZod({ params: chatroomValidation.chatRoomIdParams }),
  ChatroomController.getChatRoomById,
);
router.get(
  "/history/:chatRoomId",
  isAuth,
  validateZod({
    params: chatroomValidation.chatRoomIdParams,
    query: chatroomValidation.historyQuery,
  }),
  ChatroomController.getChatHistory,
);
router.post(
  "/message/:chatRoomId",
  isAuth,
  validateZod({
    params: chatroomValidation.chatRoomIdParams,
    body: chatroomValidation.sendMessageBody,
  }),
  ChatroomController.sendMessage,
);
router.put(
  "/message/:chatRoomId/read",
  isAuth,
  validateZod({
    params: chatroomValidation.chatRoomIdParams,
    body: chatroomValidation.readBody,
  }),
  ChatroomController.markMessagesAsRead,
);

export default router;
