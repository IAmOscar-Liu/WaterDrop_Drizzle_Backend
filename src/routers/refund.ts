import { Router } from "express";
import RefundController from "../controller/refund";
import isAuth from "../middleware/isAuth";
import { refundValidation } from "../middleware/refund";
import validateZod from "../middleware/validateZod";

const router = Router();

router.post(
  "/",
  isAuth,
  validateZod({ body: refundValidation.createBody }),
  RefundController.createUserRefund,
);

export default router;
