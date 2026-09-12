import { Router } from "express";
import TreasureBoxController from "../controller/treasureBox";
import isAuth from "../middleware/isAuth";
import validateZod from "../middleware/validateZod";
import {
  treasureBoxIdParams,
  videoCompleteBody,
} from "../middleware/treasureBox";

const router = Router();

router.get("/list", isAuth, TreasureBoxController.listTreasureBoxes);
/**
 * @swagger
 * /api/treasureBox/video-complete:
 *   post:
 *     tags: [Treasure Box]
 *     summary: Complete a previously assigned advertisement
 *     description: advertisementId is required. An assignment issued before archive remains valid until the earlier of archive plus 24 hours (environment configurable) or the user's local midnight. Expired assignments fail with 409 so the app can refresh its advertisement list.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [advertisementId]
 *             properties:
 *               advertisementId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Updated daily statistics and whether a box was awarded.
 *       '409':
 *         description: No valid current assignment exists, it expired, or it was already completed. Refresh the advertisement list before retrying.
 */
router.post(
  "/video-complete",
  isAuth,
  validateZod({ body: videoCompleteBody }),
  TreasureBoxController.processVideoCompletion,
);
/**
 * @swagger
 * /api/treasureBox/open/{treasureBoxId}:
 *   post:
 *     tags: [Treasure Box]
 *     summary: Open a claimable treasure box
 *     description: Creates source-attributed coin lots expiring at the end of the next month in the user's timezone. Missing or invalid user timezones fall back to Asia/Taipei. An expired box fails with 410 so the app can refresh its treasure-box list.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: treasureBoxId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Opened treasure box.
 *       '410':
 *         description: Treasure box claim deadline has passed. Refresh the treasure-box list before retrying.
 */
router.post(
  "/open/:treasureBoxId",
  isAuth,
  validateZod({ params: treasureBoxIdParams }),
  TreasureBoxController.openTreasureBox,
);

export default router;
