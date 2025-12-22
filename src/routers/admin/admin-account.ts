import { Router } from "express";
import AccountController from "../../controller/account";
import isAuth from "../../middleware/isAuth";

/**
 * @swagger
 *  tags:
 *   name: Account
 *   description: Account management for administrators
 *
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
 *           enum: [admin, seller, employee]
 *           description: The role of the account.
 *         status:
 *           type: string
 *           enum: [active, inactive, banned]
 *           description: The status of the account.
 *           default: active
 *         lastLoginAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the account was logged in last time.
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the account was created.
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the account was last updated.
 *
 *     ListAccountsResponse:
 *       type: object
 *       properties:
 *         accounts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Account'
 *         total:
 *           type: integer
 *           description: Total number of accounts matching the query.
 *         page:
 *           type: integer
 *           description: The current page number.
 *         limit:
 *           type: integer
 *           description: The number of items per page.
 *         totalPages:
 *           type: integer
 *           description: The total number of pages.
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
 *               role:
 *                 type: string
 *                 enum: [seller, employee]
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
 *               role:
 *                 type: string
 *                 enum: [seller, employee]
 *               status:
 *                 type: string
 *                 enum: [active, inactive, banned]
 *                 description: The status of the account.
 *                 example: "inactive"
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
 * /api/admin/account/list-employees:
 *   get:
 *     tags: [Account]
 *     summary: List employees associated with the current account's group
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: A list of employee accounts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Account'
 *       '401':
 *         description: Unauthorized.
 */
router.get("/list-employees", isAuth, AccountController.listAccountEmployees);

/**
 * @swagger
 * /api/admin/account/list:
 *   get:
 *     tags: [Account]
 *     summary: List accounts with pagination and filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: The page number to retrieve.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: The number of accounts to return per page.
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: A search term to filter accounts by name or email.
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, seller, employee]
 *         description: Filter accounts by role.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, banned]
 *         description: Filter accounts by status.
 *     responses:
 *       '200':
 *         description: A paginated list of accounts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListAccountsResponse'
 *
 */
router.get("/list", isAuth, AccountController.listAccounts);

/**
 * @swagger
 * /api/admin/account/{id}:
 *   get:
 *     tags: [Account]
 *     summary: Get a single account by ID
 *     description: Retrieves the details of a specific account by its unique identifier. This is an admin-only endpoint.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The unique identifier of the account to retrieve.
 *     responses:
 *       '200':
 *         description: Successfully retrieved the account details.
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
 *       '404':
 *         description: Account not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", isAuth, AccountController.getAccount);

/**
 * @swagger
 * /api/admin/account/assign-parent:
 *   post:
 *     tags: [Account]
 *     summary: Assign an employee account to a parent account (group)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parentId]
 *             properties:
 *               parentId:
 *                 type: string
 *                 format: uuid
 *                 description: The ID of the parent account (admin or seller).
 *     responses:
 *       '200':
 *         description: Successfully assigned the employee to the parent group.
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
 *         description: Bad Request (e.g. invalid roles or same IDs).
 *       '404':
 *         description: Account not found.
 */
router.post("/assign-parent", isAuth, AccountController.assignAccountParent);

export default router;
