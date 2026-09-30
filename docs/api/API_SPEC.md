# 後端 API 規格文檔

本 API 系統為賣家/管理員後台提供完整的商品、訂單、廣告、客服等管理功能。

### 基礎資訊

- **Base URL**: `http://localhost:3001/api` (開發環境)
- **Content-Type**: `application/json`
- **認證方式**: JWT (JSON Web Token)
- **編碼**: UTF-8

---

## 認證機制

### JWT Token 說明

本系統使用 JWT 進行身份驗證，包含兩種 token：

1. **Access Token** (短期)
   - 有效期：15 分鐘
   - 用途：API 請求認證
   - 放置位置：HTTP Header `Authorization: Bearer <access_token>`

2. **Refresh Token** (長期)
   - 有效期：7 天
   - 用途：刷新 Access Token
   - 儲存位置：資料庫 `account_tokens` 表格

### Token 使用流程

```
1. 用戶登入 → 取得 access_token + refresh_token
2. 使用 access_token 呼叫 API
3. access_token 過期 → 使用 refresh_token 刷新
4. 取得新的 access_token + refresh_token
5. 登出 → 撤銷 refresh_token
```

### 需要認證的 API

除了以下端點外，所有 API 都需要在 Header 中帶入 Access Token：

```
POST /api/accounts/login      # 登入（不需要認證）
POST /api/accounts/refresh    # 刷新 Token（使用 refresh_token）
```

### 認證 Header 格式

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 通用規範

### 請求格式

- **Content-Type**: `application/json`
- **編碼**: UTF-8
- **日期時間格式**: ISO 8601 (`2025-10-13T10:30:00.000Z`)

### 回應格式

所有 API 回應均遵循以下格式：

#### 成功回應

```json
{
  "success": true,
  "data": { /* 實際資料 */ },
  "message": "操作成功",
  "pagination": {  // 可選，僅列表 API
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### 錯誤回應

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "驗證失敗",
    "details": [
      {
        "field": "email",
        "message": "Email 格式不正確"
      }
    ]
  }
}
```

### 分頁參數

所有列表 API 支援以下分頁參數：

| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `page` | number | 1 | 頁碼（從 1 開始） |
| `limit` | number | 20 | 每頁筆數（最大 100） |

### 排序參數

| 參數 | 類型 | 說明 | 範例 |
|------|------|------|------|
| `sort_by` | string | 排序欄位 | `created_at` |
| `sort_order` | string | 排序方向 | `asc` 或 `desc` |

### 日期篩選參數

| 參數 | 類型 | 格式 | 說明 |
|------|------|------|------|
| `start_date` | string | ISO 8601 | 起始日期 |
| `end_date` | string | ISO 8601 | 結束日期 |

---

## 錯誤碼說明

### HTTP 狀態碼

| 狀態碼 | 說明 |
|--------|------|
| 200 | 請求成功 |
| 201 | 資源建立成功 |
| 204 | 刪除成功（無內容返回） |
| 400 | 請求參數錯誤 |
| 401 | 未授權（Token 無效或過期） |
| 403 | 禁止訪問（權限不足） |
| 404 | 資源不存在 |
| 409 | 衝突（如重複的 Email） |
| 422 | 驗證失敗 |
| 500 | 伺服器內部錯誤 |

### 業務錯誤碼

| 錯誤碼 | 說明 |
|--------|------|
| `VALIDATION_ERROR` | 資料驗證錯誤 |
| `AUTHENTICATION_FAILED` | 認證失敗（帳號或密碼錯誤） |
| `TOKEN_EXPIRED` | Token 已過期 |
| `TOKEN_INVALID` | Token 無效 |
| `PERMISSION_DENIED` | 權限不足 |
| `RESOURCE_NOT_FOUND` | 資源不存在 |
| `DUPLICATE_ENTRY` | 資料重複（如 Email 已存在） |
| `INSUFFICIENT_STOCK` | 庫存不足 |
| `INVALID_STATUS_TRANSITION` | 無效的狀態轉換 |

---

## API 端點

---

## 一、身份驗證 API

### 1.1 登入

**端點**: `POST /api/accounts/login`

**描述**: 賣家/管理員登入，取得 Access Token 和 Refresh Token

**請求 Header**: 無需認證

**請求 Body**:

```json
{
  "email": "seller@example.com",
  "password": "SecurePass123"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| email | string | ✅ | 帳號 Email |
| password | string | ✅ | 密碼（6-50 字元） |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
    "token_type": "Bearer",
    "expires_in": 900,
    "account": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "seller@example.com",
      "name": "張小賣",
      "role": "seller",
      "phone": "0912345678",
      "address": "台北市信義區",
      "created_at": "2025-01-01T00:00:00.000Z",
      "last_login_at": "2025-10-13T10:30:00.000Z"
    }
  },
  "message": "登入成功"
}
```

**錯誤回應** (401):

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Email 或密碼錯誤"
  }
}
```

---

### 1.2 刷新 Token

**端點**: `POST /api/accounts/refresh`

**描述**: 使用 Refresh Token 取得新的 Access Token

**請求 Header**: 無需認證

**請求 Body**:

```json
{
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
}
```

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "bmV3IHJlZnJlc2ggdG9rZW4gaGVyZQ...",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

**錯誤回應** (401):

```json
{
  "success": false,
  "error": {
    "code": "TOKEN_INVALID",
    "message": "Refresh Token 無效或已被撤銷"
  }
}
```

---

### 1.3 登出

**端點**: `POST /api/accounts/logout`

**描述**: 登出並撤銷 Refresh Token

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
}
```

**成功回應** (200):

```json
{
  "success": true,
  "message": "登出成功"
}
```

---

### 1.4 取得當前帳號資訊

**端點**: `GET /api/accounts/me`

**描述**: 取得當前登入帳號的詳細資訊

**請求 Header**: 需要 Access Token

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "seller@example.com",
    "name": "張小賣",
    "role": "seller",
    "phone": "0912345678",
    "address": "台北市信義區",
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-10-13T10:30:00.000Z",
    "last_login_at": "2025-10-13T10:30:00.000Z"
  }
}
```

---

### 1.5 更新個人資料

**端點**: `PUT /api/accounts/me`

**描述**: 更新當前帳號的個人資料

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "name": "張小賣",
  "phone": "0912345678",
  "address": "台北市信義區忠孝東路 100 號"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| name | string | ❌ | 姓名 |
| phone | string | ❌ | 電話 |
| address | string | ❌ | 地址 |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "seller@example.com",
    "name": "張小賣",
    "role": "seller",
    "phone": "0912345678",
    "address": "台北市信義區忠孝東路 100 號",
    "updated_at": "2025-10-13T10:35:00.000Z"
  },
  "message": "資料更新成功"
}
```

