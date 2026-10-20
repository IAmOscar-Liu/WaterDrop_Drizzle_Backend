import { Router } from "express";
import AccountController from "../../controller/account";
import isAuth, { isAccountAuthenticated } from "../../middleware/isAuth";
import isAdmin from "../../middleware/isAdmin";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

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
 *       description: Business APIs require verified seller email (403 ACCOUNT_EMAIL_UNVERIFIED) and then a completed seller profile (403 ACCOUNT_PROFILE_INCOMPLETE). Employee access also requires an eligible parent seller. Admin access JWTs require the admin_access purpose, waterdrop issuer, waterdrop-admin audience and an active session. Legacy admin tokens require a new login. Password changes invalidate old access/refresh tokens.
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
 *           nullable: true
 *           description: The name of the account holder.
 *         realName:
 *           type: string
 *           nullable: true
 *           description: The real name of the account holder.
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
 *         avatar_url:
 *           type: string
 *           format: uri
 *           nullable: true
 *           description: The account avatar URL.
 *         role:
 *           type: string
 *           enum: [admin, seller, employee]
 *           description: The role of the account.
 *         status:
 *           type: string
 *           enum: [active, inactive, banned]
 *           description: The status of the account.
 *           default: active
 *         isEmailVerified:
 *           type: boolean
 *           description: Whether the current email has been verified; admin/employee own verification is not required for business access.
 *         emailVerifiedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         isProfileComplete:
 *           type: boolean
 *           description: False for a seller whose profile completion timestamp is null; true for admin/employee accounts.
 *         profileCompletedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         missingProfileFields:
 *           type: array
 *           items:
 *             type: string
 *             enum: [name, realName, phone]
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
 *         deletedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Employee soft-deletion time.
 *         deletedByAccountId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *
 *     AccountWithParent:
 *       allOf:
 *         - $ref: '#/components/schemas/Account'
 *         - type: object
 *           properties:
 *             parent:
 *               $ref: '#/components/schemas/Account'
 *               nullable: true
 *               description: The parent account, if this account is an employee.
 *
 *     ListAccountsResponse:
 *       type: object
 *       properties:
 *         accounts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AccountWithParent'
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
 *               $ref: '#/components/schemas/AccountWithParent'
 *             token:
 *               type: string
 *               description: Admin JWT access token bound to a server-side session. It expires after 1 day locally or 1 hour elsewhere, capped by the 30-day absolute session lifetime.
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
 * /api/admin/account/resend-verification-email:
 *   post:
 *     tags: [Account]
 *     summary: Resend verification to the authenticated account's current email
 *     description: Unverified/incomplete accounts allowed. No recipient or account ID accepted. Optional callbackUrl must exactly match configured approved FE pages; no query/fragment/user-info. A new 30-minute link replaces previous verification links. Sends are limited to 20/hour/IP and 5/hour/account with a 60-second cooldown, including the initial registration email. Already verified accounts receive a successful no-op acknowledgement. Same registered email casing as login is used.
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               callbackUrl: {type: string, format: uri, maxLength: 2048}
 *     responses:
 *       '200':
 *         description: Email accepted by SendGrid, or already verified; not proof of inbox delivery.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: {type: boolean}
 *                 data:
 *                   type: object
 *                   properties:
 *                     message: {type: string}
 *       '400': {description: Invalid request or unapproved callback URL.}
 *       '401': {description: Invalid or expired account session.}
 *       '403': {description: Inactive or deleted account.}
 *       '429': {description: EMAIL_VERIFICATION_RATE_LIMIT; Retry-After 3600 seconds.}
 *       '503': {description: Invalid server URL configuration or EMAIL_VERIFICATION_DELIVERY_FAILED; request a fresh link later.}
 * /api/admin/account/verify-email:
 *   post:
 *     tags: [Account]
 *     summary: Verify the authenticated account's current email
 *     description: Explicit POST only; GET/page loads never consume tokens. Requires a session belonging to the token's account, including when opened in another browser. The fragment contains token and purpose=verify. Atomically consumes the single-use token and revokes outstanding verification/change links. Does not complete the profile or create a session. Existing sessions remain valid. Attempts shared with confirm-email-change are limited to 60/hour/IP and 60/hour/account.
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [token]
 *             properties:
 *               token: {type: string, maxLength: 256}
 *     responses:
 *       '200':
 *         description: Email verified; current account including verification and profile state.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: {type: boolean}
 *                 data: {$ref: '#/components/schemas/AccountWithParent'}
 *       '400': {description: EMAIL_VERIFICATION_TOKEN_INVALID for invalid/expired/used/revoked/wrong-account/wrong-purpose links.}
 *       '401': {description: Invalid or expired account session.}
 *       '403': {description: Account unavailable.}
 *       '429': {description: EMAIL_VERIFICATION_RATE_LIMIT; Retry-After 3600 seconds.}
 * /api/admin/account/request-email-change:
 *   post:
 *     tags: [Account]
 *     summary: Verify a new email before replacing the current login address
 *     description: Own account only; permitted during onboarding to correct a typo, and for admin/employee accounts. Requires current password. Sends a 30-minute single-use link to newEmail with purpose=change. Current email remains the login/recovery address until confirmation. Resending replaces previous change links. Limits are 20/hour/IP, 5/hour/account and 5/hour/destination; account and destination have a 60-second cooldown. No pending-email field is returned. Existing exact-case email identity is preserved; rate limits normalize destination casing only.
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [newEmail, password]
 *             properties:
 *               newEmail: {type: string, format: email, maxLength: 320}
 *               password: {type: string, minLength: 1, maxLength: 256}
 *               callbackUrl: {type: string, format: uri, maxLength: 2048}
 *     responses:
 *       '200':
 *         description: Confirmation email accepted by SendGrid; current address unchanged.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: {type: boolean}
 *                 data:
 *                   type: object
 *                   properties:
 *                     message: {type: string}
 *       '400': {description: Invalid input, unchanged address or unapproved callback URL.}
 *       '401': {description: Invalid or expired account session.}
 *       '403': {description: EMAIL_CHANGE_PASSWORD_INVALID or account unavailable.}
 *       '409': {description: ACCOUNT_EMAIL_UNAVAILABLE.}
 *       '429': {description: EMAIL_VERIFICATION_RATE_LIMIT; Retry-After 3600 seconds.}
 *       '503': {description: Invalid server configuration or EMAIL_VERIFICATION_DELIVERY_FAILED.}
 * /api/admin/account/confirm-email-change:
 *   post:
 *     tags: [Account]
 *     summary: Confirm the new email and revoke all login sessions
 *     description: Requires the requesting account's valid session and a purpose=change token. Until confirmation, log in using the old address. Atomically replaces email, marks it verified, increments credential version, revokes all sessions/reset/verification links and clears refresh cookie. The old address receives a best-effort notification. Password/profile/role remain unchanged. Log in again using the new address. An uncertain response requires normal login/recovery, not automatic retry. Attempts share the verify-email limits.
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [token]
 *             properties:
 *               token: {type: string, maxLength: 256}
 *     responses:
 *       '200':
 *         description: Email changed; all sessions revoked.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: {type: boolean}
 *                 data:
 *                   type: object
 *                   properties:
 *                     requiresLogin: {type: boolean, example: true}
 *                     message: {type: string}
 *       '400': {description: EMAIL_VERIFICATION_TOKEN_INVALID.}
 *       '401': {description: Invalid/expired/revoked account session, including retries after a successful change.}
 *       '403': {description: Account unavailable.}
 *       '409': {description: ACCOUNT_EMAIL_UNAVAILABLE; transaction rolled back, current address unchanged.}
 *       '429': {description: EMAIL_VERIFICATION_RATE_LIMIT; Retry-After 3600 seconds.}
 */
