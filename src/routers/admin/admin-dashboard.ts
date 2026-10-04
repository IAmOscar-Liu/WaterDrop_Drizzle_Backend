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
 *   description: Operational dashboards and separate company internal statistics
 * /api/admin/dashboard/kpi:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get operational dashboard KPI totals
 *     description: Sellers are scoped to themselves; employees inherit their parent seller; platform admins may supply sellerId or omit it for platform totals. Company statistics use /kpi/internal.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: timezone, schema: { type: string, default: Asia/Taipei } }
 *     responses:
 *       '200': { description: Existing orders, GMV, refunds, net sales, pending work, ad spend/status, and wallet balance response. }
 *       '400': { description: Invalid filters. Internal report/date/dataset parameters are not accepted here. }
 */
router.get("/kpi", isAuth, validateZod({ query: adminValidation.dashboard.kpiQuery }), DashboardController.kpi);

/**
 * @swagger
 * /api/admin/dashboard/time-series:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get an operational dashboard time series
 *     description: Existing seller-scoped operational series. Company statistics use /time-series/internal.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: metric, required: true, schema: { type: string, enum: [sales, orders, refunds, adViews, adSpend] } }
 *       - { in: query, name: interval, schema: { type: string, enum: [day, week, month], default: day } }
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: timezone, schema: { type: string, default: Asia/Taipei } }
 *     responses:
 *       '200': { description: Existing ordered bucket/value response. }
 *       '400': { description: Invalid filters. Internal report/date/dataset parameters are not accepted here. }
 */
router.get("/time-series", isAuth, validateZod({ query: adminValidation.dashboard.timeSeriesQuery }), DashboardController.timeSeries);

/**
 * @swagger
 * /api/admin/dashboard/kpi/internal:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get company internal KPI statistics
 *     description: Active platform admins only. Fixed Asia/Taipei calendar days, maximum 366 days. Current stocks and ratio reflect asOf; historical stocks remain unavailable. Recorded flows include coverage metadata. Do not send report or operational dashboard filters.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: startDate, required: true, schema: { type: string, format: date }, description: Inclusive Taipei calendar start date. }
 *       - { in: query, name: endDate, required: true, schema: { type: string, format: date }, description: Inclusive Taipei calendar end date; queries end at exclusive next-day midnight. }
 *     responses:
 *       '200':
 *         description: Exact decimal/count strings with definitions and coverage metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/InternalStatisticsKpi' }
 *       '400': { description: Missing/invalid dates, range over 366 days, or unsupported query fields. }
 *       '401': { description: Authentication required. }
 *       '403': { description: Active platform admin required; sellers and employees are prohibited. }
 */
router.get("/kpi/internal", isAuth, validateZod({ query: adminValidation.dashboard.internalKpiQuery }), DashboardController.internalKpi);

/**
 * @swagger
 * /api/admin/dashboard/time-series/internal:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get company internal daily statistics
 *     description: Active platform admins only. Fixed Asia/Taipei calendar days, maximum 366 days. Current stocks and ratio reflect asOf; historical stocks remain unavailable. Recorded flows include coverage metadata. Do not send report or operational dashboard filters.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: startDate, required: true, schema: { type: string, format: date }, description: Inclusive Taipei calendar start date. }
 *       - { in: query, name: endDate, required: true, schema: { type: string, format: date }, description: Inclusive Taipei calendar end date; queries end at exclusive next-day midnight. }
 *       - { in: query, name: dataset, required: true, schema: { type: string, enum: [users, coin-flows, ad-finance] }, description: Daily registrations or recorded financial flows; unverified empty financial days return null. }
 *     responses:
 *       '200':
 *         description: Exact decimal/count strings with definitions and coverage metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/InternalStatisticsTimeSeries' }
 *       '400': { description: Missing/invalid dates, range over 366 days, or unsupported query fields. }
 *       '401': { description: Authentication required. }
 *       '403': { description: Active platform admin required; sellers and employees are prohibited. }
 */
router.get("/time-series/internal", isAuth, validateZod({ query: adminValidation.dashboard.internalTimeSeriesQuery }), DashboardController.internalTimeSeries);

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
