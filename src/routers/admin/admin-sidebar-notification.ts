import { Router } from "express";
import SidebarNotificationController from "../../controller/sidebarNotification";
import { adminValidation } from "../../middleware/admin";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Sidebar Notifications
 *   description: Per-account admin sidebar badges
 * /api/admin/sidebar-notifications/summary:
 *   get:
 *     tags: [Sidebar Notifications]
 *     summary: Get actionable and new-since-seen counts
 *     description: Read state belongs to the signed-in human account. Sellers/employees use their resolved seller scope; platform admins may supply sellerId or omit it for platform scope.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *     responses:
 *       '200': { description: Counts and lastSeenAt for orders, deliveries, refunds, advertisements, and chatrooms. }
 */
router.get(
  "/summary",
  isAuth,
  validateZod({ query: adminValidation.sidebarNotification.summaryQuery }),
  SidebarNotificationController.summary,
);

/**
 * @swagger
 * /api/admin/sidebar-notifications/{section}/seen:
 *   put:
 *     tags: [Sidebar Notifications]
 *     summary: Advance one sidebar section's seen time
 *     description: Monotonic and idempotent; an older seenAt cannot move the stored timestamp backward.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: section
 *         required: true
 *         schema: { type: string, enum: [orders, deliveries, refunds, advertisements, chatrooms] }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sellerId: { type: string, format: uuid, description: Platform-admin seller scope. }
 *               seenAt: { type: string, format: date-time, description: Defaults to server time. }
 *     responses:
 *       '200': { description: Stored read state. }
 */
router.put(
  "/:section/seen",
  isAuth,
  validateZod({
    params: adminValidation.sidebarNotification.sectionParams,
    body: adminValidation.sidebarNotification.seenBody,
  }),
  SidebarNotificationController.markSeen,
);

export default router;
