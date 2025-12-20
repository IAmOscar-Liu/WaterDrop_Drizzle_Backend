import { Router } from "express";
import ProductController from "../../controller/product";
import isAuth from "../../middleware/isAuth";

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
 *         stock:
 *           type: integer
 *         reserve:
 *           type: integer
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           nullable: true
 *         status:
 *           type: string
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
router.post("/categories/create", isAuth, ProductController.createCategory);

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
router.get("/list", isAuth, ProductController.listAdminProducts);

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
router.get("/:id", isAuth, ProductController.getProduct);

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
 *               - price
 *               - stock
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "New Awesome Product"
 *               description:
 *                 type: string
 *                 example: "This product is really awesome."
 *               price:
 *                 type: number
 *                 example: 99.99
 *               stock:
 *                 type: integer
 *                 example: 100
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
router.post("/create", isAuth, ProductController.createProduct);

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
 *               price:
 *                 type: number
 *               stock:
 *                 type: integer
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
router.put("/:id", isAuth, ProductController.updateProduct);

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
  ProductController.getProductSalesSummary
);

export default router;
