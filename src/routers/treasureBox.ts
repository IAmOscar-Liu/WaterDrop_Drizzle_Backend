import { Router } from "express";
import TreasureBoxController from "../controller/treasureBox";
import isAuth from "../middleware/isAuth";
import validateZod from "../middleware/validateZod";
import {
  treasureBoxIdParams,
  videoCompleteBody,
} from "../middleware/treasureBox";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Treasure Box
 *   description: App-user advertisement rewards and treasure boxes
 *
 * components:
 *   schemas:
 *     UserDailyStatWithAward:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         totalViews:
 *           type: integer
 *         viewedAds:
 *           type: array
 *           items:
 *             type: string
 *             format: uuid
 *         treasureBoxesEarned:
 *           type: integer
 *         canWatchMore:
 *           type: boolean
 *         remainingViews:
 *           type: integer
 *         nextTreasureBoxIn:
 *           type: integer
 *         groupAdViewsCountYesterday:
 *           type: integer
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         isAwarded:
 *           type: boolean
 *
 *     TreasureBox:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         earnedAt:
 *           type: string
 *           format: date-time
 *         openedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         coinsAwarded:
 *           type: number
 *           format: double
 *           example: 15
 *         isOpened:
 *           type: boolean
 *         isActive:
 *           type: boolean
 *           nullable: true
 *         rewardCycleId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         accountingStatus:
 *           type: string
 *           enum: [claimable, acquired, unacquired, zero_reward]
 *           nullable: true
 *         timezoneSnapshot:
 *           type: string
 *           nullable: true
 *           example: Asia/Taipei
 *         userLocalDate:
 *           type: string
 *           format: date
 *           nullable: true
 *         localClaimDeadlineAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         archiveGraceDeadlineAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         claimDeadlineAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         acquiredAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         settledAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         rewardRuleVersion:
 *           type: string
 *           nullable: true
 *         rewardInputSnapshot:
 *           type: object
 *           nullable: true
 */

/**
 * @swagger
 * /api/treasureBox/list:
 *   get:
 *     tags: [Treasure Box]
 *     summary: List the authenticated user's active treasure boxes
 *     description: Returns active boxes newest first. A deadline can pass before the periodic cleanup removes a box, so claimDeadlineAt remains authoritative.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Active treasure boxes.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TreasureBox'
 *             example:
 *               success: true
 *               data:
 *                 - id: dddddddd-dddd-4ddd-8ddd-dddddddddddd
 *                   userId: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
 *                   earnedAt: "2026-09-13T10:00:00.000Z"
 *                   openedAt: null
 *                   coinsAwarded: 15
 *                   isOpened: false
 *                   isActive: true
 *                   rewardCycleId: ffffffff-ffff-4fff-8fff-ffffffffffff
 *                   accountingStatus: claimable
 *                   timezoneSnapshot: Asia/Taipei
 *                   userLocalDate: "2026-09-13"
 *                   localClaimDeadlineAt: "2026-09-13T16:00:00.000Z"
 *                   archiveGraceDeadlineAt: null
 *                   claimDeadlineAt: "2026-09-13T16:00:00.000Z"
 *                   acquiredAt: null
 *                   settledAt: null
 *                   rewardRuleVersion: group-views-v1
 *                   rewardInputSnapshot:
 *                     groupAdViewsCountYesterday: 20
 *                     completedViewCount: 2
 */
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserDailyStatWithAward'
 *             example:
 *               success: true
 *               data:
 *                 id: 10101010-1010-4010-8010-101010101010
 *                 userId: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
 *                 totalViews: 2
 *                 viewedAds:
 *                   - 22222222-2222-4222-8222-222222222222
 *                   - aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
 *                 treasureBoxesEarned: 1
 *                 canWatchMore: true
 *                 remainingViews: 18
 *                 nextTreasureBoxIn: 2
 *                 groupAdViewsCountYesterday: 20
 *                 createdAt: "2026-09-13T00:00:00.000Z"
 *                 updatedAt: "2026-09-13T10:00:00.000Z"
 *                 isAwarded: true
 *       '400':
 *         description: advertisementId is missing or is not a UUID.
 *       '403':
 *         description: The user cannot watch more videos today.
 *       '404':
 *         description: User or advertisement not found.
 *       '409':
 *         description: No valid current assignment exists, it expired, or it was already completed. Refresh the advertisement list before retrying.
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               statusCode: 409
 *               message: No valid issued assignment exists for this advertisement.
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/TreasureBox'
 *             example:
 *               success: true
 *               data:
 *                 id: dddddddd-dddd-4ddd-8ddd-dddddddddddd
 *                 userId: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
 *                 earnedAt: "2026-09-13T10:00:00.000Z"
 *                 openedAt: "2026-09-13T10:05:00.000Z"
 *                 coinsAwarded: 15
 *                 isOpened: true
 *                 isActive: true
 *                 rewardCycleId: ffffffff-ffff-4fff-8fff-ffffffffffff
 *                 accountingStatus: acquired
 *                 timezoneSnapshot: Asia/Taipei
 *                 userLocalDate: "2026-09-13"
 *                 localClaimDeadlineAt: "2026-09-13T16:00:00.000Z"
 *                 archiveGraceDeadlineAt: null
 *                 claimDeadlineAt: "2026-09-13T16:00:00.000Z"
 *                 acquiredAt: "2026-09-13T10:05:00.000Z"
 *                 settledAt: null
 *                 rewardRuleVersion: group-views-v1
 *                 rewardInputSnapshot:
 *                   groupAdViewsCountYesterday: 20
 *                   completedViewCount: 2
 *       '400':
 *         description: Invalid treasure-box UUID or the box was already opened.
 *       '404':
 *         description: Treasure box not found or not owned by the authenticated user.
 *       '410':
 *         description: Treasure box claim deadline has passed. Refresh the treasure-box list before retrying.
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               statusCode: 410
 *               message: This treasure box has expired.
 */
router.post(
  "/open/:treasureBoxId",
  isAuth,
  validateZod({ params: treasureBoxIdParams }),
  TreasureBoxController.openTreasureBox,
);

export default router;
