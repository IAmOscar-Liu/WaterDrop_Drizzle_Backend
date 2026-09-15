import { Router } from "express";
import AdvertisementController from "../../controller/advertisement";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Advertisement
 *   description: Advertisement management for administrators
 *
 * components:
 *   schemas:
 *     Advertisement:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         productId:
 *           type: string
 *           format: uuid
 *         title:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         video_url:
 *           type: string
 *         archivedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         archiveGraceEndsAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         financiallyClosedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         replacementOfAdvertisementId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     AdvertisementWithCount:
 *       allOf:
 *         - $ref: '#/components/schemas/Advertisement'
 *         - type: object
 *           properties:
 *             count:
 *               type: integer
 *               description: The view count for the advertisement within the specified date range.
 *
 *     AdvertisementWithProduct:
 *       allOf:
 *         - $ref: '#/components/schemas/Advertisement'
 *         - type: object
 *           properties:
 *             product:
 *               allOf:
 *                 - $ref: '#/components/schemas/Product'
 *                 - type: object
 *                   properties:
 *                     variants:
 *                       type: array
 *                       description: Active product variants available from the advertisement.
 *                       items:
 *                         $ref: '#/components/schemas/ProductVariant'
 *                     price:
 *                       type: number
 *                       format: double
 *                       description: Minimum active variant price.
 *
 *     AdvertisementWithProductAndStats:
 *       allOf:
 *         - $ref: '#/components/schemas/Advertisement'
 *         - type: object
 *           properties:
 *             stats:
 *               $ref: '#/components/schemas/AdvertisementBudgetStatus'
 *               nullable: true
 *             product:
 *               allOf:
 *                 - $ref: '#/components/schemas/Product'
 *                 - type: object
 *                   properties:
 *                     variants:
 *                       type: array
 *                       description: Active product variants available from the advertisement.
 *                       items:
 *                         $ref: '#/components/schemas/ProductVariant'
 *                     price:
 *                       type: number
 *                       format: double
 *                       description: Minimum active variant price.
 *
 *     AdvertisementWithProductAndDetails:
 *       allOf:
 *         - $ref: '#/components/schemas/Advertisement'
 *         - type: object
 *           properties:
 *             stats:
 *               $ref: '#/components/schemas/AdvertisementBudgetStatus'
 *               nullable: true
 *             transactions:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AdvertisementTransaction'
 *             product:
 *               allOf:
 *                 - $ref: '#/components/schemas/Product'
 *                 - type: object
 *                   properties:
 *                     variants:
 *                       type: array
 *                       description: Active product variants available from the advertisement.
 *                       items:
 *                         $ref: '#/components/schemas/ProductVariant'
 *                     price:
 *                       type: number
 *                       format: double
 *                       description: Minimum active variant price.
 *
 *     ListAdvertisementsResponse:
 *       type: object
 *       properties:
 *         advertisements:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdvertisementWithProductAndStats'
 *         total:
 *           type: integer
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         totalPages:
 *           type: integer
 *
 *     AdvertisementBudgetStatus:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         advertisementId:
 *           type: string
 *           format: uuid
 *         balance:
 *           type: number
 *         totalSpent:
 *           type: number
 *         sellerReturnedCurrencyAmount:
 *           type: string
 *           example: "2.00"
 *         returnedCoinAmount:
 *           type: string
 *           example: "20.00"
 *         netSettledSpentAmount:
 *           type: string
 *           example: "13.00"
 *         status:
 *           type: string
 *           enum: [active, paused, depleted, archived]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     AdvertisementTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         createdAt:
 *           type: string
 *           format: date-time
 *         metadata:
 *           type: object
 *           description: Transaction metadata.
 *         advertisementId:
 *           type: string
 *           format: uuid
 *         amount:
 *           type: number
 *         coinAmount:
 *           type: string
 *           nullable: true
 *           example: "15.00"
 *         coinToCurrencyRate:
 *           type: string
 *           nullable: true
 *           example: "10.000000"
 *         sourceSellerId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         adViewCountId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         balanceBefore:
 *           type: string
 *           nullable: true
 *           example: "100.00"
 *         balanceAfter:
 *           type: string
 *           nullable: true
 *           example: "98.50"
 *         idempotencyKey:
 *           type: string
 *           nullable: true
 *         type:
 *           type: string
 *           enum: [deposit, view_debit, seller_return_credit, balance_transfer_out, balance_transfer_in, manual_adjustment]
 *
 *     AdvertisementCoinFundingAccount:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         advertisementId:
 *           type: string
 *           format: uuid
 *         sourceSellerId:
 *           type: string
 *           format: uuid
 *         coinToCurrencyRate:
 *           type: string
 *           example: "10.000000"
 *         sellerFundingAvailableAmount:
 *           type: string
 *           example: "30.00"
 *         platformAdvanceOutstandingAmount:
 *           type: string
 *           example: "0.00"
 *         platformFundedConsumedAmount:
 *           type: string
 *           example: "0.00"
 *         platformPromotionalExpenseAmount:
 *           type: string
 *           example: "0.00"
 *         status:
 *           type: string
 *           enum: [active, closing, closed, exception]
 *         openedAt:
 *           type: string
 *           format: date-time
 *         closedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     AdvertisementCoinSettlementCohort:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         fundingAccountId:
 *           type: string
 *           format: uuid
 *         businessDate:
 *           type: string
 *           format: date
 *         claimSettlementAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         openingPlatformAdvanceAmount:
 *           type: string
 *           example: "0.00"
 *         sellerFundedAmount:
 *           type: string
 *           example: "30.00"
 *         acquiredRewardAmount:
 *           type: string
 *           example: "15.00"
 *         advanceCreatedAmount:
 *           type: string
 *           example: "0.00"
 *         advanceRepaidAmount:
 *           type: string
 *           example: "0.00"
 *         advanceCancelledAtExpiryAmount:
 *           type: string
 *           example: "0.00"
 *         sellerSurplusReturnedAmount:
 *           type: string
 *           example: "15.00"
 *         closingPlatformAdvanceAmount:
 *           type: string
 *           example: "0.00"
 *         status:
 *           type: string
 *           enum: [open, settling, settled, exception]
 *         settledAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     SellerCoinReturnTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         sourceSellerId:
 *           type: string
 *           format: uuid
 *         advertisementId:
 *           type: string
 *           format: uuid
 *         fundingAccountId:
 *           type: string
 *           format: uuid
 *         settlementCohortId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         rewardAllocationId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         userCoinLotId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         reason:
 *           type: string
 *           enum: [unacquired_surplus, expired_unused, refund_after_expiry, manual]
 *         coinAmount:
 *           type: string
 *           example: "15.00"
 *         coinToCurrencyRate:
 *           type: string
 *           example: "10.000000"
 *         currencyEquivalent:
 *           type: string
 *           example: "1.50"
 *         destinationType:
 *           type: string
 *           example: advertisement_balance
 *         destinationReferenceId:
 *           type: string
 *           format: uuid
 *         idempotencyKey:
 *           type: string
 *         metadata:
 *           type: object
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     AdvertisementCoinFundingTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         fundingAccountId:
 *           type: string
 *           format: uuid
 *         settlementCohortId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         type:
 *           type: string
 *           enum: [view_funded, reward_acquired_seller_funded, platform_advance_created, platform_advance_repaid, funding_source_reclassified, platform_advance_cancelled_expiry, platform_advance_written_off_archive, coin_consumed, coin_consumption_reversed, seller_surplus_returned, seller_unused_returned, seller_refund_after_expiry_returned, manual_adjustment]
 *         coinAmount:
 *           type: string
 *           example: "15.00"
 *         currencyEquivalent:
 *           type: string
 *           nullable: true
 *           example: "1.50"
 *         coinToCurrencyRate:
 *           type: string
 *           example: "10.000000"
 *         adViewCountId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         treasureBoxRewardAllocationId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         userCoinLotId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         sellerReturnTransactionId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         idempotencyKey:
 *           type: string
 *         metadata:
 *           type: object
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     AdvertisementCoinLedger:
 *       type: object
 *       properties:
 *         fundingAccount:
 *           $ref: '#/components/schemas/AdvertisementCoinFundingAccount'
 *         cohorts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdvertisementCoinSettlementCohort'
 *         sellerReturns:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SellerCoinReturnTransaction'
 *         fundingTransactions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdvertisementCoinFundingTransaction'
 *
 *     AdvertisementBalanceTransfer:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         sourceAdvertisementId:
 *           type: string
 *           format: uuid
 *         destinationAdvertisementId:
 *           type: string
 *           format: uuid
 *         sourceSellerId:
 *           type: string
 *           format: uuid
 *         coinAmount:
 *           type: string
 *           example: "200.00"
 *         coinToCurrencyRate:
 *           type: string
 *           example: "10.000000"
 *         currencyAmount:
 *           type: string
 *           example: "20.00"
 *         sourceBalanceBefore:
 *           type: string
 *           example: "50.00"
 *         sourceBalanceAfter:
 *           type: string
 *           example: "30.00"
 *         destinationBalanceBefore:
 *           type: string
 *           example: "100.00"
 *         destinationBalanceAfter:
 *           type: string
 *           example: "120.00"
 *         idempotencyKey:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *
 */

