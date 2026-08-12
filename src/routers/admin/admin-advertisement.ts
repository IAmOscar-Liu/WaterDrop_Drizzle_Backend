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
 *         type:
 *           type: string
 *           enum: [deposit]
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

export default router;
