import { Router } from "express";
import NotificationController from "../controller/notification";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, NotificationController.listNotifications);
router.get("/stats", isAuth, NotificationController.getNotificationStats);
router.get("/:id", isAuth, NotificationController.getNotification);
router.post(
  "/mark-as-read",
  isAuth,
  NotificationController.markNotificationsAsRead
);
router.delete("/", isAuth, NotificationController.deleteNotifications);

export default router;