router.post("/resend-verification-email", isAccountAuthenticated, validateZod({ body: adminValidation.account.resendVerificationBody }), AccountController.resendVerificationEmail);
router.post("/verify-email", isAccountAuthenticated, validateZod({ body: adminValidation.account.verifyEmailBody }), AccountController.verifyEmail);
router.post("/request-email-change", isAccountAuthenticated, validateZod({ body: adminValidation.account.requestEmailChangeBody }), AccountController.requestEmailChange);
router.post("/confirm-email-change", isAccountAuthenticated, validateZod({ body: adminValidation.account.verifyEmailBody }), AccountController.confirmEmailChange);


router.post("/complete-profile", isAccountAuthenticated, validateZod({ body: adminValidation.account.completeProfileBody }), AccountController.completeProfile);
router.post("/forgot-password", validateZod({ body: adminValidation.account.forgotPasswordBody }), AccountController.forgotPassword);
router.post("/reset-password", validateZod({ body: adminValidation.account.resetPasswordBody }), AccountController.resetPassword);

/**
 * @swagger
 * /api/admin/account/complete-profile:
 *   post:
 *     tags: [Account]
 *     summary: Complete the authenticated seller profile
 *     description: Active incomplete sellers are allowed. Account ID is derived from authentication. Identical retries preserve completion time; different data after completion returns 409. No second login is needed after completion.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [name, realName, phone]
 *             properties:
 *               name: { type: string, minLength: 1 }
 *               realName: { type: string, description: 'ECPay length 4–10; no emoji.' }
 *               phone: { type: string, pattern: '^09\d{8}$' }
 *               address: { type: string }
 *     responses:
 *       '200':
 *         description: Completed seller profile.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AccountWithParent' }
 *       '400': { description: Invalid profile or unsupported input fields. }
 *       '401': { description: Missing, expired or revoked credentials. }
 *       '403': { description: Account unavailable or caller is not a seller. }
 *       '409': { description: Already completed with different data; use profile update. }
 * /api/admin/account/forgot-password:
 *   post:
 *     tags: [Account]
 *     summary: Request a password-reset email
 *     description: Public. Applies to active non-deleted backend accounts, including incomplete sellers. Uses the stored email identity exactly as login does. callbackUrl must be an approved FE reset page; defaults to server configuration. Email links contain a single-use 30-minute token in the URL fragment. Account lookup and email delivery happen asynchronously; success is not delivery confirmation. Existing, unknown, unavailable and email-throttled accounts receive the same response.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, maxLength: 320 }
 *               callbackUrl: { type: string, format: uri, maxLength: 2048, description: 'Exact approved URL; no query, fragment or user-info.' }
 *     responses:
 *       '200':
 *         description: Generic acknowledgement; never returns a token or account ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     message: { type: string, example: 'If an eligible account exists, a password reset email will be sent.' }
 *       '400': { description: Invalid body or unapproved callback URL. }
 *       '429':
 *         description: IP request limit exceeded.
 *         headers:
 *           Retry-After: { schema: { type: integer }, description: Retry delay in seconds. }
 *       '503': { description: Recovery URL or signing-secret configuration unavailable. }
 * /api/admin/account/reset-password:
 *   post:
 *     tags: [Account]
 *     summary: Reset a password using an emailed token
 *     description: Public; the reset token authorizes only this operation. Success invalidates other reset links and all previous access/refresh tokens, clears the current refresh cookie and requires normal login. It does not change profile completion, role or status. Expired/used/revoked/unknown tokens all return 400 PASSWORD_RESET_TOKEN_INVALID. GET/page loads never consume tokens.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string, maxLength: 256 }
 *               newPassword: { type: string, format: password, description: '8+ characters; at most 72 UTF-8 bytes; uppercase, lowercase, number and special character.' }
 *     responses:
 *       '200':
 *         description: Password changed; confirmation email attempted independently.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     message: { type: string, example: 'Password reset successfully. Please log in.' }
 *       '400': { description: Invalid input or PASSWORD_RESET_TOKEN_INVALID. }
 *       '429':
 *         description: IP request limit exceeded.
 *         headers:
 *           Retry-After: { schema: { type: integer }, description: Retry delay in seconds. }
 */


