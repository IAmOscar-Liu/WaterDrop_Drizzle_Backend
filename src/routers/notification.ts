import { Router } from "express";
import NotificationController from "../controller/notification";
import isAuth from "../middleware/isAuth";
import NotificationSyncController from "../controller/notificationSync";
import notificationSyncRouter from "./notificationSync";
import validateZod from "../middleware/validateZod";
import { notificationBatchBody, notificationIdParams } from "../middleware/notificationSync";

const router = Router();

router.get("/events", isAuth, NotificationSyncController.events);
router.use("/sync", notificationSyncRouter);
router.get("/list", isAuth, NotificationController.listNotifications);
router.get("/stats", isAuth, NotificationController.getNotificationStats);
router.get("/:id", isAuth, validateZod({ params: notificationIdParams }), NotificationController.getNotification);
router.post(
  "/mark-as-read",
  isAuth,
  validateZod({ body: notificationBatchBody }),
  NotificationController.markNotificationsAsRead
);
router.delete("/", isAuth, validateZod({ body: notificationBatchBody }), NotificationController.deleteNotifications);

export default router;
