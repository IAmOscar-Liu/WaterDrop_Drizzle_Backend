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
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: timezone, schema: { type: string, default: Asia/Taipei } }
 *     responses:
 *       '200': { description: Orders, GMV, refunds, net sales, pending work, ad spend/status, and wallet balance. }
 */
router.get("/kpi", isAuth, validateZod({ query: adminValidation.dashboard.filtersQuery }), DashboardController.kpi);

/**
 * @swagger
 * /api/admin/dashboard/time-series:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get a dashboard time series
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: metric, required: true, schema: { type: string, enum: [sales, orders, refunds, adViews, adSpend] } }
 *       - { in: query, name: interval, schema: { type: string, enum: [day, week, month], default: day } }
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: startAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: endAt, schema: { type: string, format: date-time } }
 *       - { in: query, name: timezone, schema: { type: string, default: Asia/Taipei } }
 *     responses:
 *       '200': { description: Ordered bucket/value points. }
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
