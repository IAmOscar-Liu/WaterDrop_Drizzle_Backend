import { Router } from "express";
import OrderController from "../controller/order";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, OrderController.listOrders);

/**
 * @swagger
 * /api/order/{id}:
 *   get:
 *     tags: [Order]
 *     summary: Get the authenticated user's order by ID
 *     description: Returns order detail without the admin-only user relation. Each nested refund item includes reverse-chronological refund logs; existing refunds may have an empty logs array.
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
 *         description: The authenticated user's order detail.
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
router.get("/:id", isAuth, OrderController.getOwnOrder);
router.post("/", isAuth, OrderController.createOrder);
router.put("/:orderId", isAuth, OrderController.updateOrderStatus);
router.post(
  "/send-notification",
  isAuth,
  OrderController.sendOrderCompletedNotification,
);

export default router;