---

### 1.6 修改密碼

**端點**: `PUT /api/accounts/me/password`

**描述**: 修改當前帳號密碼

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "old_password": "OldPass123",
  "new_password": "NewSecurePass456"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| old_password | string | ✅ | 舊密碼 |
| new_password | string | ✅ | 新密碼（6-50 字元） |

**成功回應** (200):

```json
{
  "success": true,
  "message": "密碼修改成功，請重新登入"
}
```

**錯誤回應** (401):

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "舊密碼不正確"
  }
}
```

---

## 二、商品管理 API

### 2.1 取得商品列表

**端點**: `GET /api/products`

**描述**: 取得商品列表（支援分頁、篩選、搜尋、排序）

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| search | string | ❌ | - | 搜尋關鍵字（商品名稱或 SKU） |
| status | string | ❌ | - | 狀態篩選：`active`, `draft`, `archived` |
| category_id | string | ❌ | - | 分類 ID |
| min_price | number | ❌ | - | 最低價格 |
| max_price | number | ❌ | - | 最高價格 |
| min_stock | number | ❌ | - | 最低庫存 |
| max_stock | number | ❌ | - | 最高庫存 |
| sort_by | string | ❌ | created_at | 排序欄位：`name`, `price`, `stock`, `created_at` |
| sort_order | string | ❌ | desc | 排序方向：`asc`, `desc` |

**範例請求**:

```
GET /api/products?page=1&limit=20&status=active&search=手機&sort_by=price&sort_order=asc
```

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "prod-001",
      "seller_id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "iPhone 15 Pro",
      "avatar": "https://cdn.example.com/products/iphone15.jpg",
      "description": "最新款 iPhone，搭載 A17 Pro 晶片",
      "price": 35900,
      "stock": 50,
      "images": [
        "https://cdn.example.com/products/iphone15-1.jpg",
        "https://cdn.example.com/products/iphone15-2.jpg"
      ],
      "status": "active",
      "categories": [
        {
          "id": "cat-001",
          "name": "手機"
        }
      ],
      "metadata": {
        "sku": "IPH15-PRO-128-BLK"
      },
      "created_at": "2025-09-01T10:00:00.000Z",
      "updated_at": "2025-10-13T08:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

### 2.2 取得單一商品詳情

**端點**: `GET /api/products/:id`

**描述**: 取得商品詳細資訊

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| id | string | 商品 ID |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "prod-001",
    "seller_id": "550e8400-e29b-41d4-a716-446655440000",
    "seller_name": "張小賣",
    "name": "iPhone 15 Pro",
    "avatar": "https://cdn.example.com/products/iphone15.jpg",
    "description": "最新款 iPhone，搭載 A17 Pro 晶片，支援 5G 網路",
    "price": 35900,
    "stock": 50,
    "images": [
      "https://cdn.example.com/products/iphone15-1.jpg",
      "https://cdn.example.com/products/iphone15-2.jpg",
      "https://cdn.example.com/products/iphone15-3.jpg"
    ],
    "status": "active",
    "categories": [
      {
        "id": "cat-001",
        "name": "手機"
      },
      {
        "id": "cat-002",
        "name": "3C 產品"
      }
    ],
    "metadata": {
      "sku": "IPH15-PRO-128-BLK",
      "weight": 206,
      "dimensions": "146.6 x 70.6 x 8.25 mm"
    },
    "stats": {
      "total_views": 1250,
      "total_sales": 35,
      "average_rating": 4.8
    },
    "created_at": "2025-09-01T10:00:00.000Z",
    "updated_at": "2025-10-13T08:00:00.000Z"
  }
}
```

**錯誤回應** (404):

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "商品不存在"
  }
}
```

---

### 2.3 新增商品

**端點**: `POST /api/products`

**描述**: 建立新商品

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "name": "iPhone 15 Pro",
  "avatar": "https://cdn.example.com/products/iphone15.jpg",
  "description": "最新款 iPhone，搭載 A17 Pro 晶片",
  "price": 35900,
  "stock": 50,
  "images": [
    "https://cdn.example.com/products/iphone15-1.jpg",
    "https://cdn.example.com/products/iphone15-2.jpg"
  ],
  "status": "active",
  "category_ids": ["cat-001", "cat-002"],
  "metadata": {
    "sku": "IPH15-PRO-128-BLK",
    "weight": 206
  }
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| name | string | ✅ | 商品名稱 |
| avatar | string | ❌ | 商品縮圖 URL |
| description | string | ✅ | 商品描述 |
| price | number | ✅ | 售價（必須 > 0） |
| stock | integer | ✅ | 庫存數量（必須 >= 0） |
| images | string[] | ❌ | 商品圖片 URL 陣列 |
| status | string | ❌ | 狀態：`draft`（草稿）, `active`（上架）, `archived`（下架） |
| category_ids | string[] | ❌ | 分類 ID 陣列 |
| metadata | object | ❌ | 額外資料（如 SKU、重量等） |

**成功回應** (201):

```json
{
  "success": true,
  "data": {
    "id": "prod-new-001",
    "seller_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "iPhone 15 Pro",
    "avatar": "https://cdn.example.com/products/iphone15.jpg",
    "description": "最新款 iPhone，搭載 A17 Pro 晶片",
    "price": 35900,
    "stock": 50,
    "images": [
      "https://cdn.example.com/products/iphone15-1.jpg",
      "https://cdn.example.com/products/iphone15-2.jpg"
    ],
    "status": "active",
    "metadata": {
      "sku": "IPH15-PRO-128-BLK",
      "weight": 206
    },
    "created_at": "2025-10-13T10:45:00.000Z",
    "updated_at": "2025-10-13T10:45:00.000Z"
  },
  "message": "商品建立成功"
}
```

**錯誤回應** (422):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "資料驗證失敗",
    "details": [
      {
        "field": "price",
        "message": "價格必須大於 0"
      },
      {
        "field": "stock",
        "message": "庫存不能為負數"
      }
    ]
  }
}
```

---

### 2.4 更新商品

**端點**: `PUT /api/products/:id`

**描述**: 更新商品資訊

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| id | string | 商品 ID |

