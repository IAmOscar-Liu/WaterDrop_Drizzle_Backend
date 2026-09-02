import { Router } from "express";
import AuthController from "../controller/auth";
import isAuth from "../middleware/isAuth";

const router = Router();

router.post("/login", AuthController.login);
router.get("/profile", isAuth, AuthController.profile);
router.put("/profile", isAuth, AuthController.updateProfile);
router.post("/device-token", isAuth, AuthController.deviceToken);
router.delete("/device-token", isAuth, AuthController.clearDeviceToken);
router.get("/daily-stats", isAuth, AuthController.dailyStats);
router.get("/referral/:referralCode", AuthController.validateReferralCode);

/**
 * @swagger
 * /api/auth/join-group:
 *   post:
 *     tags: [Auth]
 *     summary: Join a user group using a referral code
 *     description: |
 *       Assigns the authenticated user to the referral-code owner's group.
 *       Rejoining the same group is idempotent. The request is rejected when
 *       the group owner is already a member of a group owned by the joining
 *       user, preventing reciprocal group membership. A group accepts at most
 *       10 joined members; the group owner is not included in this limit.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [referralCode]
 *             properties:
 *               referralCode:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Joined the group, or was already in the group.
 *       '400':
 *         description: Self-referral or reciprocal group membership is not allowed, or the group already has 10 joined members.
 *       '401':
 *         description: Authentication required.
 *       '404':
 *         description: User or referral code not found.
 */
router.post("/join-group", isAuth, AuthController.joinGroup);
router.post("/terms-accepted-at", isAuth, AuthController.updateTermsAcceptedAt);

router.post("/reset/daily-stats", isAuth, AuthController.resetDailyStats);

export default router;
