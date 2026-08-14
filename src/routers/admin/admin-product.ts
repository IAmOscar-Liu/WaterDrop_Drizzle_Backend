import { Router } from "express";
import ProductController from "../../controller/product";
import isAuth from "../../middleware/isAuth";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";

const router = Router();
/**
 * @swagger
 * tags:
 *   name: Product
 *   description: Product management for administrators
 *
 * components:
 *   schemas:
 *     Category:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: The unique identifier for the category.
 *         name:
 *           type: string
 *           description: The name of the category.
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the category was created.
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the category was last updated.
 *
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         sellerId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         name:
 *           type: string
 *         avatar:
 *           type: string
 *           nullable: true
 *         description:
 *           type: string
 *         price:
 *           type: number
 *           format: double
 *           description: Minimum eligible variant price. Derived by the API; not independently writable.
 *         type:
 *           type: string
 *           enum: [normal, refrigeration, virtual]
 *         allowHomeDelivery:
 *           type: boolean
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [active, inactive]
 *         metadata:
 *           type: object
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         availableStock:
 *           type: integer
 *           description: Calculated as active variant stock minus reserve.
 *
 *     ProductVariant:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         productId:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *           nullable: true
 *         sku:
 *           type: string
 *           nullable: true
 *         price:
 *           type: number
 *           format: double
 *           description: Current variant price.
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           nullable: true
 *         optionValues:
 *           type: object
 *           description: Free-form option map, for example color and size.
 *         stock:
 *           type: integer
 *         reserve:
 *           type: integer
 *         availableStock:
 *           type: integer
 *         sortOrder:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [active, inactive]
 *         metadata:
 *           type: object
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     ProductWithRelations:
 *       allOf:
 *         - $ref: '#/components/schemas/Product'
 *         - type: object
 *           properties:
 *             variants:
 *               type: array
 *               description: Admin responses include all variants, including inactive variants, so order/refund history can still resolve old variants.
 *               items:
 *                 $ref: '#/components/schemas/ProductVariant'
 *             advertisement:
 *               $ref: '#/components/schemas/Advertisement'
 *               nullable: true
 *             productsToCategories:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   productId:
 *                     type: string
 *                     format: uuid
 *                   categoryId:
 *                     type: string
 *                     format: uuid
 *                   category:
 *                     $ref: '#/components/schemas/Category'
 *
 *     ListProductsResponse:
 *       type: object
 *       properties:
 *         products:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProductWithRelations'
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
 * /api/admin/product/categories/list:
 *   get:
 *     tags: [Product]
 *     summary: List all product categories
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: A list of categories.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Category'
 */
router.get("/categories/list", isAuth, ProductController.listCategory);

/**
 * @swagger
 * /api/admin/product/categories/create:
 *   post:
 *     tags: [Product]
 *     summary: Create a new product category
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Electronics"
 *     responses:
 *       '200':
 *         description: The created category.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Category'
 */
router.post(
  "/categories/create",
  isAuth,
  validateZod({ body: adminValidation.product.categoryCreateBody }),
  ProductController.createCategory,
);

/**
 * @swagger
 * /api/admin/product/list:
 *   get:
 *     tags: [Product]
 *     summary: List products with filters and pagination
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
 *         name: categoryId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter products by their status.
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *     responses:
 *       '200':
 *         description: A paginated list of products.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ListProductsResponse'
 */
router.get(
  "/list",
  isAuth,
  validateZod({ query: adminValidation.product.listQuery }),
  ProductController.listAdminProducts,
);

/**
 * @swagger
 * /api/admin/product/{id}:
 *   get:
 *     tags: [Product]
 *     summary: Get a single product by ID
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
 *         description: The requested product.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ProductWithRelations'
 */
router.get(
  "/:id",
  isAuth,
  validateZod({ params: adminValidation.product.idParams }),
  ProductController.getProduct,
);

