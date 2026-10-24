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
 *   description: Refund review for active admins and owning sellers. Only app buyers create requests; POST /api/admin/refund is retired.
 *
 * components:
 *   schemas:
 *     RefundSummary:
 *       type: object
 *       example:
 *         totalCoin: 142.66
 *         returnableCoin: 143.26
 *         originalReturnableCoin: 142.66
 *         cashRemainderCoin: 0.6
 *         cashRemainderExpiresAt: "2026-10-31T16:00:00.000Z"
 *         cashRemainderSourceSellerId: 33333333-3333-4333-8333-333333333333
 *         coinByMonth:
 *           2026-09:
 *             coin: 142.66
 *             expired: false
 *             returnedCoin: 142.66
 *       properties:
 *         totalCoin:
 *           type: number
 *           description: Original order coins reversed by the refund.
 *         returnableCoin:
 *           type: number
 *           description: Total coins credited to the user, including cash-remainder conversion coins.
 *         originalReturnableCoin:
 *           type: number
 *         cashRemainderCoin:
 *           type: number
 *         cashRemainderExpiresAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         cashRemainderSourceSellerId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         coinByMonth:
 *           type: object
 *           additionalProperties:
 *             type: object
 *             properties:
 *               coin:
 *                 type: number
 *               expired:
 *                 type: boolean
 *               returnedCoin:
 *                 type: number
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
 *           enum: [pending, processing, completed, cancelled, rejected]
 *         reason:
 *           type: string
 *         note:
 *           type: string
 *           nullable: true
 *         clientRequestId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: Optional buyer retry key, scoped to the order item.
 *         originalRequest:
 *           type: object
 *           nullable: true
 *           description: Immutable initial request; null on legacy rows. Amounts are server-calculated.
 *           properties:
 *             quantity:
 *               type: integer
 *             refundAmount:
 *               type: number
 *               description: Original unit refund amount.
 *             paidRefundAmount:
 *               type: number
 *             coins:
 *               type: number
 *             reason:
 *               type: string
 *             note:
 *               type: string
 *               nullable: true
 *         rejectedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         rejectedBy:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         rejectionReason:
 *           type: string
 *           nullable: true
 *         rejectionDeadlineBefore:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         rejectionDeadlineAfter:
 *           type: string
 *           format: date-time
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
 *         cashRefundAmount:
 *           type: integer
 *           nullable: true
 *           description: Whole-TWD cash payout after combining paidRefundAmount and extraRefundAmount and rounding down.
 *         cashRemainderCoins:
 *           type: number
 *           description: Fractional TWD remainder converted at NT$1 = 10 coins.
 *         coins:
 *           type: number
 *           description: Proportional discount coins associated with this refund item.
 *         returnableCoins:
 *           type: number
 *           nullable: true
 *           description: Total coins actually credited on completion, including cash-remainder conversion coins.
 *         metadata:
 *           type: object
 *           nullable: true
 *         summary:
 *           allOf:
 *             - $ref: '#/components/schemas/RefundSummary'
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     RefundLog:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         refundItemId:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [pending, processing, completed, cancelled, rejected]
 *         message:
 *           type: string
 *           nullable: true
 *         actorAccountId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         audit:
 *           type: object
 *           nullable: true
 *           description: Server-recorded before/after values, optional agreement attestation and rejection timing. Legacy logs may be null.
 *           properties:
 *             before:
 *               type: object
 *             after:
 *               type: object
 *             agreement:
 *               type: object
 *               properties:
 *                 confirmed:
 *                   type: boolean
 *                 note:
 *                   type: string
 *             rejectedAt:
 *               type: string
 *               format: date-time
 *             rejectedBy:
 *               type: string
 *               format: uuid
 *             rejectionReason:
 *               type: string
 *             rejectionDeadlineBefore:
 *               type: string
 *               format: date-time
 *             rejectionDeadlineAfter:
 *               type: string
 *               format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
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
 *                         price:
 *                           type: number
 *                           format: double
 *                           description: Historical variant price from unitPriceAtSale.
 *                     variantImage:
 *                       type: string
 *                       nullable: true
 *                       description: Current first image of the live variant; not a historical snapshot.
 *                     product:
 *                       $ref: '#/components/schemas/Product'
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
 *     RefundDetail:
 *       allOf:
 *         - $ref: '#/components/schemas/RefundWithOrderItem'
 *         - type: object
 *           properties:
 *             logs:
 *               type: array
 *               description: Reverse-chronological refund status and message logs. Existing refunds may have an empty array.
 *               items:
 *                 $ref: '#/components/schemas/RefundLog'
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
 *     description: Platform admins see all matching refunds. Sellers see their own products; employees have read-only access within their parent seller scope.
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
 *           enum: [pending, processing, completed, cancelled, rejected]
 *     responses:
 *       '401':
 *         description: Missing or invalid bearer token.
 *       '403':
 *         description: Account is inactive or deleted, seller scope is unavailable, or an employee attempted a write.
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
 *     description: Platform admins can read all refunds. Sellers and seller employees can read only refunds for their seller products. Missing or out-of-scope refunds return 404.
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
 *       '401':
 *         description: Missing or invalid bearer token.
 *       '403':
 *         description: Account is inactive or deleted, seller scope is unavailable, or an employee attempted a write.
 *       '404':
 *         description: Refund item does not exist or belongs to another seller.
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
 *                   $ref: '#/components/schemas/RefundDetail'
 */
