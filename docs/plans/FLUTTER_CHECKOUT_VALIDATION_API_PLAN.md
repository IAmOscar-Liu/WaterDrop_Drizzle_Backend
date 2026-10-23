# 結帳批次驗證與綠界測試物流回呼計畫

日期：2026-10-23  
狀態：**A、B 後端均已實作，待部署與 Flutter 串接驗證。** 正式合約請見 [A 批次結帳驗證](../api/FLUTTER_CHECKOUT_VALIDATION_API_CHANGES.md) 及 [B 同步物流驗證](../api/FLUTTER_LOGISTICS_VERIFICATION_API_CHANGES.md)。B 已改為後端直接向綠界請求，不採下方原始回呼／工作表提案。
檢查基準：目前 Flutter 工作目錄，以及 `waterdrop-server` 的 `development`（A）與 `feat/checkout-logistics-verification`（B）分支。A、B 均不需 DB migration；本次未修改 Flutter 程式，B 新增同步端點並保留舊物流回呼相容性。

A 採 1–4 筆明細、唯讀 `REPEATABLE READ` 快照、與原購物車相同的完整清單格式，並新增 `PRICE_UNAVAILABLE` 以明確阻擋無效價格。最終訂單的伺服器計價強化另列後續工作：目前 `POST /api/order` 仍接受客戶端價格／總額，不能將 A 的預檢視為已修正該問題。

## 目的與目前流程

本次建議分為兩項，可獨立交付：

1. 以單一批次 API 取代結帳前的「購物車查詢＋逐商品查詢」，集中驗證所選商品、規格、價格、數量與庫存。
2. 修正綠界測試物流回呼：只有明確成功且可驗證的結果才允許 App 繼續。

目前流程為：

```text
購物車「確認結帳」
  → GET /api/cart/list
  → 每個不同商品 GET /api/product/:id
  → POST /api/ecpay/express/validate（BE 端物流欄位格式檢查）
  → 取得運費、進入「結帳設定」
  → WebView：GET /api/ecpay/express/test/create
  → 綠界測試物流單及回呼
  → 選擇配送方式／門市
  →「下一步，前往付款」及確認
  → 付款頁 POST /api/order（BE 鎖定、驗證及保留庫存）
```

Flutter 已補上第一階段的最新規格庫存比較，但需要多筆查詢。BE 的 `POST /api/order` 已在同一交易中鎖定商品／規格、驗證 `stock - reserve`，並增加 `reserve`。**新的預先驗證不取代這項最終保護。**

## A. 批次結帳檢查 API

### 建議請求

```http
POST /api/cart/validate-checkout
Authorization: Bearer APP_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "items": [
    {
      "cartItemId": "CART_ITEM_UUID",
      "productVariantId": "VARIANT_UUID",
      "quantity": 3,
      "expectedUnitPrice": 299
    }
  ]
}
```

- `items` 是使用者本次看到並勾選的完整結帳明細，不能為空。
- `quantity` 必須為正整數；拒絕重複的 `cartItemId`／`productVariantId`。
- `expectedUnitPrice` 是 App 畫面上的單價，沿用現有商品 API 的價格單位及精度，只供偵測價格變動，不可當作可信任的計價來源。
- 使用者由 Bearer token 決定，不接受 `userId`。商品由該使用者的購物車項目解析，不信任任意傳入的商品關聯。
- BE 請訂定並文件化合理的明細數量上限；現有 App 單筆結帳限制為最多 4 種明細。

### BE 驗證內容

在一致的資料庫讀取快照中批次讀取資料，避免以逐明細查詢形成另一個 N+1 問題：

1. 購物車項目存在且屬於目前使用者。不存在與不屬於使用者，對外皆回報不可用，不透露他人資料。
2. 本次送出的集合與伺服器目前勾選的項目一致；其他裝置新增勾選或取消勾選時，必須要求重新確認。
3. 購物車規格、數量與 App 送出的快照一致。
4. 商品未刪除且已上架；規格存在、屬於該商品且已上架。
5. 最新有效單價與 `expectedUnitPrice` 一致。價格計算須與建立訂單採相同規則。
6. 購買數量不超過該規格的 `stock - reserve`。單一預設規格也適用，不使用商品全部規格的加總庫存。
7. 資料不足或查詢失敗不得當作可結帳，也不得把未知庫存當作 0。

此 API **只讀取與驗證**：不建立訂單、不增加庫存保留、不扣金幣、不修改數量／勾選、不刪除購物車項目，也不呼叫綠界建立物流單。

### 建議回應

以下為「API 成功執行，但庫存不足」的例子：

```json
{
  "success": true,
  "data": {
    "canCheckout": false,
    "checkedAt": "2026-10-23T04:00:00Z",
    "issues": [],
    "items": [
      {
        "cartItemId": "CART_ITEM_UUID",
        "productId": "PRODUCT_UUID",
        "productVariantId": "VARIANT_UUID",
        "productName": "商品名稱",
        "variantName": "藍色",
        "requestedQuantity": 3,
        "currentQuantity": 3,
        "currentUnitPrice": 299,
        "availableStock": 2,
        "canCheckout": false,
        "issues": [
          {
            "code": "INSUFFICIENT_STOCK",
            "message": "庫存不足"
          }
        ]
      }
    ],
    "cartItems": []
  }
}
```

