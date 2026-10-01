import { Router } from "express";
import DashboardController from "../../controller/dashboard";
import { adminValidation } from "../../middleware/admin";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Seller-scoped operational and financial dashboard
 * /api/admin/dashboard/kpi:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard KPI totals
 *     description: Sellers are scoped to themselves; employees inherit their parent seller; platform admins may supply sellerId or omit it for platform totals.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: report, schema: { type: string, enum: [internal] }, description: "Omit for legacy dashboard. Internal mode requires active platform admin; sellers and employees receive 403." }
 *       - { in: query, name: startDate, schema: { type: string, format: date }, description: "Required with report=internal. Inclusive Taipei date. Both dates required, at most 366 days. Do not mix internal mode with legacy filters." }
 *       - { in: query, name: endDate, schema: { type: string, format: date }, description: "Required with report=internal. Inclusive Taipei date, converted to exclusive next-day midnight. Current stocks remain current asOf even for a historical range." }
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: timezone, schema: { type: string, default: Asia/Taipei } }
 *     responses:
 *       '200':
 *         description: "Legacy response unchanged. Internal response follows InternalStatisticsKpi; exact strings, coverage metadata, recorded lifetime and period flows, current stocks, and coin-pool-TWD / remaining-ad-balance ratio (10 coins per TWD)."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   oneOf:
 *                     - { $ref: '#/components/schemas/InternalStatisticsKpi' }
 *                     - { type: object, description: Legacy dashboard KPI }
 *       '400': { description: Invalid date range or mixed internal/legacy filters. }
 *       '403': { description: Active platform admin required for internal mode. }
 */
router.get("/kpi", isAuth, validateZod({ query: adminValidation.dashboard.kpiQuery }), DashboardController.kpi);

/**
 * @swagger
 * /api/admin/dashboard/time-series:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get a dashboard time series
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: report, schema: { type: string, enum: [internal] }, description: "Omit for legacy dashboard. Internal mode requires active platform admin; sellers and employees receive 403." }
 *       - { in: query, name: startDate, schema: { type: string, format: date }, description: "Required with report=internal. Inclusive Taipei date. Both dates required, at most 366 days. Do not mix internal mode with legacy filters." }
 *       - { in: query, name: endDate, schema: { type: string, format: date }, description: "Required with report=internal. Inclusive Taipei date, converted to exclusive next-day midnight. Current stocks remain current asOf even for a historical range." }
 *       - { in: query, name: dataset, schema: { type: string, enum: [users, coin-flows, ad-finance] }, description: "Required only for report=internal. Daily recorded flows; historical stocks unavailable. Unverified empty ledger days return null." }
 *       - { in: query, name: metric, description: "Required for legacy mode only.", schema: { type: string, enum: [sales, orders, refunds, adViews, adSpend] } }
 *       - { in: query, name: interval, schema: { type: string, enum: [day, week, month], default: day } }
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: timezone, schema: { type: string, default: Asia/Taipei } }
 *     responses:
 *       '200':
 *         description: "Legacy bucket/value response unchanged. Internal mode returns InternalStatisticsTimeSeries."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   oneOf:
 *                     - { $ref: '#/components/schemas/InternalStatisticsTimeSeries' }
 *                     - { type: object, description: Legacy dashboard series }
 *       '400': { description: Invalid dates, dataset or mixed filters. }
 *       '403': { description: Active platform admin required for internal mode. }
 */
router.get("/time-series", isAuth, validateZod({ query: adminValidation.dashboard.timeSeriesQuery }), DashboardController.timeSeries);

/**
 * @swagger
 * /api/admin/dashboard/pending-tasks:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get actionable task counts and FE route hints
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       '200': { description: Pending order, delivery, and depleted-ad task counts. }
 */
router.get("/pending-tasks", isAuth, validateZod({ query: adminValidation.dashboard.filtersQuery }), DashboardController.pendingTasks);

/**
 * @swagger
 * /api/admin/dashboard/recent-activities:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get normalized admin activity events recorded after feature cutover
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: cursor, schema: { type: string, format: date-time } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
 *     responses:
 *       '200': { description: Activity events and nextCursor. }
 */
router.get("/recent-activities", isAuth, validateZod({ query: adminValidation.dashboard.activitiesQuery }), DashboardController.recentActivities);

export default router;

