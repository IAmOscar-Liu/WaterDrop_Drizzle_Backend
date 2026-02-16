import { Router } from "express";
import EcPayController from "../controller/ecpay";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/test", EcPayController.createTestPayment);
router.get("/new", EcPayController.createPayment);
router.post("/return", EcPayController.handleReturn);
router.get("/clientReturn", EcPayController.handleClientReturn);

router.get("/logistics/map", EcPayController.getLogisticsMap);
router.post(
  "/logistics/map-callback",
  EcPayController.handleLogisticsMapCallback,
);

router.post("/express/validate", EcPayController.validateLogisticsParams);

router.get("/express/test/create", EcPayController.createTestExpress);
router.post(
  "/express/test/server-reply",
  EcPayController.handleTestExpressServerReply,
);
router.post(
  "/express/test/client-reply",
  EcPayController.handleTestExpressClientReply,
);

router.get("/express/create", EcPayController.createExpress);
router.post("/express/server-reply", EcPayController.handleExpressServerReply);
router.post("/express/client-reply", EcPayController.handleExpressClientReply);

router.get("/helper/printTradeDocument", EcPayController.printTradeDocument);
router.get(
  "/helper/queryLogisticsTradeInfo",
  EcPayController.queryLogisticsTradeInfo,
);
router.get(
  "/helper/queryLogisticsTradeInfoJSON",
  // isAuth,
  EcPayController.queryLogisticsTradeInfoJSON,
);

export default router;