/**
 * @swagger
 * /api/admin/product/create:
 *   post:
 *     tags: [Product]
 *     summary: Create a new product
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             required:
 *               - sellerId
 *               - name
 *               - description
 *               - variants
 *             type: object
 *             description: Variants are required. Active variants must be either exactly one unnamed default variant, or at least two named variants. Inactive historical variants may remain. At most one unnamed default row may exist.
 *             properties:
 *               name:
 *                 type: string
 *                 example: "New Awesome Product"
 *               description:
 *                 type: string
 *                 example: "This product is really awesome."
 *               avatar:
 *                 type: string
 *                 example: "http://example.com/avatar.png"
 *               variants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - price
 *                     - optionValues
 *                     - stock
 *                   properties:
 *                     name:
 *                       type: string
 *                       nullable: true
 *                       description: Null/omitted identifies the single default variant. It must be active in simple mode and absent or inactive while two or more named variants are active.
 *                       example: "Black / M"
 *                     sku:
 *                       type: string
 *                       nullable: true
 *                       example: "TS-BLK-M"
 *                     price:
 *                       type: number
 *                       format: double
 *                       example: 99.99
 *                     images:
 *                       type: array
 *                       items:
 *                         type: string
 *                       nullable: true
 *                     optionValues:
 *                       type: object
 *                       example:
 *                         color: "Black"
 *                         size: "M"
 *                     stock:
 *                       type: integer
 *                       example: 20
 *                     sortOrder:
 *                       type: integer
 *                       example: 0
 *                     status:
 *                       type: string
 *                       enum: [active, inactive]
 *                       default: active
 *                     metadata:
 *                       type: object
 *                       nullable: true
 *               type:
 *                 type: string
 *                 enum: [normal, refrigeration, virtual]
 *                 default: "normal"
 *               allowHomeDelivery:
 *                 type: boolean
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["http://example.com/img1.png"]
 *               categoryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 example: ["c4e1b8d8-3d2e-4b1a-9c8f-2a3d4e5f6g7h"]
 *               sellerId:
 *                 type: string
 *                 format: uuid
 *                 description: The ID of the seller account.
 *                 example: "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6"
 *               status:
 *                 type: string
 *                 description: The status of the product.
 *                 default: "active"
 *                 example: "active"
 *               metadata:
 *                 type: object
 *                 description: Additional metadata for the product.
 *                 example:
 *                   weight: "2kg"
 *     responses:
 *       '200':
 *         description: The created product.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ProductWithRelations'
 */
router.post(
  "/create",
  isAuth,
  validateZod({ body: adminValidation.product.createBody }),
  ProductController.createProduct,
);

/**
 * @swagger
 * /api/admin/product/{id}:
 *   put:
 *     tags: [Product]
 *     summary: Update an existing product
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               avatar:
 *                 type: string
 *                 example: "http://example.com/avatar.png"
 *               variants:
 *                 type: array
 *                 description: Create or update variants. If id is provided, the existing variant is updated; otherwise a new variant is created. Variants are not deleted; set status to inactive. Active variants must be either exactly one unnamed default variant, or at least two named variants. Inactive historical variants may remain.
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                       description: Existing variant id. Omit to create a new variant.
 *                     name:
 *                       type: string
 *                       nullable: true
 *                       description: Null/omitted identifies the single default variant. It must be active in simple mode and absent or inactive while two or more named variants are active.
 *                     sku:
 *                       type: string
 *                       nullable: true
 *                     price:
 *                       type: number
 *                       format: double
 *                       description: Required when creating a variant; optional for an existing variant update.
 *                     images:
 *                       type: array
 *                       items:
 *                         type: string
 *                       nullable: true
 *                     optionValues:
 *                       type: object
 *                     stock:
 *                       type: integer
 *                     sortOrder:
 *                       type: integer
 *                     status:
 *                       type: string
 *                       enum: [active, inactive]
 *                     metadata:
 *                       type: object
 *                       nullable: true
 *               type:
 *                 type: string
 *                 enum: [normal, refrigeration, virtual]
 *               allowHomeDelivery:
 *                 type: boolean
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *               categoryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               status:
 *                 type: string
 *                 description: The status of the product.
 *                 example: "inactive"
 *               metadata:
 *                 type: object
 *                 description: Additional metadata for the product.
 *                 example:
 *                   weight: "2.1kg"
 *                   dimensions: "10x10x10 cm"
 *               sellerId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: The updated product.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ProductWithRelations'
 */
router.put(
  "/:id",
  isAuth,
  validateZod({
    params: adminValidation.product.idParams,
    body: adminValidation.product.updateBody,
  }),
  ProductController.updateProduct,
);

/**
 * @swagger
 * /api/admin/product/{id}/sales-summary:
 *   get:
 *     tags: [Product]
 *     summary: Get sales summary for a product
 *     description: Retrieves the total quantity sold and total revenue for a specific product from 'paid' orders, with an optional date range filter.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the product.
 *       - in: query
 *         name: startAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional start date (ISO 8601 format) to filter sales data.
 *       - in: query
 *         name: endAt
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional end date (ISO 8601 format) to filter sales data.
 *     responses:
 *       '200':
 *         description: The product and its sales summary.
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
 *                     product:
 *                       $ref: '#/components/schemas/Product'
 *                     stats:
 *                       type: object
 *                       properties:
 *                         startAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                         endAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                         totalQuantity:
 *                           type: integer
 *                         totalRevenue:
 *                           type: number
 */
router.get(
  "/:id/sales-summary",
  isAuth,
  validateZod({
    params: adminValidation.product.idParams,
    query: adminValidation.product.salesSummaryQuery,
  }),
  ProductController.getProductSalesSummary,
);

export default router;
