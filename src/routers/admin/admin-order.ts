import { Router } from "express";
import OrderController from "../../controller/order";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

const router = Router();
/**
 * @swagger
 * tags:
 *   name: Order
 *   description: Order management for administrators
 *
 * components:
 *   schemas:
 *     OrderItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         orderId:
 *           type: string
 *           format: uuid
 *         productId:
 *           type: string
 *           format: uuid
 *         productVariantId:
 *           type: string
 *           format: uuid
 *         quantity:
 *           type: integer
 *         pendingQuantity:
 *           type: integer
 *         unitPriceAtSale:
 *           type: number
 *           format: double
 *         productNameAtSale:
 *           type: string
 *         variantAtSale:
 *           type: object
 *           description: Convenience snapshot object for frontend display.
 *           properties:
 *             name:
 *               type: string
 *               nullable: true
 *             sku:
 *               type: string
 *               nullable: true
 *             optionValues:
 *               type: object
 *               nullable: true
 *             price:
 *               type: number
 *               format: double
 *               description: Historical variant price from unitPriceAtSale.
 *         lineTotal:
 *           type: number
 *           format: double
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     Delivery:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         orderId:
 *           type: string
 *           format: uuid
 *         merchantTradeNo:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, shipped, ready_for_pickup, delivered, returned, cancelled, exception, unknown]
 *         AllPayLogisticsID:
 *           type: string
 *           nullable: true
 *         CVSPaymentNo:
 *           type: string
 *           nullable: true
 *         CVSValidationNo:
 *           type: string
 *           nullable: true
 *         LogisticsType:
 *           type: string
 *           enum: [CVS, home_delivery, virtual]
 *         LogisticsSubType:
 *           type: string
 *         RtnCode:
 *           type: string
 *           nullable: true
 *         RtnMsg:
 *           type: string
 *           nullable: true
 *         GoodsAmount:
 *           type: number
 *           format: double
 *         fee:
 *           type: number
 *           format: double
 *         feeDeduction:
 *           type: number
 *           format: double
 *         metadata:
 *           type: object
 *           nullable: true
 *         homeDeliveryData:
 *           type: object
 *           nullable: true
 *           example:
 *             name: "App user"
 *             email: "example@test.com"
 *             phone: "0911222333"
 *             address: "台北市中正路1號"
 *         cvsStoreInfo:
 *           type: object
 *           description: Store information for convenience store deliveries.
 *           example:
 *             storeID: "131386"
 *             storeName: "建盛門市"
 *             storeAddress: "新竹市東區建中一路52號1樓"
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     DeliveryLog:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         deliveryId:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [pending, shipped, ready_for_pickup, delivered, returned, cancelled, exception, unknown]
 *         RtnCode:
 *           type: string
 *           nullable: true
 *         RtnMsg:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     Order:
 *       type: object
 *       required:
 *         - id
 *         - userId
 *         - subTotal
 *         - totalAmount
 *         - orderStatus
 *         - orderPayment
 *         - completeEmailSent
 *         - createdAt
 *         - updatedAt
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
 *         merchantTradeNo:
 *           type: string
 *           nullable: true
 *         subTotal:
 *           type: number
 *           format: double
 *         totalAmount:
 *           type: number
 *           format: double
 *         discountCoin:
 *           type: integer
 *           nullable: true
 *         shippingCost:
 *           type: number
 *           format: double
 *           nullable: true
 *         shippingCostDeduction:
 *           type: number
 *           format: double
 *           nullable: true
 *         transactionFee:
 *           type: number
 *           format: double
 *           nullable: true
 *         transactionFeeRateAtSale:
 *           type: number
 *           format: double
 *           nullable: true
 *         userLevelAtSale:
 *           type: string
 *           nullable: true
 *           example: A1
 *         userMaxDiscountAtSale:
 *           type: integer
 *           nullable: true
 *         orderStatus:
 *           type: string
 *           enum: [pending, payment-processing, paid, failed, expired, canceled]
 *         orderPayment:
 *           type: string
 *           enum: [Credit, ATM]
 *         completeEmailSent:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         shippingInfo:
 *           type: object
 *           nullable: true
 *         paymentInfo:
 *           type: object
 *           nullable: true
 *         metadata:
 *           type: object
 *           nullable: true
 *
 *     AdminOrderListItem:
 *       allOf:
 *         - $ref: '#/components/schemas/Order'
 *         - type: object
 *           properties:
 *             user:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *             items:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   productId:
 *                     type: string
 *                     format: uuid
 *                   productVariantId:
 *                     type: string
 *                     format: uuid
 *                   productNameAtSale:
 *                     type: string
 *                   variantAtSale:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         nullable: true
 *                       sku:
 *                         type: string
 *                         nullable: true
 *                       optionValues:
 *                         type: object
 *                         nullable: true
 *                       price:
 *                         type: number
 *                         format: double
 *                         description: Historical variant price from unitPriceAtSale.
 *             deliveries:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   merchantTradeNo:
 *                     type: string
 *                     nullable: true
 *                   status:
 *                     type: string
 *                     enum: [pending, shipped, ready_for_pickup, delivered, returned, cancelled, exception, unknown]
 *                   LogisticsType:
 *                     type: string
 *                     enum: [CVS, home_delivery, virtual]
 *                   LogisticsSubType:
 *                     type: string
 *                     nullable: true
 *                   RtnCode:
 *                     type: string
 *                     nullable: true
 *                   RtnMsg:
 *                     type: string
 *                     nullable: true
 *
 *     OrderWithRelations:
 *       allOf:
 *         - $ref: '#/components/schemas/Order'
 *         - type: object
 *           properties:
 *             items:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/OrderItem'
 *                   - type: object
 *                     properties:
 *                       refundItems:
 *                         type: array
 *                         description: Refund requests associated with this order item.
 *                         items:
 *                           $ref: '#/components/schemas/RefundItem'
 *                       canRefund:
 *                         type: boolean
 *                         description: Whether this order item still has refundable quantity for the current order and delivery status.
 *                       remainingRefundQuantity:
 *                         type: integer
 *                         description: Remaining refundable quantity for this order item. Returns 0 when the item is not currently refundable.
 *                       product:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           sellerId:
 *                             type: string
 *                             format: uuid
 *                           name:
 *                             type: string
 *                           avatar:
 *                             type: string
 *                           description:
 *                             type: string
 *                           price:
 *                             type: number
 *                           type:
 *                             type: string
 *                             enum: [normal, refrigeration, virtual]
 *                           allowHomeDelivery:
 *                             type: boolean
 *                           images:
 *                             type: array
 *                             items:
 *                               type: string
 *                           status:
 *                             type: string
 *                             enum: [active, inactive]
 *                           metadata:
 *                             type: object
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           updatedAt:
 *                             type: string
 *                             format: date-time
 *             deliveries:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Delivery'
 *                   - type: object
 *                     properties:
 *                       logs:
 *                         type: array
 *                         description: Reverse-chronological delivery status logs.
 *                         items:
 *                           $ref: '#/components/schemas/DeliveryLog'
 *                       items:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                               format: uuid
 *                             productId:
 *                               type: string
 *                               format: uuid
 *                             productVariantId:
 *                               type: string
 *                               format: uuid
 *                             productNameAtSale:
 *                               type: string
 *                             variantAtSale:
 *                               type: object
 *                               properties:
 *                                 name:
 *                                   type: string
 *                                   nullable: true
 *                                 sku:
 *                                   type: string
 *                                   nullable: true
 *                                 optionValues:
 *                                   type: object
 *                                   nullable: true
 *                                 price:
 *                                   type: number
 *                                   format: double
 *                                   description: Historical variant price from unitPriceAtSale.
 *             user:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *
 *     ListOrdersResponse:
 *       type: object
 *       properties:
 *         orders:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdminOrderListItem'
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
 * /api/admin/order/list:
 *   get:
 *     tags: [Order]
 *     summary: List orders with filtering and pagination
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
 *         name: merchantTradeNo
 *         description: Filters by order or delivery merchant trade number prefix when at least 4 characters are provided. Shorter values are ignored.
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, payment-processing, paid, failed, expired, canceled]
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       '200':
 *         description: A paginated list of orders.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListOrdersResponse'
 */
router.get(
  "/list",
  isAuth,
  validateZod({ query: adminValidation.order.listQuery }),
  OrderController.listAdminOrders,
);

/**
 * @swagger
 * /api/admin/order/{id}:
 *   get:
 *     tags: [Order]
 *     summary: Get a single order by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: The requested order.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/OrderWithRelations'
 */
router.get(
  "/:id",
  isAuth,
  validateZod({ params: adminValidation.order.idParams }),
  OrderController.getOrder,
);

export default router;
