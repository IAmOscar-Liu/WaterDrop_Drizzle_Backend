import { Router } from "express";
import AccountController from "../../controller/account";
import { sendMulticastPushNotification } from "../../lib/sendNotification";
import isAuth from "../../middleware/isAuth";

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Account:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: The unique identifier for the account.
 *         name:
 *           type: string
 *           description: The name of the account holder.
 *         email:
 *           type: string
 *           format: email
 *           description: The email address of the account.
 *         phone:
 *           type: string
 *           nullable: true
 *           description: The phone number of the account holder.
 *         address:
 *           type: string
 *           nullable: true
 *           description: The address of the account holder.
 *         role:
 *           type: string
 *           enum: [admin, seller]
 *           description: The role of the account.
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the account was created.
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the account was last updated.
 *
 *     LoginSuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/Account'
 *             token:
 *               type: string
 *               description: JWT access token.
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           description: A description of the error.
 *         statusCode:
 *           type: integer
 *           description: The HTTP status code.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           description: The notification's title.
 *           example: "您尚未看完今日的廣告"
 *         body:
 *           type: string
 *           description: The notification's body text.
 *           example: "快把握時間賺取金幣吧!"
 */

const router = Router();

/**
 * @swagger
 * /api/admin/account/register:
 *   post:
 *     tags: [Account]
 *     summary: Register a new admin or seller account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "password123"
 *               phone:
 *                 type: string
 *                 example: "123-456-7890"
 *               address:
 *                 type: string
 *                 example: "123 Main St, Anytown, USA"
 *     responses:
 *       '200':
 *         description: Account created successfully. Returns user info and an access token. A refresh token is set in an HTTP-only cookie.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginSuccessResponse'
 *       '400':
 *         description: Bad Request (e.g., missing required fields).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: Conflict (e.g., email already exists).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/register", AccountController.register);

/**
 * @swagger
 * /api/admin/account/login:
 *   post:
 *     tags: [Account]
 *     summary: Log in as an admin or seller
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "password123"
 *     responses:
 *       '200':
 *         description: Login successful. Returns user info and an access token. A refresh token is set in an HTTP-only cookie.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginSuccessResponse'
 *       '400':
 *         description: Bad Request (e.g., missing email or password).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Unauthorized (e.g., invalid credentials).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/login", AccountController.login);

/**
 * @swagger
 * /api/admin/account/logout:
 *   post:
 *     tags: [Account]
 *     summary: Log out an account
 *     description: Clears the refresh token HTTP-only cookie, effectively logging the user out from the perspective of token refreshing. The access token will remain valid until it expires.
 *     responses:
 *       '200':
 *         description: Successfully logged out and cleared the refresh token cookie.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: string
 *                   example: "OK"
 */
router.post("/logout", AccountController.logout);

/**
 * @swagger
 * /api/admin/account/refresh-token:
 *   post:
 *     tags: [Account]
 *     summary: Refresh an access token using a refresh token from cookies
 *     description: The refresh token must be sent in an HTTP-only cookie.
 *     responses:
 *       '200':
 *         description: Access token refreshed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: A new JWT access token.
 *       '401':
 *         description: Unauthorized (e.g., no refresh token provided).
 *       '403':
 *         description: Forbidden (e.g., invalid refresh token or account no longer exists).
 */
router.post("/refresh-token", AccountController.refreshToken);

/**
 * @swagger
 * /api/admin/account/me:
 *   get:
 *     tags: [Account]
 *     summary: Get the current authenticated user's profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successfully retrieved user profile.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Account'
 *       '401':
 *         description: Unauthorized (e.g., no token provided or token is invalid).
 */
router.get("/me", isAuth, AccountController.getCurrentUser);

/**
 * @swagger
 * /api/admin/account/update:
 *   put:
 *     tags: [Account]
 *     summary: Update the current authenticated user's profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id:
 *                 type: string
 *                 description: The user's ID
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Account updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Account'
 *       '401':
 *         description: Unauthorized.
 *       '403':
 *         description: Forbidden (e.g., trying to update another user's account).
 */
router.put("/update", isAuth, AccountController.updateAccount);

/**
 * @swagger
 * /api/admin/account/change-password:
 *   put:
 *     tags: [Account]
 *     summary: Change the current authenticated user's password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, oldPassword, newPassword]
 *             properties:
 *               id:
 *                 type: string
 *                 description: The user's ID
 *               oldPassword:
 *                 type: string
 *                 format: password
 *                 description: The user's current password.
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 description: The desired new password.
 *     responses:
 *       '200':
 *         description: Password changed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Account'
 *       '400':
 *         description: Bad Request (e.g., missing fields).
 *       '401':
 *         description: Unauthorized (e.g., incorrect old password).
 */
router.put("/change-password", isAuth, AccountController.changeAccountPassword);

/**
 * @swagger
 * /api/admin/account/send-notification:
 *   post:
 *     tags: [Account]
 *     summary: Send a push notification to multiple devices
 *     description: Sends a multicast push notification via FCM
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tokens]
 *             properties:
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: An array of FCM registration tokens for the target devices (max 500).
 *                 example: ["token1...", "token2..."]
 *               notification:
 *                 $ref: '#/components/schemas/Notification'
 *               data:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *                 description: Arbitrary key-value data to be sent with the message.
 *                 example:
 *                   command: "explore"
 *     responses:
 *       '200':
 *         description: Notification request was successfully processed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: string
 *                   example: "OK"
 */
router.post("/send-notification", async (req, res) => {
  await sendMulticastPushNotification(req.body);
  res.json({ success: true, data: "OK" });
});

export default router;