/**
 * @swagger
 * /api/admin/advertisement/list:
 *   get:
 *     tags: [Advertisement]
 *     summary: List advertisements with pagination
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       '200':
 *         description: A paginated list of advertisements.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListAdvertisementsResponse'
 */
router.get(
  "/list",
  isAuth,
  validateZod({ query: adminValidation.advertisement.listQuery }),
  AdvertisementController.listAdminAdvertisements,
);

/**
 * @swagger
 * /api/admin/advertisement/{id}:
 *   get:
 *     tags: [Advertisement]
 *     summary: Get an advertisement by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the advertisement.
 *     responses:
 *       '200':
 *         description: The requested advertisement.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AdvertisementWithProductAndDetails'
 */
router.get(
  "/:id",
  isAuth,
  validateZod({ params: adminValidation.advertisement.idParams }),
  AdvertisementController.getAdvertisement,
);

/**
 * @swagger
 * /api/admin/advertisement/create:
 *   post:
 *     tags: [Advertisement]
 *     summary: Create a new advertisement
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, title, video_url]
 *             properties:
 *               productId:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               video_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       '200':
 *         description: The created advertisement.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Advertisement'
 */
router.post(
  "/create",
  isAuth,
  validateZod({ body: adminValidation.advertisement.createBody }),
  AdvertisementController.createAdvertisement,
);

