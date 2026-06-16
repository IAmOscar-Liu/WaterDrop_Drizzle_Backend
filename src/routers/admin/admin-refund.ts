import { Router } from "express";
import RefundController from "../../controller/refund";
import { adminValidation } from "../../middleware/admin";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Refund
 *   description: Refund management for administrators
 *
 * components:
 *   schemas:
 *     RefundSummary:
 *       type: object
 *       properties:
 *         totalCoin:
 *           type: number
 *         coinByMonth:
 *           type: object
 *           additionalProperties:
 *             type: number
 *
 *     RefundItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         orderItemId:
 *           type: string
 *           format: uuid
 *         quantity:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [pending, processing, completed, cancelled]
 *         reason:
 *           type: string
 *         note:
 *           type: string
 *           nullable: true
 *         refundAmount:
 *           type: number
 *           nullable: true
 *         metadata:
 *           type: object
 *           nullable: true
 *         summary:
 *           $ref: '#/components/schemas/RefundSummary'
 *
 *     RefundWithOrderItem:
 *       allOf:
 *         - $ref: '#/components/schemas/RefundItem'
 *         - type: object
 *           properties:
 *             orderItem:
 *               allOf:
 *                 - $ref: '#/components/schemas/OrderItem'
 *                 - type: object
 *                   properties:
 *                     product:
 *                       $ref: '#/components/schemas/Product'
 *                     order:
 *                       allOf:
 *                         - $ref: '#/components/schemas/Order'
 *                         - type: object
 *                           properties:
 *                             user:
 *                               type: object
 *                               properties:
 *                                 name:
 *                                   type: string
 *                                   nullable: true
 *                                 email:
 *                                   type: string
 *                                 bankCode:
 *                                   type: string
 *                                   nullable: true
 *                                 bankName:
 *                                   type: string
 *                                   nullable: true
 *                                 bankAccount:
 *                                   type: string
 *                                   nullable: true
 *
 *
 *     ListRefundsResponse:
 *       type: object
 *       properties:
 *         refunds:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RefundWithOrderItem'
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
 * /api/admin/refund/list:
 *   get:
 *     tags: [Refund]
 *     summary: List refund items
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
 *           default: 10
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: startAt
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endAt
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, completed, cancelled]
 *     responses:
 *       '200':
 *         description: A paginated list of refund items.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListRefundsResponse'
 */
router.get(
  "/list",
  isAuth,
  validateZod({ query: adminValidation.refund.listQuery }),
  RefundController.getRefundList,
);

/**
 * @swagger
 * /api/admin/refund/{refundItemId}:
 *   get:
 *     tags: [Refund]
 *     summary: Get a refund item by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: refundItemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: The refund item.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/RefundWithOrderItem'
 */
router.get(
  "/:refundItemId",
  isAuth,
  validateZod({ params: adminValidation.refund.refundItemIdParams }),
  RefundController.getRefundById,
);

/**
 * @swagger
 * /api/admin/refund:
 *   post:
 *     tags: [Refund]
 *     summary: Create a refund item
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderItemId, quantity]
 *             properties:
 *               orderItemId:
 *                 type: string
 *                 format: uuid
 *               quantity:
 *                 type: integer
 *               reason:
 *                 type: string
 *                 description: Optional refund reason.
 *               note:
 *                 type: string
 *                 nullable: true
 *               refundAmount:
 *                 type: number
 *                 description: Defaults to the order item's unitPriceAtSale when omitted.
 *               metadata:
 *                 type: object
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: The created refund item.
 */
router.post(
  "/",
  isAuth,
  validateZod({ body: adminValidation.refund.createBody }),
  RefundController.createRefund,
);

/**
 * @swagger
 * /api/admin/refund/{refundItemId}/status:
 *   patch:
 *     tags: [Refund]
 *     summary: Update refund item
 *     description: Status, reason, and note are mutable. Once completed, the status cannot be changed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: refundItemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Provide at least one of status, reason, or note.
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, processing, completed, cancelled]
 *               reason:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: The updated refund item.
 */
router.patch(
  "/:refundItemId/status",
  isAuth,
  validateZod({
    params: adminValidation.refund.refundItemIdParams,
    body: adminValidation.refund.updateStatusBody,
  }),
  RefundController.updateRefundItemStatus,
);

export default router;
