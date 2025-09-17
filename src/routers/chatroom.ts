import { Router } from "express";
import ChatroomController from "../controller/chatroom";
import isAuth from "../middleware/isAuth";

const router = Router();

router.post("/create", isAuth, ChatroomController.findOrCreateChatRoom);
router.get("/history/:chatRoomId", isAuth, ChatroomController.getChatHistory);
router.post("/message/:chatRoomId", isAuth, ChatroomController.sendMessage);
router.put(
  "/message/:chatRoomId/read",
  isAuth,
  ChatroomController.markMessagesAsRead
);

export default router;