/**
 * @swagger
 * /api/admin/account/register:
 *   post:
 *     tags: [Account]
 *     summary: Register a new seller account
 *     description: Public registration always creates a seller. Email/password alone creates an incomplete profile. For legacy full registration supply name, realName and phone together (address optional); this completes the profile, but email verification is still required for business access. Partial profiles return 400. A 30-minute verification email is attempted after account creation; delivery failure retains the account for resend. Unverified/incomplete sellers can use onboarding, verification and email-change endpoints. Public registration is limited to 20 requests/hour/IP; 429 includes Retry-After. Invalid verification URL configuration returns 503 before account creation.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               realName:
 *                 type: string
 *                 description: Optional with credentials-only registration; required with the profile group. ECPay-compatible real name; encoded length 4-10 and no emoji.
 *                 example: "王小明"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 description: At least 8 characters, at most 72 UTF-8 bytes, with uppercase, lowercase, number, and special character.
 *                 example: "Password123!"
 *               phone:
 *                 type: string
 *                 description: Taiwan mobile format, 10 digits beginning with 09.
 *                 example: "0912345678"
 *               address:
 *                 type: string
 *                 example: "123 Main St, Anytown, USA"
 *     responses:
 *       '200':
 *         description: Account created successfully. Returns user info and an access token. A random opaque refresh token is set in an HTTP-only cookie; every use consumes and replaces it. The session expires 30 days after login.
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
router.post(
  "/register",
  validateZod({ body: adminValidation.account.registerBody }),
  AccountController.register,
);

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
 *         description: Login successful. Returns user info and an access token. A random opaque refresh token is set in an HTTP-only cookie; every use consumes and replaces it. The session expires 30 days after login.
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
router.post(
  "/login",
  validateZod({ body: adminValidation.account.loginBody }),
  AccountController.login,
);

/**
 * @swagger
 * /api/admin/account/logout:
 *   post:
 *     tags: [Account]
 *     summary: Log out an account
 *     description: Revokes the session identified by the refresh cookie, falling back to a valid bearer access token if no recognized cookie exists, and clears the cookie on success. Access tokens and admin SSE for that session stop working; other logins remain active. Missing/unknown credentials are an idempotent success. No request body is required.
 *     responses:
 *       '200':
 *         description: Session revoked (if identifiable) and refresh cookie cleared. Returns success true and data OK.
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
 *     description: Send the current opaque refresh token through the HTTP-only cookie using credentials-enabled requests; no body or bearer token is required. Success atomically consumes it and sets its replacement cookie, keeping the same 30-day absolute session expiry. Reusing a consumed token revokes that login session and returns 403 REFRESH_TOKEN_REUSED. Other invalid/expired/revoked or legacy JWT refresh cookies return 403 REFRESH_TOKEN_INVALID. Missing cookie returns 401 REFRESH_TOKEN_MISSING. All 401/403 responses clear the cookie. Do not automatically retry refresh; concurrent calls or a lost response may require login again. Coordinate one in-flight refresh across tabs. Response is success true with data.token; refresh tokens are never in JSON.
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
 *                       description: A new admin JWT access token. It expires after 1 day in local and 1 hour in every other environment.
 *       '401':
 *         description: REFRESH_TOKEN_MISSING; cookie absent.
 *       '403':
 *         description: REFRESH_TOKEN_INVALID or REFRESH_TOKEN_REUSED; clear client authentication and log in again.
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
 *                   $ref: '#/components/schemas/AccountWithParent'
 *       '401':
 *         description: Unauthorized (e.g., no token provided or token is invalid).
 */
