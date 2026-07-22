import { Router } from "express";
import SystemController from "../controller/system";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/info", isAuth, SystemController.getInfo);

router.get(
  "/product-recommendation",
  isAuth,
  SystemController.getProductRecommendation,
);

router.get(
  "/customer-support",
  isAuth,
  SystemController.getCustomerSupportContent,
);

router.get("/bank-list", isAuth, SystemController.getBankList);

export default router;