router.get(
  "/:refundItemId",
  isAuth,
  validateZod({ params: adminValidation.refund.refundItemIdParams }),
  RefundController.getRefundById,
);

/**
 * @swagger
 * /api/admin/refund/{refundItemId}/status:
 *   patch:
 *     tags: [Refund]
 *     summary: Update refund item
 *     description: Only active platform admins and owning sellers may review existing requests; employees are read-only. All checks also apply to retries. Requests accepted within the item deadline remain reviewable after expiry. Completed, cancelled and rejected requests are immutable; matching terminal retries return 200 without repeating effects, conflicting writes return 409. Explicit rejection requires rejectionReason and atomically extends the item deadline to max(current deadline, rejection time + 120 hours, or 12 hours in local/development), releases its quantity and records the actor/audit. Rejection cannot be combined with financial edits. Quantity or base amount changes require a buyer-agreement attestation; a quantity increase also requires an open effective request window in every environment. Local/development use 24-hour new pickup windows or payment confirmation plus 24 hours when no receipt window exists; historical stored deadlines are preserved; rejection extensions persist in the decision deadline-before/after fields without fabricating receipt timestamps. If no receipt or payment time is known, local/development rejection returns 409 PAYMENT_TIME_UNKNOWN. Agreed partial completion consumes only the final quantity and does not extend time for the rest. Extra compensation is admin/seller-controlled. All actual field edits are logged. Status changes enqueue existing notification workflows; this endpoint does not execute an ECPay cash refund. Existing coin and inventory completion effects remain unchanged. See ADMIN_REFUND_STRATEGY_API_CHANGES.md for rollout and receipt coverage.
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
 *             additionalProperties: false
 *             description: Provide at least one editable field. Unknown fields are rejected. Do not send server-owned timestamps, actors, originalRequest or audit.
 *             properties:
 *               rejectionReason:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 description: Required only with rejected status. Decision time starts the 120-hour extension (12 hours in local/development), independent of notification delivery. The effective deadline is never shortened by rejection.
 *               agreement:
 *                 type: object
 *                 additionalProperties: false
 *                 required: [confirmed, note]
 *                 description: Required for actual quantity or base refundAmount changes. Seller/admin attests that the buyer agreed in chat; this is not a buyer signature.
 *                 properties:
 *                   confirmed:
 *                     type: boolean
 *                     enum: [true]
 *                   note:
 *                     type: string
 *                     minLength: 1
 *                     maxLength: 2000
 *               status:
 *                 type: string
 *                 enum: [pending, processing, completed, cancelled, rejected]
 *                 description: When status changes to completed, backend restocks the linked orderItem.productVariantId.
 *               quantity:
 *                 type: integer
 *                 description: Refund quantity. Must not exceed the remaining refundable quantity for the order item.
 *               refundAmount:
 *                 type: number
 *                 description: Unit refund amount. Rounded to two decimal places, must be greater than 0, and must not exceed the order item's unitPriceAtSale.
 *               reason:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *                 description: Mutable note stored on the refund item; independent from refund log messages.
 *               message:
 *                 type: string
 *                 description: Optional non-empty refund log message. A new log is inserted when this differs from the latest log message.
 *               extraRefundAmount:
 *                 type: number
 *                 description: Additional refund amount for shipping, fees, or manual adjustments. Rounded to two decimal places.
 *               metadata:
 *                 type: object
 *                 nullable: true
 *     responses:
 *       '401':
 *         description: Missing or invalid bearer token.
 *       '403':
 *         description: Account is inactive or deleted, seller scope is unavailable, or an employee attempted a write.
 *       '200':
 *         description: The updated refund item.
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
 *                 status: completed
 *                 reason: Partial refund
 *                 note: null
 *                 refundAmount: 71.33
 *                 paidRefundAmount: 57.06
 *                 extraRefundAmount: 0
 *                 cashRefundAmount: 57
 *                 cashRemainderCoins: 0.6
 *                 coins: 142.66
 *                 returnableCoins: 143.26
 *                 metadata: null
 *                 summary:
 *                   totalCoin: 142.66
 *                   returnableCoin: 143.26
 *                   originalReturnableCoin: 142.66
 *                   cashRemainderCoin: 0.6
 *                   cashRemainderExpiresAt: "2026-10-31T16:00:00.000Z"
 *                   cashRemainderSourceSellerId: 33333333-3333-4333-8333-333333333333
 *                   coinByMonth:
 *                     2026-09:
 *                       coin: 142.66
 *                       expired: false
 *                       returnedCoin: 142.66
 *                 createdAt: "2026-09-13T04:51:21.827Z"
 *                 updatedAt: "2026-09-13T04:55:55.875Z"
 *       '400':
 *         description: Invalid transition, quantity, or refund amount.
 *       '404':
 *         description: Refund item, order item, order, product, or user not found, or the refund belongs to another seller.
 *       '409':
 *         description: REFUND_TERMINAL, REFUND_AGREEMENT_REQUIRED, REFUND_WINDOW_EXPIRED, RECEIPT_TIME_UNKNOWN, or PAYMENT_TIME_UNKNOWN. Error JSON includes code; refresh detail before retrying.
 *       '503':
 *         description: Coin ledger is required to complete a fractional-cash refund.
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