router.get("/me", isAccountAuthenticated, AccountController.getCurrentUser);

/**
 * @swagger
 * /api/admin/account/update:
 *   put:
 *     tags: [Account]
 *     description: Requires verified seller email and completed seller profile. Only platform admins may change role or status. Required completed profile fields cannot be cleared. Direct email changes return 409 ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION, including platform-admin edits; use request-email-change and confirm-email-change for the authenticated account. Sending the unchanged email remains allowed.
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
 *               realName:
 *                 type: string
 *                 description: ECPay-compatible real name; encoded length 4-10 and no emoji.
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 description: Preferred avatar request field. Send null to clear it. avatar_url is also accepted for backward compatibility.
 *               avatar_url:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 deprecated: true
 *                 description: Backward-compatible alias for avatarUrl.
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
 *                   $ref: '#/components/schemas/AccountWithParent'
 *       '401':
 *         description: Unauthorized.
 *       '403':
 *         description: Forbidden (e.g., trying to update another user's account).
 */
router.put(
  "/update",
  isAuth,
  validateZod({ body: adminValidation.account.updateBody }),
  AccountController.updateAccount,
);

/**
 * @swagger
 * /api/admin/account/change-password:
 *   put:
 *     tags: [Account]
 *     description: Available to incomplete sellers with valid authentication and old password. Success invalidates all prior access/refresh tokens, reset links and email verification/change links, clears the refresh cookie, and requires login again.
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
 *                   $ref: '#/components/schemas/AccountWithParent'
 *       '400':
 *         description: Bad Request (e.g., missing fields).
 *       '401':
 *         description: Unauthorized (e.g., incorrect old password).
 */
