import { Router } from "express";
import DeliveryController from "../../controller/delivery";
import EcPayController from "../../controller/ecpay";
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
 *
 *     ShippingFee:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         accountId:
 *           type: string
 *           format: uuid
 *         homeDelivery:
 *           type: number
 *           format: double
 *         homeDeliveryRefrig:
 *           type: number
 *           format: double
 *         OKMART_LOW_TMP_C2C:
 *           type: number
 *           format: double
 *         FAMIC2C:
 *           type: number
 *           format: double
 *         UNIMARTC2C:
 *           type: number
 *           format: double
 *         HILIFEC2C:
 *           type: number
 *           format: double
 *         OKMARTC2C:
 *           type: number
 *           format: double
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
 * /api/admin/delivery/merchant-trade-no/{merchantTradeNo}:
 *   get:
 *     tags: [Delivery]
 *     summary: Get deliveries by merchant trade number
 *     description: Search by merchant trade number prefix. Requires at least 4 characters. Matches from the beginning and returns a list.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: merchantTradeNo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The requested deliveries.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DeliveryWithOrderAndItems'
 */
router.get(
  "/merchant-trade-no/:merchantTradeNo",
  isAuth,
  DeliveryController.getDeliveriesByMerchantTradeNo,
);

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
 *                 enum: [CVS, home_delivery, virtual]
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
 *                 example:
 *                   name: "App user"
 *                   email: "example@test.com"
 *                   phone: "0911222333"
 *                   address: "台北市中正路1號"
 *               cvsStoreInfo:
 *                 type: object
 *                 description: Store information for convenience store deliveries.
 *                 example:
 *                   storeID: "131386"
 *                   storeName: "建盛門市"
 *                   storeAddress: "新竹市東區建中一路52號1樓"
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

/**
 * @swagger
 * /api/admin/delivery/helper/printTradeDocument:
 *   get:
 *     tags: [Delivery]
 *     summary: Generate ECPay trade document HTML
 *     description: Returns an HTML form that auto-submits to ECPay to print the trade document. Requires a valid JWT token in the query parameters.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Valid JWT access token.
 *       - in: query
 *         name: LogisticsSubType
 *         required: true
 *         schema:
 *           type: string
 *         description: The logistics subtype (e.g. UNIMART, FAMI, UNIMARTC2C, FAMIC2C, OKMARTC2C).
 *       - in: query
 *         name: AllPayLogisticsID
 *         required: true
 *         schema:
 *           type: string
 *         description: The logistics ID returned by ECPay.
 *       - in: query
 *         name: CVSPaymentNo
 *         schema:
 *           type: string
 *         description: Required for C2C types (FAMIC2C, OKMARTC2C, UNIMARTC2C).
 *       - in: query
 *         name: CVSValidationNo
 *         schema:
 *           type: string
 *         description: Required for UNIMARTC2C.
 *     responses:
 *       '200':
 *         description: HTML form for printing the document.
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
router.get("/helper/printTradeDocument", EcPayController.printTradeDocument);

/**
 * @swagger
 * /api/admin/delivery/helper/fee:
 *   get:
 *     tags: [Delivery]
 *     summary: Get shipping fees
 *     description: Retrieve shipping fees for the authenticated account.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: The shipping fee settings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ShippingFee'
 */
router.get("/helper/fee", isAuth, DeliveryController.getShippingFee);

/**
 * @swagger
 * /api/admin/delivery/helper/fee:
 *   post:
 *     tags: [Delivery]
 *     summary: Upsert shipping fees
 *     description: Create or update shipping fees for the authenticated account.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               homeDelivery:
 *                 type: number
 *                 maximum: 60
 *               homeDeliveryRefrig:
 *                 type: number
 *                 maximum: 160
 *               OKMART_LOW_TMP_C2C:
 *                 type: number
 *                 maximum: 160
 *               UNIMARTC2C:
 *                 type: number
 *                 maximum: 69
 *               FAMIC2C:
 *                 type: number
 *                 maximum: 69
 *               HILIFEC2C:
 *                 type: number
 *                 maximum: 58
 *               OKMARTC2C:
 *                 type: number
 *                 maximum: 58
 *     responses:
 *       '200':
 *         description: The updated shipping fee settings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ShippingFee'
 */
router.post("/helper/fee", isAuth, DeliveryController.upsertShippingFee);

export default router;
