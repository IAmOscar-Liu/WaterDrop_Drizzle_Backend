# 缺失 API 端點清單

## 1. 訂單管理 API

### 1.1 取得訂單列表
```http
GET /api/admin/orders/list
```

**描述：** 取得訂單列表，支援分頁、搜尋和狀態篩選

**認證：** Bearer Token 必需

**Query 參數：**
| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| keyword | string | ❌ | - | 搜尋關鍵字（訂單ID、客戶Email） |
| status | string | ❌ | - | 訂單狀態：pending, paid, shipped, canceled |
| startDate | string | ❌ | - | 起始日期（ISO 8601） |
| endDate | string | ❌ | - | 結束日期（ISO 8601） |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "ORD-001",
        "userEmail": "user@example.com",
        "amount": 2990,
        "status": "paid",
        "usedCoins": 299,
        "createdAt": "2024-01-16T10:30:00Z",
        "updatedAt": "2024-01-16T10:35:00Z",
        "items": [
          {
            "productId": "uuid-1",
            "productName": "無線藍牙耳機",
            "quantity": 1,
            "price": 2990
          }
        ],
        "shippingAddress": "台北市信義區信義路五段7號"
      }
    ],
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

### 1.2 取得訂單詳情
```http
GET /api/admin/orders/{id}
```

**描述：** 取得指定訂單的詳細資訊

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 訂單 ID |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "ORD-001",
    "userEmail": "user@example.com",
    "amount": 2990,
    "status": "paid",
    "usedCoins": 299,
    "createdAt": "2024-01-16T10:30:00Z",
    "updatedAt": "2024-01-16T10:35:00Z",
    "items": [
      {
        "productId": "uuid-1",
        "productName": "無線藍牙耳機",
        "quantity": 1,
        "price": 2990
      }
    ],
    "shippingAddress": "台北市信義區信義路五段7號",
    "paymentMethod": "credit_card",
    "trackingNumber": "TW123456789"
  }
}
```

### 1.3 更新訂單狀態
```http
PUT /api/admin/orders/{id}/status
```

**描述：** 更新訂單狀態

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 訂單 ID |

**請求 Body：**
```json
{
  "status": "shipped",
  "trackingNumber": "TW123456789"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "ORD-001",
    "status": "shipped",
    "trackingNumber": "TW123456789",
    "updatedAt": "2024-01-16T15:00:00Z"
  },
  "message": "訂單狀態更新成功"
}
```

### 1.4 取得訂單統計
```http
GET /api/admin/orders/stats
```

**描述：** 取得訂單統計數據

**認證：** Bearer Token 必需

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "totalOrders": 1250,
    "pendingOrders": 45,
    "paidOrders": 980,
    "shippedOrders": 200,
    "canceledOrders": 25,
    "totalRevenue": 2850000,
    "coinUsageRate": 0.15,
    "totalCoinsUsed": 125000
  }
}
```

### 1.5 匯出訂單
```http
POST /api/admin/orders/export
```

**描述：** 匯出訂單資料為 CSV 或 Excel

**認證：** Bearer Token 必需

**請求 Body：**
```json
{
  "format": "csv",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "status": "paid"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://api.example.com/downloads/orders_2024-01.csv",
    "expiresAt": "2024-01-16T23:59:59Z"
  },
  "message": "訂單匯出成功"
}
```

### 1.6 批量更新訂單
```http
PUT /api/admin/orders/batch
```

**描述：** 批量更新多個訂單的狀態

**認證：** Bearer Token 必需

**請求 Body：**
```json
{
  "orderIds": ["ORD-001", "ORD-002", "ORD-003"],
  "status": "shipped",
  "trackingNumbers": ["TW123", "TW124", "TW125"]
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "updatedCount": 3,
    "failedOrders": []
  },
  "message": "批量更新成功"
}
```

## 2. 客戶管理 API

### 2.1 取得客戶列表
```http
GET /api/admin/customers/list
```

**描述：** 取得客戶列表，支援分頁和搜尋

**認證：** Bearer Token 必需

**Query 參數：**
| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| keyword | string | ❌ | - | 搜尋關鍵字（姓名、Email） |
| status | string | ❌ | - | 帳戶狀態：active, inactive, banned |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "customers": [
      {
        "id": "user-001",
        "name": "張小明",
        "email": "user@example.com",
        "phone": "0912345678",
        "status": "active",
        "totalOrders": 15,
        "totalSpent": 45000,
        "coinBalance": 1200,
        "registeredAt": "2024-01-01T00:00:00Z",
        "lastLoginAt": "2024-01-16T10:00:00Z"
      }
    ],
    "total": 500,
    "page": 1,
    "limit": 20,
    "totalPages": 25
  }
}
```

### 2.2 取得客戶統計
```http
GET /api/admin/customers/stats
```

**描述：** 取得客戶統計數據

**認證：** Bearer Token 必需

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "totalCustomers": 5000,
    "activeCustomers": 4200,
    "newCustomersThisMonth": 150,
    "averageOrderValue": 2500,
    "customerRetentionRate": 0.75,
    "topSpendingCustomers": [
      {
        "id": "user-001",
        "name": "張小明",
        "totalSpent": 150000
      }
    ]
  }
}
```

