import { Router } from "express";
import AuthController from "../controller/auth";
import isAuth from "../middleware/isAuth";
import validateZod from "../middleware/validateZod";
import { clearDeviceTokenBody } from "../middleware/auth";

const router = Router();

router.post("/login", AuthController.login);
router.get("/profile", isAuth, AuthController.profile);
router.put("/profile", isAuth, AuthController.updateProfile);
router.post("/device-token", isAuth, AuthController.deviceToken);
/**
 * @swagger
 * /api/auth/device-token:
 *   delete:
 *     tags: [Auth]
 *     summary: Remove a specified push-device binding owned by the signed-in App user
 *     description: Supply deviceId or fcmToken, or both to require an exact match. Ownership comes only from the bearer token. Other devices remain registered. Missing selectors never delete all devices. Unknown, foreign or already-removed bindings return an empty array without exposing ownership. Identifiers are opaque and are not trimmed or coerced.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             anyOf:
 *               - required: [deviceId]
 *               - required: [fcmToken]
 *             properties:
 *               deviceId: { type: string, minLength: 1, description: Non-blank installation ID used during registration. }
 *               fcmToken: { type: string, minLength: 1, description: Non-blank registered FCM token; supports registrations without a deviceId. }
 *     responses:
 *       '200':
 *         description: Removed owned bindings, or an empty array for no match. Repeated removal succeeds without affecting other devices.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       userId: { type: string, format: uuid }
 *                       deviceId: { type: string, nullable: true }
 *                       fcmToken: { type: string }
 *                       createdAt: { type: string, format: date-time }
 *                       lastUsedAt: { type: string, format: date-time }
 *       '400': { description: Missing, empty, non-string or invalid selectors, or unknown body fields. }
 *       '401': { description: Authentication required. }
 */
router.delete("/device-token", isAuth, validateZod({ body: clearDeviceTokenBody }), AuthController.clearDeviceToken);
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

export default router;
