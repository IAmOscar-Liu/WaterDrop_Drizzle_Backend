import { Router } from "express";
import ChatroomSyncController from "../controller/chatroomSync";
import isAuth from "../middleware/isAuth";
import { chatroomSyncValidation } from "../middleware/chatroomSync";
import validateZod from "../middleware/validateZod";

// App-only routes, mounted at /api/chatroom/sync. Never included in admin Swagger.
const router = Router();
router.use(isAuth);
router.get("/list", validateZod({ query: chatroomSyncValidation.listQuery }), ChatroomSyncController.list);
router.get("/history/:chatRoomId", validateZod({ params: chatroomSyncValidation.chatRoomIdParams, query: chatroomSyncValidation.historyQuery }), ChatroomSyncController.history);
router.post("/message/:chatRoomId", validateZod({ params: chatroomSyncValidation.chatRoomIdParams, body: chatroomSyncValidation.sendMessageBody }), ChatroomSyncController.send);
router.put("/message/:chatRoomId/read", validateZod({ params: chatroomSyncValidation.chatRoomIdParams, body: chatroomSyncValidation.readBody }), ChatroomSyncController.read);
export default router;
