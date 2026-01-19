import { Router } from "express";
import DeliveryController from "../controller/delivery";
import isAuth from "../middleware/isAuth";

const router = Router();

router.post("/create", isAuth, DeliveryController.createDelivery);

export default router;
