import { Router } from "express";
import mutler from "multer";
import fileController from "../controller/file";
import isAuth from "../middleware/isAuth";

const router = Router();

const upload = mutler({ dest: "./uploads/" });

router.get("/user-consent", fileController.renderUserConsentDocument);

router.post(
  "/image/upload",
  isAuth,
  upload.single("file"),
  fileController.uploadImage
);

router.post(
  "/video/upload",
  isAuth,
  upload.single("file"),
  fileController.uploadVideo
);

export default router;
