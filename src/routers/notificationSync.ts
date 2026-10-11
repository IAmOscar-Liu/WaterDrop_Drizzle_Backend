import { Router } from "express";
import controller from "../controller/notificationSync";
import isAuth from "../middleware/isAuth";
import validateZod from "../middleware/validateZod";
import { notificationBatchBody, notificationIdParams, notificationSyncListQuery } from "../middleware/notificationSync";

const router = Router();
router.use(isAuth);
router.get("/list", validateZod({ query: notificationSyncListQuery }), controller.list);
router.get("/stats", controller.stats);
router.post("/mark-as-read", validateZod({ body: notificationBatchBody }), controller.read);
router.delete("/", validateZod({ body: notificationBatchBody }), controller.delete);
router.get("/:id", validateZod({ params: notificationIdParams }), controller.detail);
export default router;