/**
 * @swagger
 * /api/admin/advertisement/{id}:
 *   put:
 *     tags: [Advertisement]
 *     summary: Update an existing advertisement
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               video_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       '200':
 *         description: The updated advertisement.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Advertisement'
 */
router.put(
  "/:id",
  isAuth,
  validateZod({
    params: adminValidation.advertisement.idParams,
    body: adminValidation.advertisement.updateBody,
  }),
  AdvertisementController.updateAdvertisement,
);

/**
 * @swagger
 * /api/admin/advertisement/list/view-count:
 *   get:
 *     tags: [Advertisement]
 *     summary: List all advertisements for a seller with their view counts
 *     description: Retrieves all advertisements for the authenticated seller, each with a view count calculated for an optional date range.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: startAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional start date (ISO 8601 format) to filter view counts.
 *       - in: query
 *         name: endAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional end date (ISO 8601 format) to filter view counts.
 *     responses:
 *       '200':
 *         description: A list of the seller's advertisements with their respective view counts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     startAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     endAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     advertisements:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/AdvertisementWithCount'
 *
 *
 *
 */
router.get(
  "/list/view-count",
  isAuth,
  validateZod({ query: adminValidation.advertisement.viewCountListQuery }),
  AdvertisementController.listAdViewCount,
);

/**
 * @swagger
 * /api/admin/advertisement/{id}/view-count:
 *   get:
 *     tags: [Advertisement]
 *     summary: Get the view count for an advertisement
 *     description: Retrieves the total number of views for a specific advertisement, with an optional date range filter.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the advertisement.
 *       - in: query
 *         name: startAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional start date (ISO 8601 format) to filter view counts.
 *       - in: query
 *         name: endAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional end date (ISO 8601 format) to filter view counts.
 *     responses:
 *       '200':
 *         description: The total view count for the advertisement within the specified range.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     advertisement:
 *                       $ref: '#/components/schemas/Advertisement'
 *                     stats:
 *                       type: object
 *                       properties:
 *                         startAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                           description: The start date of the filter range.
 *                         endAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                           description: The end date of the filter range.
 *                         count:
 *                           type: integer
 *                           description: The total number of views.
 */
router.get(
  "/:id/view-count",
  isAuth,
  validateZod({
    params: adminValidation.advertisement.idParams,
    query: adminValidation.advertisement.viewCountQuery,
  }),
  AdvertisementController.getAdViewCount,
);