**請求 Body**: 同 [2.3 新增商品](#23-新增商品)，所有欄位皆為選填

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "prod-001",
    "name": "iPhone 15 Pro Max",
    "price": 42900,
    "stock": 45,
    "updated_at": "2025-10-13T11:00:00.000Z"
  },
  "message": "商品更新成功"
}
```

---

### 2.5 刪除商品

**端點**: `DELETE /api/products/:id`

**描述**: 刪除商品（軟刪除，狀態改為 `archived`）

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| id | string | 商品 ID |

**成功回應** (200):

```json
{
  "success": true,
  "message": "商品已刪除"
}
```

---

### 2.6 更新商品狀態

**端點**: `PATCH /api/products/:id/status`

**描述**: 快速更新商品上下架狀態

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "status": "active"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| status | string | ✅ | `draft`, `active`, `archived` |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "prod-001",
    "status": "active",
    "updated_at": "2025-10-13T11:10:00.000Z"
  },
  "message": "商品狀態已更新"
}
```

---

### 2.7 批次更新商品狀態

**端點**: `PATCH /api/products/batch/status`

**描述**: 批次上下架商品

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "product_ids": ["prod-001", "prod-002", "prod-003"],
  "status": "active"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| product_ids | string[] | ✅ | 商品 ID 陣列 |
| status | string | ✅ | 目標狀態 |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "updated_count": 3,
    "product_ids": ["prod-001", "prod-002", "prod-003"]
  },
  "message": "批次更新成功"
}
```

---

### 2.8 批次刪除商品

**端點**: `DELETE /api/products/batch`

**描述**: 批次刪除商品

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "product_ids": ["prod-001", "prod-002", "prod-003"]
}
```

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "deleted_count": 3
  },
  "message": "批次刪除成功"
}
```

---

## 三、訂單管理 API

### 3.1 取得訂單列表

**端點**: `GET /api/orders`

**描述**: 取得訂單列表（支援分頁、篩選、搜尋）

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| status | string | ❌ | - | 訂單狀態：`pending`, `paid`, `failed` |
| user_email | string | ❌ | - | 用戶 Email 搜尋 |
| start_date | string | ❌ | - | 起始日期（ISO 8601） |
| end_date | string | ❌ | - | 結束日期（ISO 8601） |
| min_amount | number | ❌ | - | 最低金額 |
| max_amount | number | ❌ | - | 最高金額 |
| sort_by | string | ❌ | created_at | 排序欄位：`created_at`, `total_amount` |
| sort_order | string | ❌ | desc | 排序方向 |

**範例請求**:

```
GET /api/orders?page=1&limit=20&status=paid&start_date=2025-10-01T00:00:00.000Z
```

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "order-001",
      "user_id": "user-001",
      "user_email": "buyer@example.com",
      "user_name": "王小買",
      "account_id": "550e8400-e29b-41d4-a716-446655440000",
      "merchant_trade_no": "MTN20251013001",
      "total_amount": 45000,
      "discount_coin": 500,
      "final_amount": 44500,
      "order_status": "paid",
      "items_count": 2,
      "metadata": {
        "shipping_address": "台北市信義區忠孝東路 100 號"
      },
      "created_at": "2025-10-13T09:00:00.000Z",
      "updated_at": "2025-10-13T09:15:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 250,
    "totalPages": 13
  }
}
```

---

### 3.2 取得訂單詳情

**端點**: `GET /api/orders/:id`

**描述**: 取得訂單詳細資訊（含訂單項目）

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| id | string | 訂單 ID |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "order-001",
    "user_id": "user-001",
    "user_email": "buyer@example.com",
    "user_name": "王小買",
    "user_phone": "0987654321",
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "merchant_trade_no": "MTN20251013001",
    "total_amount": 45000,
    "discount_coin": 500,
    "final_amount": 44500,
    "order_status": "paid",
    "metadata": {
      "shipping_address": "台北市信義區忠孝東路 100 號",
      "shipping_name": "王小買",
      "shipping_phone": "0987654321",
      "payment_method": "credit_card"
    },
    "items": [
      {
        "id": "item-001",
        "order_id": "order-001",
        "product_id": "prod-001",
        "product_name_at_sale": "iPhone 15 Pro",
        "quantity": 1,
        "unit_price_at_sale": 35900,
        "line_total": 35900,
        "created_at": "2025-10-13T09:00:00.000Z"
      },
      {
        "id": "item-002",
        "order_id": "order-001",
        "product_id": "prod-002",
        "product_name_at_sale": "AirPods Pro 2",
        "quantity": 1,
        "unit_price_at_sale": 9100,
        "line_total": 9100,
        "created_at": "2025-10-13T09:00:00.000Z"
      }
    ],
    "delivery": {
      "id": "delivery-001",
      "logistics_type": "HOME",
      "logistics_sub_type": "TCAT",
      "tracking_number": "123456789",
      "status": "delivered"
    },
    "created_at": "2025-10-13T09:00:00.000Z",
    "updated_at": "2025-10-13T09:15:00.000Z"
  }
}
```

---

### 3.3 更新訂單狀態

**端點**: `PATCH /api/orders/:id/status`

**描述**: 更新訂單狀態

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "status": "paid"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| status | string | ✅ | `pending`, `paid`, `failed` |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "order-001",
    "order_status": "paid",
    "updated_at": "2025-10-13T09:20:00.000Z"
  },
  "message": "訂單狀態已更新"
}
```

---

### 3.4 訂單統計

**端點**: `GET /api/orders/stats`

**描述**: 取得訂單統計資料

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| start_date | string | ❌ | 起始日期 |
| end_date | string | ❌ | 結束日期 |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "total_orders": 1250,
    "total_revenue": 5680000,
    "average_order_value": 4544,
    "pending_orders": 35,
    "paid_orders": 1180,
    "failed_orders": 35,
    "today_orders": 42,
    "today_revenue": 185000,
    "coin_usage": {
      "total_coins_used": 125000,
      "total_discount_amount": 12500
    }
  }
}
```

---

## 四、物流管理 API

### 4.1 取得物流列表

**端點**: `GET /api/deliveries`

**描述**: 取得物流訂單列表

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| logistics_type | string | ❌ | - | 物流類型：`HOME`, `CVS` |
| logistics_sub_type | string | ❌ | - | 物流子類型：`TCAT`, `ECAN`, `POST` |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "delivery-001",
      "order_id": "order-001",
      "merchant_trade_no": "MTN20251013001",
      "all_pay_logistics_id": "APLID123456789",
      "logistics_type": "HOME",
      "logistics_sub_type": "TCAT",
      "rtn_code": "1",
      "rtn_msg": "SUCCESS",
      "goods_amount": 44500,
      "receiver_store_id": null,
      "metadata": {
        "tracking_number": "123456789",
        "receiver_name": "王小買",
        "receiver_phone": "0987654321",
        "receiver_address": "台北市信義區忠孝東路 100 號"
      },
      "created_at": "2025-10-13T09:20:00.000Z",
      "updated_at": "2025-10-13T09:20:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 80,
    "totalPages": 4
  }
}
```

