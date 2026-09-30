import { Router } from "express";

import AccountWalletController from "../../controller/accountWallet";
import { adminValidation } from "../../middleware/admin";
import isAdmin from "../../middleware/isAdmin";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Account Wallet
 *   description: Seller wallet balances, transaction history, and administrator credits
 *
 * components:
 *   schemas:
 *     AccountWallet:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         accountId: { type: string, format: uuid }
 *         walletBalance: { type: string, example: "1000.00" }
 *         totalRevenueCash: { type: string, example: "0.00" }
 *         totalRevenueCoin: { type: string, example: "0.00" }
 *         lockedBalance: { type: string, example: "0.00" }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     AccountWalletTransaction:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         sequence: { type: integer, example: 12 }
 *         walletId: { type: string, format: uuid }
 *         accountId: { type: string, format: uuid }
 *         actorAccountId: { type: string, format: uuid, nullable: true }
 *         advertisementId: { type: string, format: uuid, nullable: true }
 *         type:
 *           type: string
 *           enum: [legacy_opening_balance, admin_credit, advertisement_funding_debit]
 *         amount: { type: string, example: "1000.00" }
 *         balanceBefore: { type: string, example: "0.00" }
 *         balanceAfter: { type: string, example: "1000.00" }
 *         idempotencyKey: { type: string }
 *         reason: { type: string, nullable: true }
 *         externalReference: { type: string, nullable: true }
 *         metadata: { type: object, nullable: true, additionalProperties: true }
 *         createdAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/admin/account-wallet/me:
 *   get:
 *     tags: [Account Wallet]
 *     summary: Get the signed-in admin-side account's wallet
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       '200':
 *         description: Wallet balance. Currency values are decimal strings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AccountWallet' }
 */
router.get("/me", isAuth, AccountWalletController.getOwnWallet);

/**
 * @swagger
 * /api/admin/account-wallet/me/transactions:
 *   get:
 *     tags: [Account Wallet]
 *     summary: List the signed-in account's wallet transactions
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1 } }
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [legacy_opening_balance, admin_credit, advertisement_funding_debit]
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *     responses:
 *       '200':
 *         description: Paginated wallet transactions.
 */
router.get(
  "/me/transactions",
  isAuth,
  validateZod({ query: adminValidation.accountWallet.transactionListQuery }),
  AccountWalletController.listOwnTransactions,
);

/**
 * @swagger
 * /api/admin/account-wallet/me/summary:
 *   get:
 *     tags: [Account Wallet]
 *     summary: Get the signed-in account wallet cash-flow summary
 *     description: This is wallet cash flow, not seller sales revenue. All amounts are exact decimal strings.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *     responses:
 *       '200':
 *         description: Period opening balance, credits, ad-funding debits, and closing balance.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 openingBalance: "500.00"
 *                 adminCredits: "1000.00"
 *                 legacyOpeningCredits: "0.00"
 *                 advertisementFundingDebits: "-700.00"
 *                 closingBalance: "800.00"
 *                 transactionCount: 2
 */
router.get(
  "/me/summary",
  isAuth,
  validateZod({ query: adminValidation.accountWallet.summaryQuery }),
  AccountWalletController.getOwnSummary,
);

/**
 * @swagger
 * /api/admin/account-wallet/{accountId}/summary:
 *   get:
 *     tags: [Account Wallet]
 *     summary: Get an account wallet cash-flow summary (platform admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *     responses:
 *       '200': { description: Wallet cash-flow summary. }
 *       '403': { description: Platform administrator access required. }
 */
router.get(
  "/:accountId/summary",
  isAuth,
  isAdmin,
  validateZod({
    params: adminValidation.accountWallet.accountIdParams,
    query: adminValidation.accountWallet.summaryQuery,
  }),
  AccountWalletController.getAccountSummary,
);

/**
 * @swagger
 * /api/admin/account-wallet/{accountId}:
 *   get:
 *     tags: [Account Wallet]
 *     summary: Get an account wallet (platform admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       '200':
 *         description: Wallet balance.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AccountWallet' }
 *       '403': { description: Platform administrator access required. }
 */
router.get(
  "/:accountId",
  isAuth,
  isAdmin,
  validateZod({ params: adminValidation.accountWallet.accountIdParams }),
  AccountWalletController.getAccountWallet,
);

/**
 * @swagger
 * /api/admin/account-wallet/{accountId}/transactions:
 *   get:
 *     tags: [Account Wallet]
 *     summary: List an account's wallet transactions (platform admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1 } }
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [legacy_opening_balance, admin_credit, advertisement_funding_debit]
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *     responses:
 *       '200': { description: Paginated wallet transactions. }
 *       '403': { description: Platform administrator access required. }
 */
router.get(
  "/:accountId/transactions",
  isAuth,
  isAdmin,
  validateZod({
    params: adminValidation.accountWallet.accountIdParams,
    query: adminValidation.accountWallet.transactionListQuery,
  }),
  AccountWalletController.listAccountTransactions,
);

/**
 * @swagger
 * /api/admin/account-wallet/{accountId}/credit:
 *   post:
 *     tags: [Account Wallet]
 *     summary: Credit a seller wallet (platform admin only)
 *     description: Records an already-confirmed payment or manual correction. It is not a public checkout endpoint. The target may be inactive or banned, but must be a seller account. Reusing the same idempotency key and payload returns the original result; a different payload returns 409.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, idempotencyKey]
 *             properties:
 *               amount:
 *                 oneOf: [{ type: string }, { type: number }]
 *                 example: "1000.00"
 *                 description: Positive TWD amount with at most two decimal places.
 *               idempotencyKey: { type: string, minLength: 8, maxLength: 200 }
 *               reason: { type: string, maxLength: 500 }
 *               externalReference: { type: string, maxLength: 200 }
 *               metadata: { type: object, additionalProperties: true }
 *     responses:
 *       '200':
 *         description: Wallet and immutable credit transaction.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 wallet:
 *                   accountId: "11111111-1111-4111-8111-111111111111"
 *                   walletBalance: "1000.00"
 *                 transaction:
 *                   type: admin_credit
 *                   amount: "1000.00"
 *                   balanceBefore: "0.00"
 *                   balanceAfter: "1000.00"
 *                   idempotencyKey: seller-topup-payment-20260916-0001
 *                 idempotentReplay: false
 *       '403': { description: Platform administrator access required. }
 *       '409': { description: Target is not a seller or the idempotency key conflicts. }
 */
router.post(
  "/:accountId/credit",
  isAuth,
  isAdmin,
  validateZod({
    params: adminValidation.accountWallet.accountIdParams,
    body: adminValidation.accountWallet.creditBody,
  }),
  AccountWalletController.creditAccountWallet,
);

export default router;