/**
 * @swagger
 * /api/admin/advertisement/{id}/coin-ledger:
 *   get:
 *     tags: [Advertisement]
 *     summary: Get advertisement coin funding and seller-return ledger
 *     description: Returns the funding account plus the latest settlement cohorts, seller returns, and funding transactions. Monetary coin fields are exact decimal strings.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Advertisement coin-ledger details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AdvertisementCoinLedger'
 *             example:
 *               success: true
 *               data:
 *                 fundingAccount:
 *                   id: 11111111-1111-4111-8111-111111111111
 *                   advertisementId: 22222222-2222-4222-8222-222222222222
 *                   sourceSellerId: 33333333-3333-4333-8333-333333333333
 *                   coinToCurrencyRate: "10.000000"
 *                   sellerFundingAvailableAmount: "15.00"
 *                   platformAdvanceOutstandingAmount: "0.00"
 *                   platformFundedConsumedAmount: "0.00"
 *                   platformPromotionalExpenseAmount: "0.00"
 *                   status: active
 *                   openedAt: "2026-09-13T01:00:00.000Z"
 *                   closedAt: null
 *                   createdAt: "2026-09-13T01:00:00.000Z"
 *                   updatedAt: "2026-09-13T01:05:00.000Z"
 *                 cohorts:
 *                   - id: 44444444-4444-4444-8444-444444444444
 *                     fundingAccountId: 11111111-1111-4111-8111-111111111111
 *                     businessDate: "2026-09-13"
 *                     claimSettlementAt: "2026-09-13T16:00:00.000Z"
 *                     openingPlatformAdvanceAmount: "0.00"
 *                     sellerFundedAmount: "30.00"
 *                     acquiredRewardAmount: "15.00"
 *                     advanceCreatedAmount: "0.00"
 *                     advanceRepaidAmount: "0.00"
 *                     advanceCancelledAtExpiryAmount: "0.00"
 *                     sellerSurplusReturnedAmount: "15.00"
 *                     closingPlatformAdvanceAmount: "0.00"
 *                     status: settled
 *                     settledAt: "2026-09-13T16:01:00.000Z"
 *                     createdAt: "2026-09-13T01:05:00.000Z"
 *                     updatedAt: "2026-09-13T16:01:00.000Z"
 *                 sellerReturns:
 *                   - id: 55555555-5555-4555-8555-555555555555
 *                     sourceSellerId: 33333333-3333-4333-8333-333333333333
 *                     advertisementId: 22222222-2222-4222-8222-222222222222
 *                     fundingAccountId: 11111111-1111-4111-8111-111111111111
 *                     settlementCohortId: 44444444-4444-4444-8444-444444444444
 *                     rewardAllocationId: null
 *                     userCoinLotId: null
 *                     reason: unacquired_surplus
 *                     coinAmount: "15.00"
 *                     coinToCurrencyRate: "10.000000"
 *                     currencyEquivalent: "1.50"
 *                     destinationType: advertisement_balance
 *                     destinationReferenceId: 22222222-2222-4222-8222-222222222222
 *                     idempotencyKey: cohort-surplus:44444444-4444-4444-8444-444444444444
 *                     metadata: null
 *                     createdAt: "2026-09-13T16:01:00.000Z"
 *                 fundingTransactions:
 *                   - id: 66666666-6666-4666-8666-666666666666
 *                     fundingAccountId: 11111111-1111-4111-8111-111111111111
 *                     settlementCohortId: 44444444-4444-4444-8444-444444444444
 *                     type: view_funded
 *                     coinAmount: "15.00"
 *                     currencyEquivalent: "1.50"
 *                     coinToCurrencyRate: "10.000000"
 *                     adViewCountId: 77777777-7777-4777-8777-777777777777
 *                     treasureBoxRewardAllocationId: null
 *                     userCoinLotId: null
 *                     sellerReturnTransactionId: null
 *                     idempotencyKey: view-funded:77777777-7777-4777-8777-777777777777
 *                     metadata: null
 *                     createdAt: "2026-09-13T01:05:00.000Z"
 *       '403':
 *         description: The authenticated account does not own this advertisement.
 *       '404':
 *         description: Funding account not found.
 *       '409':
 *         description: Coin ledger is not enabled.
 */
router.get(
  "/:id/coin-ledger",
  isAuth,
  validateZod({ params: adminValidation.advertisement.idParams }),
  AdvertisementController.getAdvertisementCoinLedger,
);

/**
 * @swagger
 * /api/admin/advertisement/deposit/{id}:
 *   put:
 *     tags: [Advertisement]
 *     summary: Increase advertisement balance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 description: The amount to add to the advertisement's balance.
 *     responses:
 *       '200':
 *         description: The updated advertisement budget and status details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AdvertisementBudgetStatus'
 */
