import { Router } from "express";
import RefundController from "../controller/refund";
import isAuth from "../middleware/isAuth";
import { refundValidation } from "../middleware/refund";
import validateZod from "../middleware/validateZod";

const router = Router();

// App contract: docs/api/FLUTTER_REFUND_STRATEGY_API_CHANGES.md
router.post(
  "/",
  isAuth,
  validateZod({ body: refundValidation.createBody }),
  RefundController.createUserRefund,
);

export default router;
