import { Router } from "express";
import OrderController from "../controller/order";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, OrderController.listOrders);
router.get("/:id", isAuth, OrderController.getOrder);
router.post("/", isAuth, OrderController.createOrder);
router.put("/:orderId", isAuth, OrderController.updateOrderStatus);

export default router;