`cartItems: []` 在上例僅為省略完整購物車內容的佔位。實際回應須包含該使用者最新的完整購物車清單，格式沿用 `GET /api/cart/list` 的 `data`，包含商品、規格、賣家等既有欄位。App 需要它更新畫面及後續配送分組，避免驗證後再補一次購物車 GET。只有實際空購物車才能回傳空陣列。

- `data.items` 對每個請求項目各回傳一筆結果；找不到的項目，其最新資料欄位可為 `null`，必須附上問題代碼。
- `data.issues` 放整體問題，例如所選集合改變。`items[].issues` 放單項問題，可包含多個代碼。
- 完全通過時，各問題陣列為空，所有項目及整體 `canCheckout` 均為 `true`。
- `checkedAt` 僅代表檢查時間，**不是庫存保證期限或庫存保留憑證**。
- `availableStock` 是最新可售數量，顯示時負值可正規化為 0；無法取得時回傳 `null` 並阻擋結帳。

建議代碼如下，BE 可調整命名但須提供固定合約：

| 代碼                     | 意義                             |
| ------------------------ | -------------------------------- |
| `CART_SELECTION_CHANGED` | 伺服器勾選集合與本次結帳集合不同 |
| `CART_ITEM_UNAVAILABLE`  | 項目不存在或非本人的項目         |
| `CART_ITEM_CHANGED`      | 規格或數量已改變                 |
| `PRODUCT_UNAVAILABLE`    | 商品不存在、刪除或下架           |
| `VARIANT_UNAVAILABLE`    | 規格不存在、下架或商品關聯不符   |
| `PRICE_CHANGED`          | 最新單價與畫面單價不同           |
| `INSUFFICIENT_STOCK`     | 可用庫存小於購買數量             |
| `STOCK_UNAVAILABLE`      | 無法確認庫存，不能放行           |

合法的請求且檢查完成，回 HTTP 200、`success:true`，由 `canCheckout` 表示是否可繼續。格式錯誤回 400、未登入回 401；系統／資料庫故障回非成功結果，不能回 `canCheckout:true`。

### Flutter 配合調整

1. 等購物車操作佇列與同步完成後，才允許「確認結帳」。點擊時凍結本次明細，發出一次批次驗證。
2. 使用回傳的 `cartItems` 更新購物車；若驗證期間登入狀態或購物車操作版本改變，丟棄過期結果並要求重新確認。
3. `canCheckout:false` 時停留購物車，顯示商品／規格名稱及原因。庫存不足顯示需求及剩餘數量；不偷偷縮減數量或切換規格。
4. 價格／勾選／數量變動時更新畫面，但需使用者再次確認，不能自動繼續付款。
5. 下架商品若沿用現有自動清理行為，由 App 在處理結果後使用既有刪除 API，再同步清單；這是異常清理流程，不是驗證 API 的副作用。
6. 驗證通過後，沿用既有物流欄位驗證、運費、結帳設定及訂單建立流程。新 API 不宣稱合併這些其他請求。
7. `POST /api/order` 保留原有資料庫交易、鎖定、最新庫存檢查及庫存保留，不信任先前的 `canCheckout`。庫存仍可能在結帳設定期間被其他買家購買。

## B. 綠界測試物流回呼

### 已採用的替代方案（2026-10-23）

新增帶 App Bearer token 的 `POST /api/ecpay/express/test/validate`，由後端直接呼叫綠界測試環境，略去 `ClientReplyURL`，驗證同步回應並回傳 JSON。Flutter 應以此取代 `ValidationWebview`，保留門市地圖 WebView。逾時、未知或無法驗證的回應一律不得繼續。無 DB migration、工作表、輪詢 API 或持久化冪等保證；手動重試會建立新的測試物流單。舊測試 WebView 路由暫時保留相容性。下方內容保留作為原始提案背景，實作以 B 交接文件為準。

### 已確認的現況

- App 進入「結帳設定」後使用 `ValidationWebview` 呼叫 `GET /api/ecpay/express/test/create`。
- App 未傳 `realAccount=true`；目前 BE 因此使用綠界測試帳號及 `https://logistics-stage.ecpay.com.tw/Express/Create`。
- 實際收件人姓名、手機、Email 會傳入，但商品名稱為「測試商品」、金額為 300，並使用固定測試門市及對應測試物流類型。
- BE 的測試 client callback 將 `req.body` 原樣傳給 `express-test-reply`；App 目前收到回呼即呼叫 `onSuccess()`，沒有檢查結果。BE 的測試 server callback 目前只記錄資料並回覆 `1|OK`。
- 此流程可以測試部分物流欄位，但不代表使用實際賣家、商品、金額、門市建立正式物流單一定成功。`/api/ecpay/express/validate` 則是另外一項 BE 本地格式檢查。