/**
 * @swagger
 * components:
 *   schemas:
 *     InternalMetric:
 *       type: object
 *       properties:
 *         value:
 *           type: string
 *           nullable: true
 *           description: Exact decimal/count string, or null for unavailable data.
 *         unit:
 *           type: string
 *         basis:
 *           type: string
 *         coverage:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum:
 *                 - complete
 *                 - partial
 *                 - unavailable
 *             reason:
 *               type: string
 *               nullable: true
 *     InternalAdFlows:
 *       type: object
 *       properties:
 *         fundingInflows:
 *           $ref: "#/components/schemas/InternalMetric"
 *         legacyDeposits:
 *           $ref: "#/components/schemas/InternalMetric"
 *         budgetWithdrawals:
 *           $ref: "#/components/schemas/InternalMetric"
 *         viewSpend:
 *           $ref: "#/components/schemas/InternalMetric"
 *         settlementReturns:
 *           $ref: "#/components/schemas/InternalMetric"
 *         transfersIn:
 *           $ref: "#/components/schemas/InternalMetric"
 *         transfersOut:
 *           $ref: "#/components/schemas/InternalMetric"
 *     InternalCoinFlows:
 *       type: object
 *       properties:
 *         acquiredCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         cashRefundConvertedCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         expiredRefundCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         refundedCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         expiredCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         manualNetCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         advanceCreatedCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         advanceRepaidCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         advanceCancelledCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         advanceWrittenOffCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *         spentCoins:
 *           $ref: "#/components/schemas/InternalMetric"
 *     InternalStatisticsKpi:
 *       type: object
 *       properties:
 *         asOf:
 *           type: string
 *         timezone:
 *           type: string
 *           enum:
 *             - Asia/Taipei
 *         startDate:
 *           type: string
 *           format: date
 *         endDate:
 *           type: string
 *           format: date
 *         startAt:
 *           type: string
 *           format: date-time
 *         endExclusive:
 *           type: string
 *           format: date-time
 *         userPolicy:
 *           type: string
 *         coinPoolDefinition:
 *           type: string
 *         adFundingDefinition:
 *           type: string
 *         coverage:
 *           type: object
 *           properties:
 *             historicalLedger:
 *               type: string
 *             coverageStart:
 *               type: string
 *               nullable: true
 *             reason:
 *               type: string
 *         historicalStocks:
 *           $ref: "#/components/schemas/InternalMetric"
 *         users:
 *           type: object
 *           properties:
 *             total:
 *               $ref: "#/components/schemas/InternalMetric"
 *             periodRegistrations:
 *               $ref: "#/components/schemas/InternalMetric"
 *         coins:
 *           type: object
 *           properties:
 *             unclaimed:
 *               $ref: "#/components/schemas/InternalMetric"
 *             available:
 *               $ref: "#/components/schemas/InternalMetric"
 *             reserved:
 *               $ref: "#/components/schemas/InternalMetric"
 *             recordedAvailable:
 *               $ref: "#/components/schemas/InternalMetric"
 *             pendingExpiry:
 *               $ref: "#/components/schemas/InternalMetric"
 *             recordedNetConsumed:
 *               $ref: "#/components/schemas/InternalMetric"
 *             recordedExpired:
 *               $ref: "#/components/schemas/InternalMetric"
 *             platformAdvanceOutstanding:
 *               $ref: "#/components/schemas/InternalMetric"
 *             platformAdvanceTwd:
 *               $ref: "#/components/schemas/InternalMetric"
 *             platformPromotionalExpense:
 *               $ref: "#/components/schemas/InternalMetric"
 *             sellerFundingAvailable:
 *               $ref: "#/components/schemas/InternalMetric"
 *             outstandingPool:
 *               $ref: "#/components/schemas/InternalMetric"
 *             poolTwd:
 *               $ref: "#/components/schemas/InternalMetric"
 *             period:
 *               $ref: "#/components/schemas/InternalCoinFlows"
 *             reconciliation:
 *               type: object
 *               properties:
 *                 mismatchedUsers:
 *                   type: string
 *                 unclassifiedClaimableBoxes:
 *                   type: string
 *         advertisements:
 *           type: object
 *           properties:
 *             remainingBalance:
 *               $ref: "#/components/schemas/InternalMetric"
 *             recordedGrossViewSpend:
 *               $ref: "#/components/schemas/InternalMetric"
 *             settlementReturns:
 *               $ref: "#/components/schemas/InternalMetric"
 *             lifetimeRecorded:
 *               $ref: "#/components/schemas/InternalAdFlows"
 *             period:
 *               $ref: "#/components/schemas/InternalAdFlows"
 *         ratio:
 *           allOf:
 *             - $ref: "#/components/schemas/InternalMetric"
 *             - type: object
 *               properties:
 *                 coinToCurrencyRate:
 *                   type: string
 *                 rateBasis:
 *                   type: string
 *     InternalStatisticsTimeSeries:
 *       type: object
 *       properties:
 *         asOf:
 *           type: string
 *         timezone:
 *           type: string
 *           enum:
 *             - Asia/Taipei
 *         startDate:
 *           type: string
 *           format: date
 *         endDate:
 *           type: string
 *           format: date
 *         startAt:
 *           type: string
 *           format: date-time
 *         endExclusive:
 *           type: string
 *           format: date-time
 *         userPolicy:
 *           type: string
 *         coinPoolDefinition:
 *           type: string
 *         adFundingDefinition:
 *           type: string
 *         coverage:
 *           type: object
 *           properties:
 *             historicalLedger:
 *               type: string
 *             coverageStart:
 *               type: string
 *               nullable: true
 *             reason:
 *               type: string
 *         historicalStocks:
 *           $ref: "#/components/schemas/InternalMetric"
 *         dataset:
 *           type: string
 *           enum:
 *             - users
 *             - coin-flows
 *             - ad-finance
 *         points:
 *           type: array
 *           maxItems: 366
 *           items:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *               metrics:
 *                 oneOf:
 *                   - type: object
 *                     properties:
 *                       registrations:
 *                         $ref: "#/components/schemas/InternalMetric"
 *                   - $ref: "#/components/schemas/InternalCoinFlows"
 *                   - $ref: "#/components/schemas/InternalAdFlows"
 */
