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
 *     responses:
 *       '200':
 *         description: The created refund item. Its initial log is available through order detail.
 */
router.post(
  "/",
  isAuth,
  validateZod({ body: refundValidation.createBody }),
  RefundController.createUserRefund,
);

export default router;
