import { Router } from "express";
import DeliveryController from "../controller/delivery";
import isAuth from "../middleware/isAuth";

const router = Router();

router.post("/create", isAuth, DeliveryController.createDelivery);
router.get(
  "/shipping-fee-and-tax-rate",
  DeliveryController.getShippingFeeAndTaxRate,
);
router.post(
  "/shipping-fee",
  isAuth,
  DeliveryController.getShippingFeeByAccountIds,
);

export default router;
