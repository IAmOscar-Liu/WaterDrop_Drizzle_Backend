import { Router } from "express";
import { sendMulticastPushNotification } from "../../lib/sendNotification";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

const router = Router();

/**
 * @swagger
 * /api/admin/system/send-notification:
 *   post:
 *     tags: [System]
 *     summary: Send a push notification to multiple devices
 *     description: Sends a multicast push notification via FCM
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
 */
router.post(
  "/send-notification",
  validateZod({ body: adminValidation.system.sendNotificationBody }),
  async (req, res) => {
    await sendMulticastPushNotification(req.body);
    res.json({ success: true, data: "OK" });
  },
);

export default router;
