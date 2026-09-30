import { Router } from "express";
import AdvertisementController from "../controller/advertisement";
import isAuth from "../middleware/isAuth";

const router = Router();

/**
 * @swagger
 * /api/advertisement/list:
 *   get:
 *     tags: [Advertisement]
 *     summary: List advertisements available to the authenticated app user
 *     description: Each returned advertisement is assigned to the user for the user's current local date. Repeated requests reuse the same user/advertisement/date assignment. Archived advertisements disappear from new lists immediately.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *     responses:
 *       '200':
 *         description: A paginated list of advertisements assigned to the user.
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
 *                     advertisements:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/AdvertisementWithProduct'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *             example:
 *               success: true
 *               data:
 *                 advertisements:
 *                   - id: 22222222-2222-4222-8222-222222222222
 *                     productId: 88888888-8888-4888-8888-888888888888
 *                     title: Product introduction
 *                     description: Watch this product video
 *                     video_url: https://example.com/ad.mp4
 *                     archivedAt: null
 *                     archiveGraceEndsAt: null
 *                     financiallyClosedAt: null
 *                     replacementOfAdvertisementId: null
 *                     createdAt: "2026-09-13T01:00:00.000Z"
 *                     updatedAt: "2026-09-13T01:00:00.000Z"
 *                     product:
 *                       id: 88888888-8888-4888-8888-888888888888
 *                       name: Example product
 *                       description: Example product description
 *                       status: active
 *                       type: normal
 *                       price: 100
 *                       variants: []
 *                 total: 1
 *                 page: 1
 *                 limit: 10
 *                 totalPages: 1
 *       '401':
 *         description: Authentication required.
 *       '404':
 *         description: Authenticated user not found.
 */
router.get("/list", isAuth, AdvertisementController.listAdvertisements);

export default router;