### 2.3 取得客戶詳情
```http
GET /api/admin/customers/{id}
```

**描述：** 取得指定客戶的詳細資訊

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 客戶 ID |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "user-001",
    "name": "張小明",
    "email": "user@example.com",
    "phone": "0912345678",
    "status": "active",
    "totalOrders": 15,
    "totalSpent": 45000,
    "coinBalance": 1200,
    "registeredAt": "2024-01-01T00:00:00Z",
    "lastLoginAt": "2024-01-16T10:00:00Z",
    "recentOrders": [
      {
        "id": "ORD-001",
        "amount": 2990,
        "status": "paid",
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

### 2.4 更新客戶狀態
```http
PUT /api/admin/customers/{id}/status
```

**描述：** 更新客戶帳戶狀態

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 客戶 ID |

**請求 Body：**
```json
{
  "status": "banned",
  "reason": "違反使用條款"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "user-001",
    "status": "banned",
    "updatedAt": "2024-01-16T15:00:00Z"
  },
  "message": "客戶狀態更新成功"
}
```

## 3. KPI統計 API

### 3.1 儀表板 KPI
```http
GET /api/admin/dashboard/kpi
```

**描述：** 取得儀表板 KPI 數據

**認證：** Bearer Token 必需

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "totalRevenue": 1250000,
    "todayRevenue": 45000,
    "todayOrders": 128,
    "todayUsers": 34,
    "pendingOrders": 15,
    "activeProducts": 250,
    "totalCustomers": 5000,
    "conversionRate": 0.035
  }
}
```

### 3.2 營收統計
```http
GET /api/admin/dashboard/revenue
```

**描述：** 取得營收統計數據

**認證：** Bearer Token 必需

**Query 參數：**
| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| period | string | ❌ | 30 | 統計期間：7, 30, 90, 365 天 |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "totalRevenue": 1250000,
    "periodRevenue": 350000,
    "revenueGrowth": 0.15,
    "dailyRevenue": [
      {
        "date": "2024-01-16",
        "revenue": 45000,
        "orders": 128
      }
    ],
    "topProducts": [
      {
        "id": "prod-001",
        "name": "無線藍牙耳機",
        "revenue": 89700,
        "orders": 30
      }
    ]
  }
}
```

## 4. 廣告統計 API

### 4.1 廣告效果
```http
GET /api/admin/advertisement/analytics
```

**描述：** 取得廣告效果統計

**認證：** Bearer Token 必需

**Query 參數：**
| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| period | string | ❌ | 30 | 統計期間：7, 30, 90 天 |
| adId | string | ❌ | - | 特定廣告 ID |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "totalViews": 125000,
    "totalClicks": 4375,
    "totalConversions": 156,
    "clickThroughRate": 0.035,
    "conversionRate": 0.036,
    "costPerClick": 2.5,
    "returnOnAdSpend": 4.2,
    "adMetrics": [
      {
        "adId": "ad-001",
        "productName": "無線藍牙耳機",
        "views": 15000,
        "clicks": 525,
        "conversions": 18,
        "revenue": 53820
      }
    ]
  }
}
```

### 4.2 廣告趨勢
```http
GET /api/admin/advertisement/trends
```

**描述：** 取得廣告趨勢數據

**認證：** Bearer Token 必需

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "dailyTrends": [
      {
        "date": "2024-01-16",
        "views": 5200,
        "clicks": 182,
        "conversions": 6,
        "spend": 455
      }
    ],
    "topPerformingAds": [
      {
        "adId": "ad-001",
        "productName": "無線藍牙耳機",
        "roas": 4.8,
        "conversionRate": 0.042
      }
    ]
  }
}
```

### 4.3 廣告預算統計
```http
GET /api/admin/advertisement/budget
```

**描述：** 取得廣告預算使用統計

