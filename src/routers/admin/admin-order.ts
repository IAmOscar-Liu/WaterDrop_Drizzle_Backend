import { Router } from "express";
import OrderController from "../../controller/order";
import isAuth from "../../middleware/isAuth";

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
 *         quantity:
 *           type: integer
 *         unitPriceAtSale:
 *           type: number
 *           format: double
 *         productNameAtSale:
 *           type: string
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
 *         ReceiverStoreId:
 *           type: string
 *           nullable: true
 *         metadata:
 *           type: object
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     Order:
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
 *         merchantTradeNo:
 *           type: string
 *           nullable: true
 *         totalAmount:
 *           type: number
 *           format: double
 *         discountCoin:
 *           type: integer
 *           nullable: true
 *         orderStatus:
 *           type: string
 *           enum: [pending, paid, failed]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
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
 *                   productNameAtSale:
 *                     type: string
 *             deliveries:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
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
 *                           sku:
 *                             type: string
 *                           stock:
 *                             type: integer
 *                           reserve:
 *                             type: integer
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
 *                             productNameAtSale:
 *                               type: string
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, paid, failed]
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
router.get("/list", isAuth, OrderController.listAdminOrders);

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
router.get("/:id", isAuth, OrderController.getOrder);

export default router;
