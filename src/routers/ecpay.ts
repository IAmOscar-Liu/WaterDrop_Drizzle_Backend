import { Router } from "express";
import EcPayController from "../controller/ecpay";

const router = Router();

router.get("/test", EcPayController.createTestPayment);
router.get("/new", EcPayController.createPayment);
router.post("/return", EcPayController.handleReturn);
router.get("/clientReturn", EcPayController.handleClientReturn);

export default router;