---

### 4.2 取得物流詳情

**端點**: `GET /api/deliveries/:id`

**描述**: 取得物流訂單詳細資訊

**請求 Header**: 需要 Access Token

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "delivery-001",
    "order_id": "order-001",
    "merchant_trade_no": "MTN20251013001",
    "all_pay_logistics_id": "APLID123456789",
    "logistics_type": "HOME",
    "logistics_sub_type": "TCAT",
    "rtn_code": "1",
    "rtn_msg": "SUCCESS",
    "goods_amount": 44500,
    "receiver_store_id": null,
    "metadata": {
      "tracking_number": "123456789",
      "receiver_name": "王小買",
      "receiver_phone": "0987654321",
      "receiver_address": "台北市信義區忠孝東路 100 號",
      "shipping_status": "delivered",
      "shipping_history": [
        {
          "time": "2025-10-13T09:20:00.000Z",
          "status": "created",
          "message": "物流訂單已建立"
        },
        {
          "time": "2025-10-13T10:00:00.000Z",
          "status": "picked_up",
          "message": "商品已取件"
        },
        {
          "time": "2025-10-13T15:00:00.000Z",
          "status": "in_transit",
          "message": "商品運送中"
        },
        {
          "time": "2025-10-14T11:00:00.000Z",
          "status": "delivered",
          "message": "已送達"
        }
      ]
    },
    "created_at": "2025-10-13T09:20:00.000Z",
    "updated_at": "2025-10-14T11:00:00.000Z"
  }
}
```

---

### 4.3 建立物流訂單

**端點**: `POST /api/deliveries`

**描述**: 為訂單建立物流單

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "order_id": "order-001",
  "logistics_type": "HOME",
  "logistics_sub_type": "TCAT",
  "receiver_name": "王小買",
  "receiver_phone": "0987654321",
  "receiver_address": "台北市信義區忠孝東路 100 號"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| order_id | string | ✅ | 訂單 ID |
| logistics_type | string | ✅ | `HOME`（宅配）, `CVS`（超商取貨） |
| logistics_sub_type | string | ✅ | `TCAT`（黑貓）, `ECAN`（宅配通）, `POST`（郵局） |
| receiver_name | string | ✅ | 收件人姓名 |
| receiver_phone | string | ✅ | 收件人電話 |
| receiver_address | string | ✅ | 收件人地址（宅配必填） |
| receiver_store_id | string | ❌ | 超商店號（超商取貨必填） |

**成功回應** (201):

```json
{
  "success": true,
  "data": {
    "id": "delivery-001",
    "order_id": "order-001",
    "merchant_trade_no": "MTN20251013001",
    "logistics_type": "HOME",
    "logistics_sub_type": "TCAT",
    "created_at": "2025-10-13T09:20:00.000Z"
  },
  "message": "物流訂單建立成功"
}
```

---

### 4.4 根據訂單查詢物流

**端點**: `GET /api/deliveries/order/:order_id`

**描述**: 查詢訂單的物流資訊

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| order_id | string | 訂單 ID |

**成功回應** (200): 同 [4.2 取得物流詳情](#42-取得物流詳情)

---

## 五、廣告管理 API

### 5.1 取得廣告列表

**端點**: `GET /api/advertisements`

**描述**: 取得廣告列表

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| search | string | ❌ | - | 搜尋關鍵字（標題） |
| product_id | string | ❌ | - | 商品 ID |
| sort_by | string | ❌ | created_at | 排序欄位 |
| sort_order | string | ❌ | desc | 排序方向 |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "ad-001",
      "product_id": "prod-001",
      "product_name": "iPhone 15 Pro",
      "title": "全新 iPhone 15 Pro 震撼上市！",
      "description": "A17 Pro 晶片，效能再升級",
      "video_url": "https://cdn.example.com/videos/ad-iphone15.mp4",
      "stats": {
        "total_views": 12500,
        "today_views": 350
      },
      "created_at": "2025-09-15T10:00:00.000Z",
      "updated_at": "2025-10-13T08:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### 5.2 取得廣告詳情

**端點**: `GET /api/advertisements/:id`

**描述**: 取得廣告詳細資訊

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| id | string | 廣告 ID |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "ad-001",
    "product_id": "prod-001",
    "product": {
      "id": "prod-001",
      "name": "iPhone 15 Pro",
      "price": 35900,
      "avatar": "https://cdn.example.com/products/iphone15.jpg"
    },
    "title": "全新 iPhone 15 Pro 震撼上市！",
    "description": "A17 Pro 晶片，效能再升級，支援最新 5G 技術",
    "video_url": "https://cdn.example.com/videos/ad-iphone15.mp4",
    "created_at": "2025-09-15T10:00:00.000Z",
    "updated_at": "2025-10-13T08:00:00.000Z"
  }
}
```

---

### 5.3 建立廣告

**端點**: `POST /api/advertisements`

**描述**: 為商品建立廣告

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "product_id": "prod-001",
  "title": "全新 iPhone 15 Pro 震撼上市！",
  "description": "A17 Pro 晶片，效能再升級",
  "video_url": "https://cdn.example.com/videos/ad-iphone15.mp4"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| product_id | string | ✅ | 商品 ID（一個商品只能有一個廣告） |
| title | string | ✅ | 廣告標題 |
| description | string | ❌ | 廣告描述 |
| video_url | string | ✅ | 廣告影片 URL |

**成功回應** (201):

```json
{
  "success": true,
  "data": {
    "id": "ad-new-001",
    "product_id": "prod-001",
    "title": "全新 iPhone 15 Pro 震撼上市！",
    "description": "A17 Pro 晶片，效能再升級",
    "video_url": "https://cdn.example.com/videos/ad-iphone15.mp4",
    "created_at": "2025-10-13T11:30:00.000Z"
  },
  "message": "廣告建立成功"
}
```

