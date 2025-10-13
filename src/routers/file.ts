import { Router } from "express";
import fileController from "../controller/file";

const router = Router();

router.get("/user-consent", fileController.renderUserConsentDocument);

export default router;
