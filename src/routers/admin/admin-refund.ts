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
 *       example: {}
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
 *         paidRefundAmount:
 *           type: number
 *           nullable: true
 *           description: Product refund amount after coin deduction.
 *         extraRefundAmount:
 *           type: number
 *           description: Additional refund amount for shipping, fees, or manual adjustments.
 *         coins:
 *           type: number
 *           description: Proportional discount coins associated with this refund item.
 *         returnableCoins:
 *           type: number
 *           nullable: true
 *           description: Portion of refund coins that can be returned to the user.
 *         metadata:
 *           type: object
 *           nullable: true
 *         summary:
 *           type: object
 *           nullable: true
 *           example: {}
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
 *                     variantAtSale:
 *                       type: object
 *                       nullable: true
 *                       description: Convenience snapshot object for frontend display.
 *                       properties:
 *                         name:
 *                           type: string
 *                           nullable: true
 *                         sku:
 *                           type: string
 *                           nullable: true
 *                         optionValues:
 *                           type: object
 *                           nullable: true
 *                     product:
 *                       allOf:
 *                         - $ref: '#/components/schemas/Product'
 *                         - type: object
 *                           properties:
 *                             variant:
 *                               $ref: '#/components/schemas/ProductVariant'
 *                               nullable: true
 *                               description: Live variant row linked by the refunded order item. Use variant snapshot fields on orderItem for historical display.
 *                     delivery:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         merchantTradeNo:
 *                           type: string
 *                           nullable: true
 *                         status:
 *                           type: string
 *                           enum: [pending, shipped, ready_for_pickup, delivered, returned, cancelled, exception, unknown]
 *                         LogisticsType:
 *                           type: string
 *                           enum: [CVS, home_delivery, virtual]
 *                         LogisticsSubType:
 *                           type: string
 *                           nullable: true
 *                         RtnCode:
 *                           type: string
 *                           nullable: true
 *                         RtnMsg:
 *                           type: string
 *                           nullable: true
 *                     order:
 *                       allOf:
 *                         - $ref: '#/components/schemas/Order'
 *                         - type: object
 *                           properties:
 *                             user:
 *                               type: object
 *                               properties:
 *                                 id:
 *                                   type: string
 *                                   format: uuid
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
 *         name: merchantTradeNo
 *         description: Filters by order or delivery merchant trade number prefix when at least 4 characters are provided. Shorter values are ignored.
 *         schema:
 *           type: string
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
 *               extraRefundAmount:
 *                 type: number
 *                 description: Additional refund amount for shipping, fees, or manual adjustments. Defaults to 0.
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
 *     description: Status, quantity, refundAmount, reason, note, extraRefundAmount, and metadata are mutable. Quantity and refundAmount can only be changed while the current refund status is pending or processing. Once completed, the status cannot be changed.
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
 *             description: Provide at least one of status, quantity, refundAmount, reason, note, extraRefundAmount, or metadata.
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, processing, completed, cancelled]
 *                 description: When status changes to completed, backend restocks the linked orderItem.productVariantId.
 *               quantity:
 *                 type: integer
 *                 description: Refund quantity. Must not exceed the remaining refundable quantity for the order item.
 *               refundAmount:
 *                 type: number
 *                 description: Unit refund amount. Must not exceed the order item's unitPriceAtSale.
 *               reason:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *               extraRefundAmount:
 *                 type: number
 *                 description: Additional refund amount for shipping, fees, or manual adjustments.
 *               metadata:
 *                 type: object
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