**錯誤回應** (409):

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ENTRY",
    "message": "該商品已有廣告存在"
  }
}
```

---

### 5.4 更新廣告

**端點**: `PUT /api/advertisements/:id`

**描述**: 更新廣告資訊

**請求 Header**: 需要 Access Token

**請求 Body**: 同 [5.3 建立廣告](#53-建立廣告)，所有欄位皆為選填

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "ad-001",
    "title": "iPhone 15 Pro 限時優惠",
    "updated_at": "2025-10-13T11:40:00.000Z"
  },
  "message": "廣告更新成功"
}
```

---

### 5.5 刪除廣告

**端點**: `DELETE /api/advertisements/:id`

**描述**: 刪除廣告

**請求 Header**: 需要 Access Token

**路徑參數**:

| 參數 | 類型 | 說明 |
|------|------|------|
| id | string | 廣告 ID |

**成功回應** (200):

```json
{
  "success": true,
  "message": "廣告已刪除"
}
```

---

### 5.6 廣告統計

**端點**: `GET /api/advertisements/:id/stats`

**描述**: 取得廣告成效統計

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| start_date | string | ❌ | 起始日期 |
| end_date | string | ❌ | 結束日期 |
| group_by | string | ❌ | 分組方式：`day`, `week`, `month` |

**範例請求**:

```
GET /api/advertisements/ad-001/stats?start_date=2025-10-01T00:00:00.000Z&end_date=2025-10-13T23:59:59.999Z&group_by=day
```

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "advertisement_id": "ad-001",
    "product_id": "prod-001",
    "product_name": "iPhone 15 Pro",
    "summary": {
      "total_views": 12500,
      "unique_viewers": 8900,
      "average_watch_time": 15.5,
      "completion_rate": 0.68
    },
    "performance": {
      "subsequent_actions": {
        "purchases": 125,
        "add_to_cart": 450,
        "click_store": 1200,
        "comments": 85,
        "shares": 320,
        "none": 10320
      },
      "conversion_rate": 0.01,
      "purchase_conversion_rate": 0.01
    },
    "demographics": {
      "by_user_level": {
        "A0": 2500,
        "A1": 3200,
        "A2": 2800,
        "A3": 1900,
        "A4": 1200,
        "A5": 900
      },
      "by_region": {
        "台北市": 3500,
        "新北市": 2800,
        "台中市": 2100,
        "高雄市": 1900,
        "其他": 2200
      }
    },
    "timeline": [
      {
        "date": "2025-10-01",
        "views": 950,
        "purchases": 8,
        "add_to_cart": 35
      },
      {
        "date": "2025-10-02",
        "views": 1050,
        "purchases": 12,
        "add_to_cart": 42
      }
    ]
  }
}
```

---

## 六、客服聊天室 API

### 6.1 取得聊天室列表

**端點**: `GET /api/chat-rooms`

**描述**: 取得聊天室列表

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| has_unread | boolean | ❌ | - | 篩選有未讀訊息的聊天室 |
| user_email | string | ❌ | - | 用戶 Email 搜尋 |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "room-001",
      "user_id": "user-001",
      "user_email": "buyer@example.com",
      "user_name": "王小買",
      "account_id": "550e8400-e29b-41d4-a716-446655440000",
      "account_name": "張小賣",
      "product_id": "prod-001",
      "product_name": "iPhone 15 Pro",
      "unread_count": 3,
      "last_message": {
        "id": "msg-100",
        "sender_type": "user",
        "content": "請問這個商品還有現貨嗎？",
        "created_at": "2025-10-13T10:25:00.000Z"
      },
      "created_at": "2025-10-10T14:00:00.000Z",
      "updated_at": "2025-10-13T10:25:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### 6.2 取得聊天室詳情

**端點**: `GET /api/chat-rooms/:id`

**描述**: 取得聊天室詳細資訊（含用戶和商品資訊）

**請求 Header**: 需要 Access Token

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "room-001",
    "user": {
      "id": "user-001",
      "email": "buyer@example.com",
      "name": "王小買",
      "avatar_url": "https://cdn.example.com/avatars/user001.jpg"
    },
    "account": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "seller@example.com",
      "name": "張小賣",
      "role": "seller"
    },
    "product": {
      "id": "prod-001",
      "name": "iPhone 15 Pro",
      "price": 35900,
      "avatar": "https://cdn.example.com/products/iphone15.jpg"
    },
    "unread_count": 3,
    "created_at": "2025-10-10T14:00:00.000Z",
    "updated_at": "2025-10-13T10:25:00.000Z"
  }
}
```

---

### 6.3 取得聊天訊息

**端點**: `GET /api/chat-rooms/:id/messages`

**描述**: 取得聊天室的訊息記錄

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 50 | 每頁筆數 |
| before | string | ❌ | - | 取得此訊息 ID 之前的訊息 |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "msg-098",
      "chat_room_id": "room-001",
      "sender_type": "user",
      "content": "你好，請問這款手機有什麼顏色？",
      "is_read": true,
      "created_at": "2025-10-13T10:20:00.000Z"
    },
    {
      "id": "msg-099",
      "chat_room_id": "room-001",
      "sender_type": "seller",
      "content": "您好！目前有黑色、白色、藍色和原色四種顏色",
      "is_read": true,
      "created_at": "2025-10-13T10:22:00.000Z"
    },
    {
      "id": "msg-100",
      "chat_room_id": "room-001",
      "sender_type": "user",
      "content": "請問這個商品還有現貨嗎？",
      "is_read": false,
      "created_at": "2025-10-13T10:25:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 12,
    "totalPages": 1
  }
}
```

---

### 6.4 發送訊息

**端點**: `POST /api/chat-rooms/:id/messages`

**描述**: 在聊天室發送訊息

**請求 Header**: 需要 Access Token

**請求 Body**:

```json
{
  "content": "目前黑色和白色有現貨，其他顏色需要等 3-5 個工作天"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| content | string | ✅ | 訊息內容 |

**成功回應** (201):

```json
{
  "success": true,
  "data": {
    "id": "msg-101",
    "chat_room_id": "room-001",
    "sender_type": "seller",
    "content": "目前黑色和白色有現貨，其他顏色需要等 3-5 個工作天",
    "is_read": false,
    "created_at": "2025-10-13T10:30:00.000Z"
  },
  "message": "訊息發送成功"
}
```

---

### 6.5 標記訊息已讀

**端點**: `PATCH /api/chat-rooms/:id/messages/read`

**描述**: 標記聊天室所有訊息為已讀

**請求 Header**: 需要 Access Token

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "marked_count": 3
  },
  "message": "訊息已標記為已讀"
}
```

---

## 七、數據統計與報表 API

### 7.1 儀表板總覽

**端點**: `GET /api/dashboard/overview`

**描述**: 取得儀表板總覽數據

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| start_date | string | ❌ | 起始日期（預設今天） |
| end_date | string | ❌ | 結束日期（預設今天） |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "today": {
      "orders": 42,
      "revenue": 185000,
      "new_users": 28,
      "unread_messages": 15
    },
    "products": {
      "total": 350,
      "active": 280,
      "low_stock": 12,
      "out_of_stock": 5
    },
    "orders": {
      "total": 1250,
      "pending": 35,
      "paid": 1180,
      "failed": 35
    },
    "advertisements": {
      "total_ads": 45,
      "total_views": 125000,
      "today_views": 3500
    },
    "revenue": {
      "today": 185000,
      "this_week": 1250000,
      "this_month": 4850000,
      "total": 58600000
    },
    "top_products": [
      {
        "id": "prod-001",
        "name": "iPhone 15 Pro",
        "sales": 125,
        "revenue": 4487500
      },
      {
        "id": "prod-002",
        "name": "AirPods Pro 2",
        "sales": 230,
        "revenue": 2093000
      }
    ]
  }
}
```

