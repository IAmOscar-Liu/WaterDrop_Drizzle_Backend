import { Router } from "express";

import AccountWalletController from "../../controller/accountWallet";
import { adminValidation } from "../../middleware/admin";
import isAdmin from "../../middleware/isAdmin";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";

const router = Router();
// advertisement_budget_return is a positive wallet credit displayed as 回收廣告費.
// Summary advertisementBudgetReturns is the positive total within the requested date filters.

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
 *           enum: [legacy_opening_balance, admin_credit, advertisement_funding_debit, advertisement_budget_return, seller_deposit, seller_withdrawal]
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
 *           enum: [legacy_opening_balance, admin_credit, advertisement_funding_debit, advertisement_budget_return, seller_deposit, seller_withdrawal]
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
 *                 advertisementBudgetReturns: "300.00"
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
 *           enum: [legacy_opening_balance, admin_credit, advertisement_funding_debit, advertisement_budget_return, seller_deposit, seller_withdrawal]
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
 *     summary: Retired standalone wallet credit
 *     deprecated: true
 *     description: Standalone admin credits are disabled. Sellers must submit an advertising-wallet deposit request through /api/admin/seller-earnings/requests and admins complete that request after checking external receipt.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: accountId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       '410': { description: WALLET_CREDIT_REQUIRES_REQUEST }
 *       '403': { description: Administrator access required }
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