**認證：** Bearer Token 必需

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "totalBudget": 50000,
    "usedBudget": 18500,
    "remainingBudget": 31500,
    "dailySpend": 1250,
    "projectedMonthlySpend": 37500,
    "budgetUtilization": 0.37,
    "adSpendByProduct": [
      {
        "productId": "prod-001",
        "productName": "無線藍牙耳機",
        "spend": 8500,
        "budget": 15000
      }
    ]
  }
}
```

## 5. 客服對話 API

### 5.1 對話列表
```http
GET /api/admin/conversations/list
```

**描述：** 取得客服對話列表

**認證：** Bearer Token 必需

**Query 參數：**
| 參數 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 頁碼 |
| limit | number | ❌ | 20 | 每頁筆數 |
| status | string | ❌ | - | 對話狀態：open, closed, pending |
| keyword | string | ❌ | - | 搜尋關鍵字 |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "conv-001",
        "customerId": "user-001",
        "customerName": "張小明",
        "subject": "商品退換貨問題",
        "status": "open",
        "priority": "high",
        "lastMessage": "請問可以退貨嗎？",
        "lastMessageAt": "2024-01-16T14:30:00Z",
        "createdAt": "2024-01-16T10:00:00Z",
        "assignedTo": "admin-001"
      }
    ],
    "total": 45,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

### 5.2 取得對話詳情
```http
GET /api/admin/conversations/{id}
```

**描述：** 取得指定對話的詳細內容

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 對話 ID |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "conv-001",
    "customerId": "user-001",
    "customerName": "張小明",
    "subject": "商品退換貨問題",
    "status": "open",
    "priority": "high",
    "createdAt": "2024-01-16T10:00:00Z",
    "assignedTo": "admin-001",
    "messages": [
      {
        "id": "msg-001",
        "senderId": "user-001",
        "senderType": "customer",
        "content": "請問可以退貨嗎？",
        "timestamp": "2024-01-16T10:00:00Z"
      },
      {
        "id": "msg-002",
        "senderId": "admin-001",
        "senderType": "admin",
        "content": "可以的，請提供訂單編號",
        "timestamp": "2024-01-16T10:05:00Z"
      }
    ]
  }
}
```

### 5.3 回覆對話
```http
POST /api/admin/conversations/{id}/reply
```

**描述：** 回覆客服對話

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 對話 ID |

**請求 Body：**
```json
{
  "content": "您的退貨申請已處理，請查收退款",
  "status": "closed"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "messageId": "msg-003",
    "conversationId": "conv-001",
    "status": "closed",
    "timestamp": "2024-01-16T15:00:00Z"
  },
  "message": "回覆成功"
}
```

### 5.4 更新對話狀態
```http
PUT /api/admin/conversations/{id}/status
```

**描述：** 更新對話狀態

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 對話 ID |

**請求 Body：**
```json
{
  "status": "closed",
  "assignedTo": "admin-002"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "conv-001",
    "status": "closed",
    "assignedTo": "admin-002",
    "updatedAt": "2024-01-16T15:00:00Z"
  },
  "message": "對話狀態更新成功"
}
```

## 6. 商品管理補完 API

### 6.1 刪除商品
```http
DELETE /api/admin/product/{id}
```

**描述：** 刪除指定的商品

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 商品 UUID |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "deletedProductId": "uuid-1",
    "deletedAt": "2024-01-16T15:00:00Z"
  },
  "message": "商品刪除成功"
}
```

## 7. 廣告管理補完 API

### 7.1 刪除廣告
```http
DELETE /api/admin/advertisement/{id}
```

**描述：** 刪除指定的廣告

**認證：** Bearer Token 必需

**路徑參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | string | ✅ | 廣告 UUID |

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "deletedAdvertisementId": "uuid-1",
    "deletedAt": "2024-01-16T15:00:00Z"
  },
  "message": "廣告刪除成功"
}
```

## 8. 子帳號管理 API

### 8.1 取得子帳號列表
```http
GET /api/admin/account/sub-accounts
```

**描述：** 取得當前帳號的子帳號列表

**認證：** Bearer Token 必需

**成功回應（200）：**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-1",
      "name": "子帳號管理員",
      "email": "sub@example.com",
      "role": "sub_admin",
      "permissions": ["product_read", "product_write"],
      "isActive": true,
      "createdAt": "2024-01-16T10:00:00Z"
    }
  ]
}
```

### 8.2 建立子帳號
```http
POST /api/admin/account/sub-accounts/create
```

**描述：** 建立新的子帳號

**認證：** Bearer Token 必需

**請求 Body：**
```json
{
  "name": "新子帳號",
  "email": "newsub@example.com",
  "password": "password123",
  "role": "sub_admin",
  "permissions": ["product_read", "order_read"]
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "id": "uuid-2",
    "name": "新子帳號",
    "email": "newsub@example.com",
    "role": "sub_admin",
    "permissions": ["product_read", "order_read"],
    "isActive": true,
    "createdAt": "2024-01-16T15:00:00Z"
  },
  "message": "子帳號建立成功"
}
```

---

## 總結

**總計缺失端點：47個**

1. **訂單管理** - 6個端點
2. **客戶管理** - 4個端點
3. **KPI統計** - 2個端點
4. **廣告統計** - 3個端點
5. **客服對話** - 4個端點
6. **商品管理補完** - 1個端點
7. **廣告管理補完** - 1個端點
8. **子帳號管理** - 2個端點
9. **廣告收入管理** - 8個端點
10. **系統設定** - 6個端點
11. **檔案管理** - 3個端點
12. **系統配置** - 7個端點
```