---

### 7.2 銷售報表

**端點**: `GET /api/reports/sales`

**描述**: 取得銷售報表（支援時間分組）

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| start_date | string | ✅ | - | 起始日期 |
| end_date | string | ✅ | - | 結束日期 |
| group_by | string | ❌ | day | 分組方式：`day`, `week`, `month` |

**範例請求**:

```
GET /api/reports/sales?start_date=2025-10-01T00:00:00.000Z&end_date=2025-10-13T23:59:59.999Z&group_by=day
```

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_orders": 450,
      "total_revenue": 18500000,
      "average_order_value": 41111,
      "total_items_sold": 1250
    },
    "timeline": [
      {
        "period": "2025-10-01",
        "orders": 35,
        "revenue": 1450000,
        "items_sold": 98
      },
      {
        "period": "2025-10-02",
        "orders": 42,
        "revenue": 1650000,
        "items_sold": 115
      }
    ],
    "by_category": [
      {
        "category_id": "cat-001",
        "category_name": "手機",
        "orders": 180,
        "revenue": 8500000
      },
      {
        "category_id": "cat-002",
        "category_name": "耳機",
        "orders": 150,
        "revenue": 3200000
      }
    ],
    "by_payment_method": {
      "credit_card": {
        "orders": 300,
        "revenue": 14500000
      },
      "bank_transfer": {
        "orders": 100,
        "revenue": 3200000
      },
      "cash_on_delivery": {
        "orders": 50,
        "revenue": 800000
      }
    }
  }
}
```

---

### 7.3 熱銷商品排行

**端點**: `GET /api/reports/products/top`

**描述**: 取得熱銷商品排行榜

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|------|------|
| start_date | string | ❌ | - | 起始日期 |
| end_date | string | ❌ | - | 結束日期 |
| limit | number | ❌ | 10 | 排行數量 |
| order_by | string | ❌ | revenue | 排序依據：`revenue`（營收）, `quantity`（銷量） |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "product_id": "prod-001",
      "product_name": "iPhone 15 Pro",
      "product_avatar": "https://cdn.example.com/products/iphone15.jpg",
      "price": 35900,
      "quantity_sold": 125,
      "revenue": 4487500,
      "growth_rate": 0.15
    },
    {
      "rank": 2,
      "product_id": "prod-002",
      "product_name": "AirPods Pro 2",
      "product_avatar": "https://cdn.example.com/products/airpods.jpg",
      "price": 9100,
      "quantity_sold": 230,
      "revenue": 2093000,
      "growth_rate": 0.08
    }
  ]
}
```

---

### 7.4 庫存不足警告

**端點**: `GET /api/reports/products/low-stock`

**描述**: 取得庫存不足的商品列表

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| threshold | number | ❌ | 10 | 庫存警戒值 |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "prod-005",
      "name": "MacBook Pro 14",
      "avatar": "https://cdn.example.com/products/macbook.jpg",
      "price": 68900,
      "stock": 3,
      "status": "active",
      "last_sold_at": "2025-10-13T09:00:00.000Z",
      "average_daily_sales": 2
    },
    {
      "id": "prod-012",
      "name": "iPad Air",
      "avatar": "https://cdn.example.com/products/ipad.jpg",
      "price": 21900,
      "stock": 0,
      "status": "active",
      "last_sold_at": "2025-10-12T15:30:00.000Z",
      "average_daily_sales": 3
    }
  ]
}
```

---

### 7.5 廣告成效報表

**端點**: `GET /api/reports/advertisements`

**描述**: 取得所有廣告的成效分析報表

**請求 Header**: 需要 Access Token

**Query 參數**:

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| start_date | string | ❌ | 起始日期 |
| end_date | string | ❌ | 結束日期 |
| sort_by | string | ❌ | 排序依據：`views`, `roas`, `conversion_rate` |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_ads": 45,
      "total_views": 125000,
      "total_conversions": 1250,
      "average_conversion_rate": 0.01,
      "total_revenue": 45000000
    },
    "ads": [
      {
        "id": "ad-001",
        "product_id": "prod-001",
        "product_name": "iPhone 15 Pro",
        "title": "全新 iPhone 15 Pro 震撼上市！",
        "views": 12500,
        "conversions": 125,
        "conversion_rate": 0.01,
        "revenue": 4487500,
        "average_watch_time": 15.5
      }
    ]
  }
}
```

---

## 八、用戶管理 API (Admin Only)

### 8.1 取得用戶列表

**端點**: `GET /api/users`

