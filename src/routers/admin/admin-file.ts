import { Router } from "express";
import fileController from "../../controller/file";
import mutler from "multer";
import isAuth from "../../middleware/isAuth";

const router = Router();

const upload = mutler({ dest: "../uploads/" });

/**
 * @swagger
 * tags:
 *   name: File
 *   description: File upload management for administrators
 */

/**
 * @swagger
 * /api/admin/file/image/upload:
 *   post:
 *     tags: [File]
 *     summary: Upload an image
 *     description: Uploads a single image file to the 'images' directory in the storage.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The image file to upload.
 *               path:
 *                 type: string
 *                 description: The path of the image (e.g. chat/:chatroomId, product/測試商品).
 *     responses:
 *       '200':
 *         description: The URL of the uploaded image.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: string
 *                   format: uri
 *                   example: "https://pub-your-bucket.r2.dev/images/uuid.jpg"
 */
router.post(
  "/image/upload",
  isAuth,
  upload.single("file"),
  fileController.uploadImage
);
/**
 * @swagger
 * /api/admin/file/video/upload:
 *   post:
 *     tags: [File]
 *     summary: Upload a video
 *     description: Uploads a single video file to the 'videos' directory in the storage.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The video file to upload.
 *               path:
 *                 type: string
 *                 description: The path of the video (e.g. chat/:chatroomId, advertisement/測試廣告影片).
 *     responses:
 *       '200':
 *         description: The URL of the uploaded video.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: string
 *                   format: uri
 *                   example: "https://pub-your-bucket.r2.dev/videos/uuid.mp4"
 */
router.post(
  "/video/upload",
  isAuth,
  upload.single("file"),
  fileController.uploadVideo
);

export default router;
