import { Router } from "express";
import isAuth from "../../middleware/isAuth";
import isAdmin from "../../middleware/isAdmin";
import validateZod from "../../middleware/validateZod";
import { adminValidation } from "../../middleware/admin";
import controller from "../../controller/sellerEarnings";
const router=Router();
const v=adminValidation.sellerEarnings;
router.get("/summary",isAuth,validateZod({query:v.query}),controller.summary);
router.get("/transactions",isAuth,validateZod({query:v.query}),controller.history);
router.get("/requests",isAuth,validateZod({query:v.requestQuery}),controller.requests);
router.post("/requests",isAuth,validateZod({body:v.request}),controller.create);
router.patch("/requests/:id",isAuth,validateZod({params:v.requestParams,body:v.review}),controller.review);
router.post("/:sellerId/adjustments",isAuth,isAdmin,validateZod({params:v.sellerParams,body:v.adjustment}),controller.adjust);
router.post("/:sellerId/shipping-subsidy-reversals",isAuth,isAdmin,validateZod({params:v.sellerParams,body:v.shippingReversal}),controller.reverseShipping);
export default router;

/**
 * @swagger
 * {
 *   "components": {
 *     "schemas": {
 *       "SellerRevenueSummary": {
 *         "type": "object",
 *         "properties": {
 *           "pendingCash": { "type": "string" },
 *           "pendingCoins": { "type": "string" },
 *           "releasedCash": { "type": "string" },
 *           "releasedCoins": { "type": "string" },
 *           "reservedCash": { "type": "string" },
 *           "reservedCoins": { "type": "string" },
 *           "retainedCashRemainder": { "type": "string" },
 *           "retainedCoinsRemainder": { "type": "string" },
 *           "cashBalance": {
 *             "type": "string"
 *           },
 *           "coinBalance": {
 *             "type": "string"
 *           },
 *           "pendingAmount": {
 *             "type": "string"
 *           },
 *           "releasedAmount": {
 *             "type": "string"
 *           },
 *           "reservedAmount": {
 *             "type": "string"
 *           },
 *           "withdrawableCash": {
 *             "type": "string"
 *           },
 *           "withdrawableCoins": {
 *             "type": "string"
 *           },
 *           "withdrawableAmount": {
 *             "type": "string"
 *           },
 *           "debt": {
 *             "type": "string"
 *           },
 *           "cashEarnings": {
 *             "type": "string"
 *           },
 *           "coinEarnings": {
 *             "type": "string"
 *           },
 *           "sellerId": {
 *             "type": "string",
 *             "format": "uuid"
 *           },
 *           "coverageStart": {
 *             "type": "string",
 *             "format": "date-time",
 *             "nullable": true
 *           },
 *           "startAt": {
 *             "type": "string",
 *             "format": "date-time",
 *             "nullable": true
 *           },
 *           "endAt": {
 *             "type": "string",
 *             "format": "date-time",
 *             "nullable": true
 *           },
 *           "asOf": {
 *             "type": "string",
 *             "format": "date-time",
 *             "nullable": true
 *           },
 *           "accountingWarnings": {
 *             "type": "array",
 *             "items": {
 *               "type": "object",
 *               "properties": {
 *                 "shipmentId": {
 *                   "type": "string",
 *                   "format": "uuid"
 *                 },
 *                 "orderId": {
 *                   "type": "string",
 *                   "format": "uuid"
 *                 }
 *               }
 *             }
 *           },
 *           "breakdown": {
 *             "type": "array",
 *             "items": {
 *               "type": "object",
 *               "properties": {
 *                 "type": {
 *                   "type": "string"
 *                 },
 *                 "cash": {
 *                   "type": "string"
 *                 },
 *                 "coinValue": {
 *                   "type": "string"
 *                 },
 *                 "grossCash": {
 *                   "type": "string"
 *                 },
 *                 "grossCoinValue": {
 *                   "type": "string"
 *                 },
 *                 "commissionCash": {
 *                   "type": "string"
 *                 },
 *                 "commissionCoinValue": {
 *                   "type": "string"
 *                 },
 *                 "extraRefundAmount": {
 *                   "type": "string"
 *                 }
 *               }
 *             }
 *           }
 *         }
 *       },
 *       "SellerRevenueEvent": {
 *         "type": "object",
 *         "properties": {
 *           "id": {
 *             "type": "string",
 *             "format": "uuid"
 *           },
 *           "sellerId": {
 *             "type": "string",
 *             "format": "uuid"
 *           },
 *           "eventKey": {
 *             "type": "string"
 *           },
 *           "type": {
 *             "type": "string"
 *           },
 *           "cash": {
 *             "type": "string"
 *           },
 *           "coinValue": {
 *             "type": "string"
 *           },
 *           "grossCash": {
 *             "type": "string"
 *           },
 *           "grossCoinValue": {
 *             "type": "string"
 *           },
 *           "debtAfter": {
 *             "type": "string"
 *           },
 *           "detail": {
 *             "type": "object"
 *           },
 *           "createdAt": {
 *             "type": "string",
 *             "format": "date-time"
 *           }
 *         }
 *       },
 *       "SellerWalletRequest": {
 *         "type": "object",
 *         "properties": {
 *           "id": {
 *             "type": "string",
 *             "format": "uuid"
 *           },
 *           "sellerId": {
 *             "type": "string",
 *             "format": "uuid"
 *           },
 *           "wallet": {
 *             "type": "string"
 *           },
 *           "direction": {
 *             "type": "string"
 *           },
 *           "status": {
 *             "type": "string",
 *             "enum": [
 *               "pending",
 *               "processing",
 *               "completed",
 *               "cancelled",
 *               "rejected"
 *             ]
 *           },
 *           "requestedCash": {
 *             "type": "string"
 *           },
 *           "requestedCoins": {
 *             "type": "string"
 *           },
 *           "cash": {
 *             "type": "string"
 *           },
 *           "coins": {
 *             "type": "string"
 *           },
 *           "reason": {
 *             "type": "string",
 *             "nullable": true
 *           },
 *           "history": {
 *             "type": "array",
 *             "items": {
 *               "type": "object"
 *             }
 *           },
 *           "createdAt": {
 *             "type": "string",
 *             "format": "date-time"
 *           },
 *           "updatedAt": {
 *             "type": "string",
 *             "format": "date-time"
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "/api/admin/seller-earnings/summary": {
 *     "get": {
 *       "tags": [
 *         "Seller Earnings"
 *       ],
 *       "summary": "Seller revenue balances and period earnings",
 *       "description": "Sellers read themselves; admins must provide sellerId; employees denied. Inclusive date bounds filter historical earnings only; omitted bounds mean lifetime since launch. Balances are current. Cash and coins remain separate; internal coinValue fields elsewhere are TWD equivalents. Revenue is gross before commission; withdrawable amounts already exclude fees, debt, pending funds and reservations.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "parameters": [
 *         {
 *           "name": "sellerId",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "string",
 *             "format": "uuid"
 *           }
 *         },
 *         {
 *           "name": "page",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "default": 1
 *           }
 *         },
 *         {
 *           "name": "limit",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "maximum": 100,
 *             "default": 20
 *           }
 *         },
 *         {
 *           "name": "startAt",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "string",
 *             "format": "date-time"
 *           }
 *         },
 *         {
 *           "name": "endAt",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "string",
 *             "format": "date-time"
 *           }
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Successful operation",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "success": {
 *                     "type": "boolean"
 *                   },
 *                   "data": {
 *                     "$ref": "#/components/schemas/SellerRevenueSummary"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input or attempt to increase reviewed amounts"
 *         },
 *         "403": {
 *           "description": "Seller scope or role denied"
 *         },
 *         "409": {
 *           "description": "Insufficient available funds, debt, terminal state or idempotency conflict"
 *         }
 *       }
 *     }
 *   },
 *   "/api/admin/seller-earnings/transactions": {
 *     "get": {
 *       "tags": [
 *         "Seller Earnings"
 *       ],
 *       "summary": "Seller revenue history",
 *       "description": "Same seller scope. Inclusive startAt/endAt; newest first. Types include sale, refund, shipping, adjustment, release, withdrawal. Release changes availability only. coinValue/grossCoinValue are TWD equivalents; multiply by ten for coins.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "parameters": [
 *         {
 *           "name": "sellerId",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "string",
 *             "format": "uuid"
 *           }
 *         },
 *         {
 *           "name": "page",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "default": 1
 *           }
 *         },
 *         {
 *           "name": "limit",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "maximum": 100,
 *             "default": 20
 *           }
 *         },
 *         {
 *           "name": "startAt",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "string",
 *             "format": "date-time"
 *           }
 *         },
 *         {
 *           "name": "endAt",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "string",
 *             "format": "date-time"
 *           }
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Successful operation",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "success": {
 *                     "type": "boolean"
 *                   },
 *                   "data": {
 *                     "type": "object",
 *                     "properties": {
 *                       "transactions": {
 *                         "type": "array",
 *                         "items": {
 *                           "$ref": "#/components/schemas/SellerRevenueEvent"
 *                         }
 *                       },
 *                       "page": {
 *                         "type": "integer"
 *                       },
 *                       "limit": {
 *                         "type": "integer"
 *                       },
 *                       "total": {
 *                         "type": "integer"
 *                       },
 *                       "totalPages": {
 *                         "type": "integer"
 *                       }
 *                     }
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input or attempt to increase reviewed amounts"
 *         },
 *         "403": {
 *           "description": "Seller scope or role denied"
 *         },
 *         "409": {
 *           "description": "Insufficient available funds, debt, terminal state or idempotency conflict"
 *         }
 *       }
 *     }
 *   },
 *   "/api/admin/seller-earnings/requests": {
 *     "get": {
 *       "tags": [
 *         "Seller Earnings"
 *       ],
 *       "summary": "Wallet request history",
 *       "description": "Admins may omit sellerId to list requests across all sellers, or provide sellerId to filter one seller. Sellers read only their own requests and cannot select another seller; employees denied. Omit status to include all statuses; omit wallet to include both advertising and revenue wallets. Filters combine. Results are paginated, newest first.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "parameters": [
 *         {
 *           "name": "sellerId",
 *           "in": "query",
 *           "required": false,
 *           "description": "Optional seller filter. Admins default to all sellers; sellers default to themselves.",
 *           "schema": {
 *             "type": "string",
 *             "format": "uuid"
 *           }
 *         },
 *         {
 *           "name": "wallet",
 *           "in": "query",
 *           "required": false,
 *           "description": "Optional wallet type filter. Omit to include both wallet types.",
 *           "schema": {
 *             "type": "string",
 *             "enum": ["advertising", "revenue"]
 *           }
 *         },
 *         {
 *           "name": "page",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "default": 1
 *           }
 *         },
 *         {
 *           "name": "limit",
 *           "in": "query",
 *           "required": false,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "maximum": 100,
 *             "default": 20
 *           }
 *         },
 *         {
 *           "name": "status",
 *           "in": "query",
 *           "required": false,
 *           "description": "Optional status filter. Omit to include all statuses.",
 *           "schema": {
 *             "type": "string",
 *             "enum": [
 *               "pending",
 *               "processing",
 *               "completed",
 *               "cancelled",
 *               "rejected"
 *             ]
 *           }
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Successful operation",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "success": {
 *                     "type": "boolean"
 *                   },
 *                   "data": {
 *                     "type": "object",
 *                     "properties": {
 *                       "requests": {
 *                         "type": "array",
 *                         "items": {
 *                           "$ref": "#/components/schemas/SellerWalletRequest"
 *                         }
 *                       },
 *                       "page": {
 *                         "type": "integer"
 *                       },
 *                       "limit": {
 *                         "type": "integer"
 *                       },
 *                       "total": {
 *                         "type": "integer"
 *                       },
 *                       "totalPages": {
 *                         "type": "integer"
 *                       }
 *                     }
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input or attempt to increase reviewed amounts"
 *         },
 *         "403": {
 *           "description": "Seller scope or role denied"
 *         },
 *         "409": {
 *           "description": "Insufficient available funds, debt, terminal state or idempotency conflict"
 *         }
 *       }
 *     },
 *     "post": {
 *       "tags": [
 *         "Seller Earnings"
 *       ],
 *       "summary": "Seller initiates a deposit or withdrawal",
 *       "description": "Sellers only. Advertising wallet accepts cash deposits/withdrawals; revenue wallet accepts withdrawals only. Cash/coins default to zero; positive total required. Withdrawal cash must be whole TWD, coins multiples of ten. Deposits have at most two decimals. Withdrawal requests reserve spendable/released funds immediately. Debt blocks revenue withdrawals. Same idempotency key and payload replay safely.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "parameters": [],
 *       "responses": {
 *         "200": {
 *           "description": "Successful operation",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "success": {
 *                     "type": "boolean"
 *                   },
 *                   "data": {
 *                     "$ref": "#/components/schemas/SellerWalletRequest"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input or attempt to increase reviewed amounts"
 *         },
 *         "403": {
 *           "description": "Seller scope or role denied"
 *         },
 *         "409": {
 *           "description": "Insufficient available funds, debt, terminal state or idempotency conflict"
 *         }
 *       },
 *       "requestBody": {
 *         "required": true,
 *         "content": {
 *           "application/json": {
 *             "schema": {
 *               "type": "object",
 *               "properties": {
 *                 "wallet": {
 *                   "type": "string",
 *                   "enum": [
 *                     "advertising",
 *                     "revenue"
 *                   ]
 *                 },
 *                 "direction": {
 *                   "type": "string",
 *                   "enum": [
 *                     "deposit",
 *                     "withdrawal"
 *                   ]
 *                 },
 *                 "cash": {
 *                   "type": "string",
 *                   "pattern": "^(0|[1-9]\\d{0,11})(\\.\\d{1,2})?$",
 *                   "example": "500.00"
 *                 },
 *                 "coins": {
 *                   "type": "string",
 *                   "pattern": "^(0|[1-9]\\d{0,11})(\\.\\d{1,2})?$",
 *                   "example": "500.00"
 *                 },
 *                 "idempotencyKey": {
 *                   "type": "string",
 *                   "minLength": 8,
 *                   "maxLength": 120
 *                 },
 *                 "reason": {
 *                   "type": "string",
 *                   "maxLength": 2000
 *                 }
 *               },
 *               "required": [
 *                 "wallet",
 *                 "direction",
 *                 "idempotencyKey"
 *               ]
 *             }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "/api/admin/seller-earnings/requests/{id}": {
 *     "patch": {
 *       "tags": [
 *         "Seller Earnings"
 *       ],
 *       "summary": "Review or cancel a wallet request",
 *       "description": "Admins may only retain/reduce each component, never substitute currencies. Pending deposits complete only after external receipt; pending withdrawals move to processing before completion. Processing amounts are immutable; confirm external payout before completion. Seller may cancel own pending request only. Reject rather than complete zero amount. Reduction/cancellation/rejection releases unused withdrawal reservations. Completed deposit triggers eligible ad auto-refill after credit; refill failure does not reverse deposit.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "parameters": [
 *         {
 *           "name": "id",
 *           "in": "path",
 *           "required": true,
 *           "schema": {
 *             "type": "string",
 *             "format": "uuid"
 *           }
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Successful operation",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "success": {
 *                     "type": "boolean"
 *                   },
 *                   "data": {
 *                     "$ref": "#/components/schemas/SellerWalletRequest"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input or attempt to increase reviewed amounts"
 *         },
 *         "403": {
 *           "description": "Seller scope or role denied"
 *         },
 *         "409": {
 *           "description": "Insufficient available funds, debt, terminal state or idempotency conflict"
 *         }
 *       },
 *       "requestBody": {
 *         "required": true,
 *         "content": {
 *           "application/json": {
 *             "schema": {
 *               "type": "object",
 *               "properties": {
 *                 "action": {
 *                   "type": "string",
 *                   "enum": [
 *                     "processing",
 *                     "completed",
 *                     "cancelled",
 *                     "rejected"
 *                   ]
 *                 },
 *                 "cash": {
 *                   "type": "string",
 *                   "pattern": "^(0|[1-9]\\d{0,11})(\\.\\d{1,2})?$",
 *                   "example": "500.00"
 *                 },
 *                 "coins": {
 *                   "type": "string",
 *                   "pattern": "^(0|[1-9]\\d{0,11})(\\.\\d{1,2})?$",
 *                   "example": "500.00"
 *                 },
 *                 "reason": {
 *                   "type": "string",
 *                   "minLength": 1,
 *                   "maxLength": 2000
 *                 }
 *               },
 *               "required": [
 *                 "action",
 *                 "reason"
 *               ]
 *             }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "/api/admin/seller-earnings/{sellerId}/adjustments": {
 *     "post": {
 *       "tags": [
 *         "Seller Earnings"
 *       ],
 *       "summary": "Admin manual revenue adjustment",
 *       "description": "Admins only. Explicit cash/coin amounts with positive total; no bank transfer. Increase offsets debt first and releases remaining funds immediately. Decrease follows currency/release/debt priority and can cancel underfunded pending requests. Processing reservations protected. No commission, no changes to historical sales earnings. Same key/payload replays safely.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "parameters": [
 *         {
 *           "name": "sellerId",
 *           "in": "path",
 *           "required": true,
 *           "schema": {
 *             "type": "string",
 *             "format": "uuid"
 *           }
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Successful operation",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "success": {
 *                     "type": "boolean"
 *                   },
 *                   "data": {
 *                     "$ref": "#/components/schemas/SellerRevenueEvent"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input or attempt to increase reviewed amounts"
 *         },
 *         "403": {
 *           "description": "Seller scope or role denied"
 *         },
 *         "409": {
 *           "description": "Insufficient available funds, debt, terminal state or idempotency conflict"
 *         }
 *       },
 *       "requestBody": {
 *         "required": true,
 *         "content": {
 *           "application/json": {
 *             "schema": {
 *               "type": "object",
 *               "properties": {
 *                 "direction": {
 *                   "type": "string",
 *                   "enum": [
 *                     "increase",
 *                     "decrease"
 *                   ]
 *                 },
 *                 "cash": {
 *                   "type": "string",
 *                   "pattern": "^(0|[1-9]\\d{0,11})(\\.\\d{1,2})?$",
 *                   "example": "500.00"
 *                 },
 *                 "coins": {
 *                   "type": "string",
 *                   "pattern": "^(0|[1-9]\\d{0,11})(\\.\\d{1,2})?$",
 *                   "example": "500.00"
 *                 },
 *                 "reason": {
 *                   "type": "string",
 *                   "minLength": 1,
 *                   "maxLength": 2000
 *                 },
 *                 "idempotencyKey": {
 *                   "type": "string",
 *                   "minLength": 8,
 *                   "maxLength": 120
 *                 }
 *               },
 *               "required": [
 *                 "direction",
 *                 "reason",
 *                 "idempotencyKey"
 *               ]
 *             }
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 */

/**
 * @swagger
 * /api/admin/seller-earnings/{sellerId}/shipping-subsidy-reversals:
 *   post:
 *     tags: [Seller Earnings]
 *     summary: Reverse a cancelled shipment subsidy after admin confirms no cost
 *     description: Admin only. Every item in the original CVS shipment must belong to a cancelled delivery. Requires externally checked no-cost evidence; cancellation alone is insufficient. Returns the recorded subsidy once per shipment, no commission or sales earnings. Preserves the original hold/released state. Repeated requests return the same event.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: sellerId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shipmentId, evidence]
 *             properties:
 *               shipmentId: { type: string, format: uuid }
 *               evidence: { type: string, minLength: 1, maxLength: 2000 }
 *     responses:
 *       '200': { description: Original subsidy reversed once; data is SellerRevenueEvent }
 *       '403': { description: Admin required }
 *       '409': { description: No recorded subsidy or the entire shipment is not cancelled }
 */
