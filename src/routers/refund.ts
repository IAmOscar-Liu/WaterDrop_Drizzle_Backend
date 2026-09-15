import { Router } from "express";
import RefundController from "../controller/refund";
import isAuth from "../middleware/isAuth";
import { refundValidation } from "../middleware/refund";
import validateZod from "../middleware/validateZod";

const router = Router();

/**
 * @swagger
 * /api/refund:
 *   post:
 *     tags: [Refund]
 *     summary: Create a refund request for the authenticated user
 *     description: A successful request automatically creates an initial pending refund log with message 申請退貨, then sends a fire-and-forget push notification and email linked to the order detail page. The response includes cashRefundAmount, the whole-TWD cash payout, and cashRemainderCoins, the fractional TWD remainder converted at NT$1 = 10 coins. Conversion coins are credited only after the refund is completed.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderItemId, accountId, quantity]
 *             properties:
 *               orderItemId:
 *                 type: string
 *                 format: uuid
 *               accountId:
 *                 type: string
 *                 format: uuid
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 description: Partial refund quantity. Non-cancelled refunds cannot exceed the purchased quantity in total.
 *               reason:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *               refundAmount:
 *                 type: number
 *                 description: Optional unit refund amount. Rounded to two decimal places, must be greater than 0, and cannot exceed unitPriceAtSale; defaults to unitPriceAtSale.
 *               extraRefundAmount:
 *                 type: number
 *                 minimum: 0
 *                 description: Rounded to two decimal places.
 *               metadata:
 *                 type: object
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: The created refund item. Its initial log is available through order detail.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/RefundItem'
 *             example:
 *               success: true
 *               data:
 *                 id: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
 *                 orderItemId: cccccccc-cccc-4ccc-8ccc-cccccccccccc
 *                 quantity: 1
 *                 status: pending
 *                 reason: Partial refund
 *                 note: null
 *                 refundAmount: 71.33
 *                 paidRefundAmount: 57.06
 *                 extraRefundAmount: 0
 *                 cashRefundAmount: 57
 *                 cashRemainderCoins: 0.6
 *                 coins: 142.66
 *                 returnableCoins: null
 *                 metadata: null
 *                 summary: null
 *                 createdAt: "2026-09-13T04:51:21.827Z"
 *                 updatedAt: "2026-09-13T04:51:21.827Z"
 *       '400':
 *         description: Invalid quantity, refund amount, order, delivery, or ownership state.
 *       '404':
 *         description: Order item, order, or product not found.
 */
router.post(
  "/",
  isAuth,
  validateZod({ body: refundValidation.createBody }),
  RefundController.createUserRefund,
);

export default router;