**描述**: 取得用戶列表（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| search | string | ❌ | - | 搜尋關鍵字（Email 或姓名） |
| group_id | string | ❌ | - | 群組 ID |
| sort_by | string | ❌ | created_at | 排序欄位 |
| sort_order | string | ❌ | desc | 排序方向 |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "user-001",
      "email": "buyer@example.com",
      "oauth_provider": "google",
      "name": "王小買",
      "phone": "0987654321",
      "address": "台北市信義區",
      "avatar_url": "https://cdn.example.com/avatars/user001.jpg",
      "coins": 5000,
      "referral_code": "ABCD1234",
      "group_id": "group-001",
      "timezone": "Asia/Taipei",
      "stats": {
        "total_orders": 15,
        "total_spent": 125000
      },
      "created_at": "2025-08-01T10:00:00.000Z",
      "updated_at": "2025-10-13T08:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 8500,
    "totalPages": 425
  }
}
```

---

### 8.2 取得用戶詳情

**端點**: `GET /api/users/:id`

**描述**: 取得用戶詳細資訊（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "user-001",
    "email": "buyer@example.com",
    "oauth_provider": "google",
    "oauth_id": "google-12345",
    "name": "王小買",
    "phone": "0987654321",
    "address": "台北市信義區忠孝東路 100 號",
    "avatar_url": "https://cdn.example.com/avatars/user001.jpg",
    "coins": 5000,
    "referral_code": "ABCD1234",
    "group_id": "group-001",
    "timezone": "Asia/Taipei",
    "stats": {
      "total_orders": 15,
      "total_spent": 125000,
      "total_views": 350,
      "treasure_boxes_earned": 18
    },
    "created_at": "2025-08-01T10:00:00.000Z",
    "updated_at": "2025-10-13T08:00:00.000Z"
  }
}
```

---

### 8.3 取得用戶訂單記錄

**端點**: `GET /api/users/:id/orders`

**描述**: 取得用戶的訂單記錄（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**Query 參數**: 同 [3.1 取得訂單列表](#31-取得訂單列表)

**成功回應** (200): 同 [3.1 取得訂單列表](#31-取得訂單列表)

---

### 8.4 調整用戶金幣

**端點**: `PATCH /api/users/:id/coins`

**描述**: 調整用戶金幣數量（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**請求 Body**:

```json
{
  "amount": 1000,
  "reason": "客服補償"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| amount | number | ✅ | 調整金額（正數增加，負數減少） |
| reason | string | ✅ | 調整原因 |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "user_id": "user-001",
    "old_coins": 5000,
    "new_coins": 6000,
    "adjustment": 1000,
    "reason": "客服補償"
  },
  "message": "金幣調整成功"
}
```

---

## 九、帳號管理 API (Admin Only)

### 9.1 取得帳號列表

**端點**: `GET /api/accounts`

**描述**: 取得所有賣家/管理員帳號列表（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**Query 參數**:

| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| search | string | ❌ | - | 搜尋關鍵字（Email 或姓名） |
| role | string | ❌ | - | 角色篩選：`admin`, `seller` |

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "seller@example.com",
      "name": "張小賣",
      "role": "seller",
      "phone": "0912345678",
      "address": "台北市信義區",
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-10-13T10:30:00.000Z",
      "last_login_at": "2025-10-13T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25,
    "totalPages": 2
  }
}
```

---

### 9.2 新增帳號

**端點**: `POST /api/accounts`

**描述**: 新增賣家/管理員帳號（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**請求 Body**:

```json
{
  "email": "newseller@example.com",
  "password": "SecurePass123",
  "name": "李小賣",
  "role": "seller",
  "phone": "0923456789",
  "address": "台北市大安區"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| email | string | ✅ | Email（唯一） |
| password | string | ✅ | 密碼（6-50 字元） |
| name | string | ❌ | 姓名 |
| role | string | ✅ | 角色：`admin`, `seller` |
| phone | string | ❌ | 電話 |
| address | string | ❌ | 地址 |

**成功回應** (201):

```json
{
  "success": true,
  "data": {
    "id": "new-account-001",
    "email": "newseller@example.com",
    "name": "李小賣",
    "role": "seller",
    "phone": "0923456789",
    "address": "台北市大安區",
    "created_at": "2025-10-13T12:00:00.000Z"
  },
  "message": "帳號建立成功"
}
```

**錯誤回應** (409):

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ENTRY",
    "message": "Email 已被使用"
  }
}
```

---

### 9.3 更新帳號資訊

**端點**: `PUT /api/accounts/:id`

**描述**: 更新帳號資訊（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**請求 Body**: 同 [9.2 新增帳號](#92-新增帳號)，所有欄位皆為選填（不包含 password）

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "seller@example.com",
    "name": "張大賣",
    "role": "seller",
    "updated_at": "2025-10-13T12:10:00.000Z"
  },
  "message": "帳號更新成功"
}
```

---

### 9.4 刪除帳號

**端點**: `DELETE /api/accounts/:id`

**描述**: 刪除帳號（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**成功回應** (200):

```json
{
  "success": true,
  "message": "帳號已刪除"
}
```

---

## 十、分類管理 API

### 10.1 取得分類列表

**端點**: `GET /api/categories`

**描述**: 取得所有商品分類

**請求 Header**: 需要 Access Token

**成功回應** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "cat-001",
      "name": "手機",
      "product_count": 125,
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-10-13T08:00:00.000Z"
    },
    {
      "id": "cat-002",
      "name": "3C 產品",
      "product_count": 350,
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-10-13T08:00:00.000Z"
    }
  ]
}
```

---

### 10.2 新增分類

**端點**: `POST /api/categories`

**描述**: 新增商品分類（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**請求 Body**:

```json
{
  "name": "筆記型電腦"
}
```

**欄位說明**:

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| name | string | ✅ | 分類名稱 |

**成功回應** (201):

```json
{
  "success": true,
  "data": {
    "id": "cat-new-001",
    "name": "筆記型電腦",
    "created_at": "2025-10-13T12:20:00.000Z"
  },
  "message": "分類建立成功"
}
```

---

### 10.3 更新分類

**端點**: `PUT /api/categories/:id`

**描述**: 更新分類名稱（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**請求 Body**:

```json
{
  "name": "筆記型電腦與平板"
}
```

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "id": "cat-001",
    "name": "筆記型電腦與平板",
    "updated_at": "2025-10-13T12:25:00.000Z"
  },
  "message": "分類更新成功"
}
```

---

### 10.4 刪除分類

**端點**: `DELETE /api/categories/:id`

**描述**: 刪除分類（僅 Admin）

**請求 Header**: 需要 Access Token（Admin 權限）

**成功回應** (200):

```json
{
  "success": true,
  "message": "分類已刪除"
}
```

---

## 十一、檔案上傳 API

### 11.1 上傳單張圖片

**端點**: `POST /api/upload/image`

**描述**: 上傳單張圖片