router.put(
  "/change-password",
  isAccountAuthenticated,
  validateZod({ body: adminValidation.account.changePasswordBody }),
  AccountController.changeAccountPassword,
);

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
 *       - in: query
 *         name: sellerId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter employee accounts whose account-group parent is this seller. Alias of parentId.
 *       - in: query
 *         name: accountGroupId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter accounts directly assigned to this account group.
 *       - in: query
 *         name: parentId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter employee accounts whose account-group parent is this account. If sellerId is also supplied, both values must match.
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
 *       '403':
 *         description: Only a platform admin account may list accounts.
 *
 */
router.get(
  "/list",
  isAuth,
  isAdmin,
  validateZod({ query: adminValidation.account.listQuery }),
  AccountController.listAccounts,
);

/**
 * @swagger
 * /api/admin/account/sub-account:
 *   post:
 *     tags: [Account]
 *     summary: Create an employee sub-account
 *     description: Sellers create an employee under themselves. Platform admins must provide parentId for an active seller. Employees cannot call this endpoint. A zero-balance wallet is created atomically.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, realName, email, password, phone]
 *             properties:
 *               parentId: { type: string, format: uuid, description: Required only for a platform-admin caller. }
 *               name: { type: string }
 *               realName: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               phone: { type: string, example: "0912345678" }
 *               address: { type: string }
 *     responses:
 *       '200': { description: Employee and wallet created. }
 *       '403': { description: Employee caller or cross-seller request. }
 *       '409': { description: Email already exists. }
 */
router.post(
  "/sub-account",
  isAuth,
  validateZod({ body: adminValidation.account.subAccountCreateBody }),
  AccountController.createSubAccount,
);

/**
 * @swagger
 * /api/admin/account/{id}:
 *   delete:
 *     tags: [Account]
 *     summary: Soft-delete an employee sub-account
 *     description: The owning seller or a platform admin may deactivate an employee. Existing tokens are rejected immediately; history and wallet records remain.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       '200': { description: Employee was deactivated. }
 *       '403': { description: Caller does not own the employee. }
 *       '409': { description: Target is not an employee. }
 */
router.delete(
  "/:id",
  isAuth,
  validateZod({ params: adminValidation.account.idParams }),
  AccountController.deleteSubAccount,
);

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
 *                   $ref: '#/components/schemas/AccountWithParent'
 *       '404':
 *         description: Account not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id",
  isAuth,
  validateZod({ params: adminValidation.account.idParams }),
  AccountController.getAccount,
);

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
 *                   $ref: '#/components/schemas/AccountWithParent'
 *       '400':
 *         description: Bad Request (e.g. invalid roles, same IDs, or reciprocal account-group membership).
 *       '404':
 *         description: Account not found.
 */
router.post(
  "/assign-parent",
  isAuth,
  validateZod({ body: adminValidation.account.assignParentBody }),
  AccountController.assignAccountParent,
);

export default router;
