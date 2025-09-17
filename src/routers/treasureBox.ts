import { Router } from "express";
import TreasureBoxController from "../controller/treasureBox";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, TreasureBoxController.listTreasureBoxes);
router.post(
  "/video-complete",
  isAuth,
  TreasureBoxController.processVideoCompletion
);
router.post(
  "/open/:treasureBoxId",
  isAuth,
  TreasureBoxController.openTreasureBox
);

export default router;