router.put(
  "/deposit/:id",
  isAuth,
  validateZod({
    params: adminValidation.advertisement.idParams,
    body: adminValidation.advertisement.depositBody,
  }),
  AdvertisementController.depositAdBalance,
);

/**
 * @swagger
 * /api/admin/advertisement/status/{id}:
 *   put:
 *     tags: [Advertisement]
 *     summary: Update advertisement status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, paused, depleted, archived]
 *                 description: The new status for the advertisement.
 *     responses:
 *       '200':
 *         description: The advertisement with the updated status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AdvertisementBudgetStatus'
 */
router.put(
  "/status/:id",
  isAuth,
  validateZod({
    params: adminValidation.advertisement.idParams,
    body: adminValidation.advertisement.statusBody,
  }),
  AdvertisementController.setAdStatus,
);

/**
 * @swagger
 * /api/admin/advertisement/{id}/financial-close:
 *   post:
 *     tags: [Advertisement]
 *     summary: Financially close an archived advertisement
 *     description: Returns settled seller surplus, writes any remaining platform advance off as promotional expense, and permanently closes the funding account. The archive grace period must have ended and no treasure-box claims may remain.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: The financially closed advertisement.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Advertisement'
 *             example:
 *               success: true
 *               data:
 *                 id: 22222222-2222-4222-8222-222222222222
 *                 productId: 88888888-8888-4888-8888-888888888888
 *                 title: Archived campaign
 *                 description: null
 *                 video_url: https://example.com/archive-ad.mp4
 *                 archivedAt: "2026-09-12T00:00:00.000Z"
 *                 archiveGraceEndsAt: "2026-09-13T00:00:00.000Z"
 *                 financiallyClosedAt: "2026-09-13T00:05:00.000Z"
 *                 replacementOfAdvertisementId: null
 *                 createdAt: "2026-09-01T00:00:00.000Z"
 *                 updatedAt: "2026-09-13T00:05:00.000Z"
 *       '403':
 *         description: The authenticated account does not own this advertisement.
 *       '404':
 *         description: Advertisement not found.
 *       '409':
 *         description: The ad is not archived, grace is active, claims remain, or the ledger is disabled.
 */
router.post(
  "/:id/financial-close",
  isAuth,
  validateZod({ params: adminValidation.advertisement.idParams }),
  AdvertisementController.financiallyCloseAdvertisement,
);

/**
 * @swagger
 * /api/admin/advertisement/{id}/balance-transfer:
 *   post:
 *     tags: [Advertisement]
 *     summary: Transfer archived ad balance to its replacement
 *     description: Moves available currency from a financially closed source ad to its direct replacement for the same product and seller. Neither ad is automatically activated. Reusing the same idempotencyKey returns the original transfer.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [destinationAdvertisementId, amount, idempotencyKey]
 *             properties:
 *               destinationAdvertisementId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               idempotencyKey:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Immutable balance-transfer record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AdvertisementBalanceTransfer'
 *             example:
 *               success: true
 *               data:
 *                 id: 99999999-9999-4999-8999-999999999999
 *                 sourceAdvertisementId: 22222222-2222-4222-8222-222222222222
 *                 destinationAdvertisementId: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
 *                 sourceSellerId: 33333333-3333-4333-8333-333333333333
 *                 coinAmount: "200.00"
 *                 coinToCurrencyRate: "10.000000"
 *                 currencyAmount: "20.00"
 *                 sourceBalanceBefore: "50.00"
 *                 sourceBalanceAfter: "30.00"
 *                 destinationBalanceBefore: "100.00"
 *                 destinationBalanceAfter: "120.00"
 *                 idempotencyKey: transfer-archived-ad-20260913-001
 *                 createdAt: "2026-09-13T02:00:00.000Z"
 *       '400':
 *         description: Invalid amount, same source/destination, or insufficient source balance.
 *       '403':
 *         description: The authenticated account does not own the source advertisement.
 *       '404':
 *         description: Source or destination advertisement not found.
 *       '409':
 *         description: Ads are not a valid source/replacement pair.
 */
router.post(
  "/:id/balance-transfer",
  isAuth,
  validateZod({
    params: adminValidation.advertisement.idParams,
    body: adminValidation.advertisement.balanceTransferBody,
  }),
  AdvertisementController.transferArchivedAdvertisementBalance,
);

export default router;