### 建議由 BE 統一驗證與正規化結果

保留既有 JS handler 名稱 `express-test-reply`，新增明確結果合約：

```json
{
  "verificationId": "VERIFICATION_UUID",
  "success": false,
  "code": "PROVIDER_REJECTED",
  "message": "物流資料驗證失敗，請確認收件人資訊",
  "providerCode": "PROVIDER_RESULT_CODE"
}
```

- 成功使用 `success:true`、`code:VALIDATED`；不能因為收到任何回呼、HTTP 200 或回呼頁顯示 Success 就視為成功。
- BE 須確認本流程實際綠界 API／B2C、C2C 回呼的成功代碼及欄位。**本提案不指定未驗證的數字代碼，也不沿用付款成功代碼作物流成功代碼。**
- BE 依該回呼實際支援的機制驗證來源及完整性；若需從 server callback 或向綠界查詢取得可信任結果，不能只信任 client callback 的原始 POST body。
- 測試請求須與目前使用者／這次驗證工作關聯。建議每次產生 `verificationId`，搭配短效、不可猜測的 WebView token／網址；驗證狀態不能只靠使用者傳入的 ID 決定。
- 現有 WebView GET 沒有傳 Bearer token。請 BE 確認驗證工作的建立方式，例如由 App 先透過認證 API 建立工作並取得 WebView URL，再使用既有測試建單及回呼路由。
- BE 驗證回呼對應的測試交易、驗證工作及有效期限；重複回呼須冪等，其他工作或已過期的回呼不得解鎖目前結帳。
- 若 server callback 結果尚未到達，可回 `PENDING`，但 App 不得因此前進。BE 若採非同步確認，須另提供有認證的結果查詢方式及狀態合約。
- 建議失敗代碼包含 `PROVIDER_REJECTED`、`INVALID_CALLBACK`、`EXPIRED`、`INTERNAL_ERROR`；訊息不可包含敏感診斷內容。

驗證工作建立端點、token 格式、存放方式、有效期、是否需結果查詢 API，由 BE 回覆確認；不預設一定需要 DB migration。

### Flutter 配合調整

- 註冊 JS handler 後再載入網址，避免快速回呼早於 handler 註冊。
- 解析合約、核對 `verificationId`，只在明確成功時進入配送設定。
- 空內容、格式錯誤、失敗或工作不匹配皆不得呼叫 `onSuccess()`；重複成功回呼只處理一次。
- 逾時顯示可重試／返回修改資料的提示，不能自動略過驗證。重試建立新的驗證工作，忽略舊工作的回呼。
- 顯示失敗訊息並允許返回修改收件人資料；不在失敗後直接前往付款。
- 此項 App 修正可先以現有原始回呼過渡實作，但須先確認實際欄位及成功代碼；BE 新合約上線時明確約定版本／相容期，不能把未知格式當作成功。

## 驗收情境

| 情境                               | 預期                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| 多個商品及同商品不同規格           | 正常路徑一次批次驗證，逐規格正確判斷                 |
| 庫存剛好足夠／不足／0              | 分別通過或顯示正確需求、剩餘數量                     |
| 單一預設規格                       | 與具名規格採相同檢查                                 |
| 商品／規格下架、刪除、關聯不符     | 不放行，不洩漏其他使用者資料                         |
| 價格、數量或勾選在其他裝置改變     | 回傳最新內容並要求重新確認                           |
| 預先驗證後被其他買家搶先購買       | `POST /api/order` 再次檢查，庫存不足不得建立成功訂單 |
| 缺欄位、未知庫存、斷線或 DB 失敗   | 不放行；不自動刪除或調整庫存不足的商品               |
| 測試物流成功／失敗／無效回呼       | 只有明確且可信任的成功可繼續                         |
| 測試回呼晚到、重複、其他工作或帳號 | 不影響目前結帳工作                                   |
| 測試物流逾時及重試                 | 顯示提示；重試不接受前一次工作回呼                   |

## BE 待確認及交付

1. 確認批次端點、價格精度、錯誤代碼、完整 `cartItems` 格式與一致快照實作方式。
2. 確認綠界測試回呼欄位、成功代碼、回呼驗證機制、驗證工作建立／查詢方式及有效期。
3. 提供成功、庫存不足、價格／勾選變更、測試物流失敗與逾時範例。
4. 確認部署順序與相容期，再由 Flutter 替換現有多筆查詢及無條件成功回呼。API 未上線前保留現有第一階段庫存檢查。

## 程式碼參考

- Flutter：`lib/provider/cart_provider.dart`、`lib/pages/cart_page.dart`、`lib/pages/payment_settings_page.dart`、`lib/features/ecpay/widget/checkout_webview.dart`、`lib/provider/order_provider.dart`。
- BE：`src/routers/cart.ts`、`src/repository/cart.ts`、`src/repository/order.ts`、`src/routers/ecpay.ts`、`src/controller/ecpay.ts`、`src/services/ecpay.ts`。
