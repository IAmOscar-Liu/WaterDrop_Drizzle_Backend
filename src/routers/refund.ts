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
 *     description: A successful request automatically creates an initial pending refund log with message 申請退貨, then sends a fire-and-forget push notification and email linked to the order detail page.
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
 *       '400':
 *         description: Invalid quantity, refund amount, order, delivery, or ownership state.
 */
router.post(
  "/",
  isAuth,
  validateZod({ body: refundValidation.createBody }),
  RefundController.createUserRefund,
);

export default router;
