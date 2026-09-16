import { Router } from "express";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";
import isAuth from "../../middleware/isAuth";
import isAdmin from "../../middleware/isAdmin";
import SystemController from "../../controller/system";

const router = Router();

/**
 * @swagger
 * /api/admin/system/send-notification:
 *   post:
 *     tags: [System]
 *     summary: Send a push notification to multiple devices
 *     description: Platform-admin-only low-level endpoint that sends directly to supplied FCM tokens.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tokens]
 *             properties:
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: An array of FCM registration tokens for the target devices (max 500).
 *                 example: ["token1...", "token2..."]
 *               notification:
 *                 $ref: '#/components/schemas/Notification'
 *               data:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *                 description: Arbitrary key-value data to be sent with the message.
 *                 example:
 *                   command: "explore"
 *     responses:
 *       '200':
 *         description: Notification request was successfully processed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: string
 *                   example: "OK"
 *       '403':
 *         description: Only a platform admin account may call this endpoint.
 */
router.post(
  "/send-notification",
  isAuth,
  isAdmin,
  validateZod({ body: adminValidation.system.sendNotificationBody }),
  SystemController.sendNotification,
);

/**
 * @swagger
 * /api/admin/system/send-app-notification:
 *   post:
 *     tags: [System]
 *     summary: Send a push notification to selected app users or groups
 *     description: Platform-admin-only endpoint. Targets app users, not seller/admin accounts. A group targets both its owner and its members. Sending to all users is intentionally unsupported.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userIds:
 *                 type: array
 *                 maxItems: 500
 *                 items:
 *                   type: string
 *                   format: uuid
 *               groupIds:
 *                 type: array
 *                 maxItems: 100
 *                 items:
 *                   type: string
 *                   format: uuid
 *               notification:
 *                 $ref: '#/components/schemas/Notification'
 *               data:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *             description: At least one userIds/groupIds target and either notification/data are required.
 *           example:
 *             userIds: ["94abf729-f0af-4b57-961d-672294fa03a0"]
 *             groupIds: ["7d30c921-e0e4-4982-b138-9c5cc1204a55"]
 *             notification:
 *               title: "系統通知"
 *               body: "通知內容"
 *             data:
 *               command: "explore"
 *     responses:
 *       '200':
 *         description: Target resolution and FCM dispatch completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     targetedUserCount:
 *                       type: integer
 *                     tokenCount:
 *                       type: integer
 *                     batchCount:
 *                       type: integer
 *       '400':
 *         description: No supported target or message content was supplied.
 *       '403':
 *         description: Only a platform admin account may call this endpoint.
 */
router.post(
  "/send-app-notification",
  isAuth,
  isAdmin,
  validateZod({ body: adminValidation.system.sendAppNotificationBody }),
  SystemController.sendAppNotification,
);

export default router;