**請求 Header**:
- 需要 Access Token
- `Content-Type: multipart/form-data`

**請求 Body** (FormData):

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| image | file | ✅ | 圖片檔案（JPG, PNG, WEBP，最大 5MB） |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "url": "https://cdn.example.com/uploads/2025/10/13/abc123.jpg",
    "filename": "abc123.jpg",
    "size": 245680,
    "mimetype": "image/jpeg"
  },
  "message": "圖片上傳成功"
}
```

**錯誤回應** (422):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "檔案大小超過 5MB"
  }
}
```

---

### 11.2 上傳多張圖片

**端點**: `POST /api/upload/images`

**描述**: 上傳多張圖片（最多 10 張）

**請求 Header**:
- 需要 Access Token
- `Content-Type: multipart/form-data`

**請求 Body** (FormData):

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| images | file[] | ✅ | 圖片檔案陣列（最多 10 張） |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "urls": [
      "https://cdn.example.com/uploads/2025/10/13/abc123.jpg",
      "https://cdn.example.com/uploads/2025/10/13/def456.jpg",
      "https://cdn.example.com/uploads/2025/10/13/ghi789.jpg"
    ],
    "count": 3
  },
  "message": "圖片上傳成功"
}
```

---

### 11.3 上傳影片

**端點**: `POST /api/upload/video`

**描述**: 上傳影片（用於廣告）

**請求 Header**:
- 需要 Access Token
- `Content-Type: multipart/form-data`

**請求 Body** (FormData):

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| video | file | ✅ | 影片檔案（MP4, MOV，最大 50MB） |

**成功回應** (200):

```json
{
  "success": true,
  "data": {
    "url": "https://cdn.example.com/uploads/videos/2025/10/13/video123.mp4",
    "filename": "video123.mp4",
    "size": 12458960,
    "mimetype": "video/mp4",
    "duration": 30.5
  },
  "message": "影片上傳成功"
}
```

---

## 附錄 A：資料庫 Schema 更新

### 新增 account_tokens 表格

為了支援 JWT Token 管理，需要新增以下資料表：

```sql
-- account_tokens 表格（用於管理 refresh tokens）
CREATE TABLE account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL UNIQUE,
  access_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  is_revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 建立索引
CREATE INDEX account_tokens_account_id_idx ON account_tokens(account_id);
CREATE INDEX account_tokens_refresh_token_idx ON account_tokens(refresh_token);
CREATE INDEX account_tokens_expires_at_idx ON account_tokens(token_expires_at);

-- 清理過期 token 的函數（可定期執行）
CREATE OR REPLACE FUNCTION clean_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM account_tokens
  WHERE token_expires_at < NOW() OR is_revoked = TRUE;
END;
$$ LANGUAGE plpgsql;
```

### accounts 表格更新（可選）

如果需要追蹤最後登入時間，可以新增欄位：

```sql
ALTER TABLE accounts
ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;
```

---

## 附錄 B：JWT Token 實作建議

### Token 生成範例

```typescript
import jwt from 'jsonwebtoken';

// Access Token (短期，15 分鐘)
const accessToken = jwt.sign(
  {
    account_id: account.id,
    email: account.email,
    role: account.role,
    type: 'access'
  },
  process.env.JWT_SECRET!,
  { expiresIn: '15m' }
);

// Refresh Token (長期，7 天)
const refreshToken = jwt.sign(
  {
    account_id: account.id,
    type: 'refresh'
  },
  process.env.JWT_REFRESH_SECRET!,
  { expiresIn: '7d' }
);

// 將 refresh token 儲存到資料庫
await db.insert(accountTokens).values({
  account_id: account.id,
  refresh_token: refreshToken,
  token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  ip_address: req.ip,
  user_agent: req.headers['user-agent']
});
```

### Token 驗證中間件範例

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_MISSING',
        message: '未提供認證 Token'
      }
    });
  }

  jwt.verify(token, process.env.JWT_SECRET!, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_INVALID',
          message: 'Token 無效或已過期'
        }
      });
    }

    req.account = decoded;
    next();
  });
};
```

### 權限檢查中間件範例

```typescript
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.account?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: '需要管理員權限'
      }
    });
  }
  next();
};
```

---

## 附錄 C：環境變數設定

建議在 `.env` 檔案中設定以下環境變數：

```bash
# 伺服器設定
PORT=3001
NODE_ENV=development

# 資料庫設定
DATABASE_URL=postgresql://user:password@localhost:5432/water_db

# JWT 設定
JWT_SECRET=your-super-secret-jwt-key-here
JWT_REFRESH_SECRET=your-super-secret-refresh-key-here
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# CORS 設定
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# 檔案上傳設定
MAX_FILE_SIZE=5242880  # 5MB (bytes)
MAX_VIDEO_SIZE=52428800  # 50MB (bytes)
UPLOAD_PATH=./uploads

# CDN 設定（如果使用 CDN）
CDN_URL=https://cdn.example.com
```

---

## 附錄 D：安全性建議

### 1. 密碼處理

- 使用 bcrypt 加密密碼（至少 10 rounds）
- 密碼長度至少 6 字元
- 建議密碼複雜度規則

### 2. Token 安全

- Access Token 有效期設短（15 分鐘）
- Refresh Token 有效期適中（7 天）
- 登出時撤銷 Refresh Token
- 定期清理過期 Token

### 3. API 安全

- 使用 HTTPS（正式環境）
- 實作 Rate Limiting
- 驗證所有輸入資料
- 使用 CORS 白名單

### 4. 資料驗證

- 使用 Zod 或 Joi 進行資料驗證
- 驗證檔案類型和大小
- 清理 XSS 攻擊

---

## 附錄 E：測試建議

### 使用 Postman 或 curl 測試

#### 登入範例

```bash
curl -X POST http://localhost:3001/api/accounts/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seller@example.com",
    "password": "SecurePass123"
  }'
```

#### 帶 Token 的請求範例

```bash
curl -X GET http://localhost:3001/api/products \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### 上傳檔案範例

```bash
curl -X POST http://localhost:3001/api/upload/image \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "image=@/path/to/image.jpg"
```

---

## 結語

本文檔涵蓋了賣家/管理員後台系統所需的完整 API 規格。如有任何問題或需要調整，請隨時聯繫前端團隊討論。

**版本歷史**:
- v1.0 (2025-10-13) - 初始版本

**維護者**: 前端團隊
**聯絡方式**: frontend@example.com
