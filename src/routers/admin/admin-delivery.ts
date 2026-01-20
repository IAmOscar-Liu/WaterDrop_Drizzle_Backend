import { Router } from "express";
import DeliveryController from "../../controller/delivery";
import isAuth from "../../middleware/isAuth";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Delivery
 *   description: Delivery management for administrators
 *
 * components:
 *   schemas:
 *     DeliveryWithOrderAndItems:
 *       allOf:
 *         - $ref: '#/components/schemas/Delivery'
 *         - type: object
 *           properties:
 *             order:
 *               $ref: '#/components/schemas/Order'
 *             items:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/OrderItem'
 *                   - type: object
 *                     properties:
 *                       product:
 *                         $ref: '#/components/schemas/Product'
 *
 *     DeliveryWithItems:
 *       allOf:
 *         - $ref: '#/components/schemas/Delivery'
 *         - type: object
 *           properties:
 *             items:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OrderItem'
 *
 *     ListDeliveriesResponse:
 *       type: object
 *       properties:
 *         deliveries:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DeliveryWithItems'
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
 * /api/admin/delivery/list:
 *   get:
 *     tags: [Delivery]
 *     summary: List deliveries
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, shipped, delivered, returned, cancelled]
 *         required: false
 *         description: Optional status to filter deliveries by.
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
 *         description: A paginated list of deliveries.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListDeliveriesResponse'
 */
router.get("/list", isAuth, DeliveryController.listAdminDeliveries);

/**
 * @swagger
 * /api/admin/delivery/{deliveryId}:
 *   get:
 *     tags: [Delivery]
 *     summary: Get a delivery by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: The delivery record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DeliveryWithOrderAndItems'
 */
router.get("/:deliveryId", isAuth, DeliveryController.getDelivery);

/**
 * @swagger
 * /api/admin/delivery/{deliveryId}:
 *   put:
 *     tags: [Delivery]
 *     summary: Update an order's delivery information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, shipped, delivered, returned, cancelled]
 *               AllPayLogisticsID:
 *                 type: string
 *                 nullable: true
 *               CVSPaymentNo:
 *                 type: string
 *                 nullable: true
 *               CVSValidationNo:
 *                 type: string
 *                 nullable: true
 *               LogisticsType:
 *                 type: string
 *               LogisticsSubType:
 *                 type: string
 *                 nullable: true
 *               RtnCode:
 *                 type: string
 *                 description: The return code from the logistics provider.
 *               RtnMsg:
 *                 type: string
 *                 description: The return message from the logistics provider.
 *               metadata:
 *                 type: object
 *                 description: Additional metadata from the logistics provider.
 *               homeDeliveryData:
 *                 type: object
 *                 description: Delivery information for the app user.
 *     responses:
 *       '200':
 *         description: The updated delivery record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DeliveryWithOrderAndItems'
 */
router.put("/:deliveryId", isAuth, DeliveryController.updateDelivery);

export default router;
