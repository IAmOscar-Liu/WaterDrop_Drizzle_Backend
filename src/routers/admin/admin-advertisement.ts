import { Router } from "express";
import AdvertisementController from "../../controller/advertisement";
import isAuth from "../../middleware/isAuth";

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
 *     AdvertisementWithProduct:
 *       allOf:
 *         - $ref: '#/components/schemas/Advertisement'
 *         - type: object
 *           properties:
 *             product:
 *               $ref: '#/components/schemas/Product'
 *
 *     ListAdvertisementsResponse:
 *       type: object
 *       properties:
 *         advertisements:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdvertisementWithProduct'
 *         total:
 *           type: integer
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         totalPages:
 *           type: integer
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
router.get("/list", isAuth, AdvertisementController.listAdminAdvertisements);

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
router.post("/create", isAuth, AdvertisementController.createAdvertisement);

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
router.put("/:id", isAuth, AdvertisementController.updateAdvertisement);

export default router;
