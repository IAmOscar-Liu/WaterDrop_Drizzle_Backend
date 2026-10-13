# 管理後台：商品目前廣告、封存後建立新廣告、自動財務結清

日期：2026-10-13

本次更新沿用既有資料表、欄位與 API，**不需要新增 DB migration**。需要部署新版後端才會生效；這份文件不代表 development / staging 已部署。原本的金幣帳本與錢包 migrations 仍須已完成。Swagger 位於 `/api-docs`，查看 Advertisement 與 Product。

## 1. 每個商品回傳零或一個「未封存廣告」

管理後台商品清單 `GET /api/admin/product/list`、明細 `GET /api/admin/product/:id`、更新與軟刪除回應中的 `advertisement`：

| 狀況 | `advertisement` |
| --- | --- |
| 從未建立廣告 | `null` |
| 所有廣告均已 archived，包含尚未財務結清者 | `null` |
| 有 active、paused 或 depleted 廣告 | 該廣告物件，最多一個 |

此欄位不是廣告歷史清單，也不是只有 active 才顯示。舊的 archived 廣告與帳務紀錄保留，可透過廣告清單／明細 API 查詢；App 商品回應不在本次調整範圍。

FE 可在 `advertisement === null` 且帳號有權限時提供「建立廣告」。若另一個請求已建立新廣告，建立 API 仍可能回傳 409，請重新整理商品資料。

### 後台廣告清單狀態篩選

`GET /api/admin/advertisement/list` 新增可選 `status`，接受單一值 `active`、`paused`、`depleted` 或 `archived`：

```http
GET /api/admin/advertisement/list?status=archived&page=1&limit=20
```

省略 `status` 會包含所有狀態；不要傳 `status=all`、空字串、逗號分隔或重複 status，這些會回傳 400。`total`／`totalPages` 依篩選後結果計算。平台管理員可併用 `sellerId`，賣家與員工仍依原有賣家範圍限制；`archived` 包含已結清及尚未結清的廣告。

App 的 `GET /api/advertisement/list` 維持只回傳 **active** 廣告，且仍須符合餘額、商品／規格庫存與使用者觀看資格。App 不提供 status 篩選，傳入其他 status 不會讓 paused／depleted／archived 廣告出現在清單。

## 2. 舊廣告封存後即可建立同商品的新廣告

既有端點：

```http
PUT /api/admin/advertisement/status/OLD_AD_UUID
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{"status":"archived"}
```

封存成功後即可呼叫：

```http
POST /api/admin/advertisement/create
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{"productId":"PRODUCT_UUID","title":"新廣告","video_url":"https://example.com/new-ad.mp4"}
```

成功仍為 `{ "success": true, "data": <advertisement> }`。

- 不需要等舊廣告結清，也不需要等 `archiveGraceEndsAt`。
- 商品仍只能有一個未封存廣告；active、paused、depleted 都會阻擋重複建立。後端會序列化同商品的建立請求。
- 建立權限維持商品所屬賣家或平台管理員；其他賣家、員工等不因此取得權限。
- 後端設定 `replacementOfAdvertisementId`，FE 不需傳入。新廣告初始狀態為 paused，balance 為 0。
- 新廣告必須另外儲值／增加預算並啟用；建立動作不會移動舊廣告餘額，也不會自動啟用新廣告。
- 已封存廣告仍不可改回 active。新廣告不影響舊廣告已派發的觀看／寶箱權益。

## 3. 每 30 分鐘自動財務結清，取消固定等待 24 小時

既有 coin-ledger maintenance 排程每小時第 0、30 分鐘執行，完成到期寶箱、獎勵週期、金幣、cohort 與派發紀錄處理後，逐一嘗試結清 archived 且尚未結清的廣告。

同一次交易會鎖定、檢查並完成結清，不是只寫入「可以結清」標記。手動 API 使用完全相同的檢查與結清流程。

以下任一狀況仍會阻擋結清：

| 阻擋條件 | 手動 API HTTP 409 的 `code` |
| --- | --- |
| 封存前派發、仍為 issued，且仍在派發時區當日與封存寬限期限內 | `AD_FINANCIAL_CLOSE_ASSIGNMENTS_PENDING` |
| 曾觀看此廣告的獎勵週期仍為 collecting，例如已看第一支但尚未看第二支 | `AD_FINANCIAL_CLOSE_CYCLES_PENDING` |
| 寶箱獎勵分配仍為 demand，尚未領取或完成未領取結算 | `AD_FINANCIAL_CLOSE_CLAIMS_PENDING` |

期限已過的 collecting／demand 紀錄仍要先由 maintenance 清理；單純修改時間或倒數到 0 不代表已處理完成。清理使用既有批次上限，積壓可能需要多輪。已領入使用者帳戶的金幣不會阻擋結清，不需等待它們到期，也不會被取消。

只要以上義務已處理完，就可在封存後 24 小時之前結清。例如從未派發的廣告，可以在下一次成功排程自動結清，也可以立即手動結清。這不是「封存後一定 30 分鐘內完成」的 SLA：仍有未完成權益、批次積壓、排程停用或執行錯誤時會延後。

排程每次以分頁掃描候選廣告，前面的未就緒廣告不會擋住後面的廣告。單筆結清失敗會回滾該筆、繼續處理其他廣告，後續排程再重試。維運可從 `coin_ledger_job_runs.metadata.financialClose` 與 maintenance 日誌查看 checked／closed／blocked／failed 數量及最多 20 筆錯誤明細。closed 包含當次候選中被同時執行的手動請求先完成的冪等成功。

部署時須啟用 `COIN_LEDGER_ENABLED=true`，且至少一個執行排程的服務不可設定 `NO_CRON=true`。保留既有 PostgreSQL maintenance advisory lock 與同分鐘 job 去重；本次沒有新增環境變數或修改環境檔。

## 4. FE 應如何顯示結清狀態

從 `GET /api/admin/advertisement/:id` 或廣告清單取得最新廣告資料：

| 欄位 | 意義與 FE 用法 |
| --- | --- |
| `archivedAt` | 封存時間。 |
| `archiveGraceEndsAt` | 封存前派發的觀看完成期限之一。預設 `archivedAt + 24 小時`，由既有 `AD_ARCHIVE_GRACE_HOURS` 設定；派發當地日期結束可能更早。保留此欄位，不作為最早結清時間或結清按鈕倒數。 |
| `financiallyClosedAt` | 成功結清時間。非 null = 已結清，不論手動或排程；null = 尚未結清。不是「曾呼叫 API」的紀錄。 |

目前廣告回應**沒有 `canFinancialClose` 欄位**；先前討論中的名稱不是既有 API 契約，本次也不新增一個可能過期的就緒旗標。FE 不應只根據寬限日期自行宣告可以成功結清。

建議顯示「已封存，等待自動結清」或「已結清」，在重新進入頁面、手動重新整理或頁面開啟期間定期取得最新資料。這個流程沒有新增廣告 SSE 事件，不需也不應由 FE 每 30 分鐘代替後端呼叫結清。

若保留手動「嘗試結清」按鈕，僅針對有權限且 archived / 未結清的廣告顯示；409 時顯示上述原因並保留等待狀態。

## 5. 手動 API 與重複呼叫

```http
POST /api/admin/advertisement/ADVERTISEMENT_UUID/financial-close
Authorization: Bearer ACCESS_TOKEN
```

不需要 request body。權限仍為所屬賣家或平台管理員。

成功回應維持 `{ "success": true, "data": <advertisement> }`，其中 `data.financiallyClosedAt` 非 null。以下情況都會成功回傳既有結清結果：

- 同一個賣家呼叫第二次。
- 排程已先完成，賣家再呼叫。
- 排程和手動請求同時抵達：交易鎖會序列化，後到者讀取已完成結果。

不會重複返還餘額或重複沖銷，也不會改寫原始結清時間。即使 `archiveGraceEndsAt` 尚未到，已成功結清的重試仍成功。未授權、不存在、帳本停用等錯誤仍依既有規則處理；並非任意請求都保證 200。

阻擋範例：

```json
{
  "success": false,
  "message": "Advertisement still has collecting reward cycles.",
  "code": "AD_FINANCIAL_CLOSE_CYCLES_PENDING"
}
```

未封存或帳本停用仍回傳 409，可能沒有 `code`。網路逾時／伺服器錯誤可重新讀取廣告狀態或重試；不要將失敗的請求本身視為已結清。

## 6. 結清與回收／轉移是不同步驟

結清會把未取得的賣家資金餘額返還到**原廣告 balance**，將剩餘平台墊款列為平台促銷支出，關閉廣告 funding account 並記錄 `financiallyClosedAt`。本次沒有自動匯回賣家錢包、提領現金或替新廣告儲值。

結清後仍使用既有端點：

| 操作 | Endpoint |
| --- | --- |
| 預覽可回收金額及限制 | `GET /api/admin/advertisement/:id/budget-withdrawal-preview` |
| 全額或部分回收到賣家錢包 | `POST /api/admin/advertisement/:id/budget-withdrawal` |
| 移到符合條件的直接接替廣告 | `POST /api/admin/advertisement/:id/balance-transfer` |

回收的 preview token、expected balance、idempotency key，以及轉移的直接接替關係、目的廣告狀態等既有檢查都保留。詳見 [BE_REQUIREMENT_1001_API_CHANGES.md](BE_REQUIREMENT_1001_API_CHANGES.md)。結清後使用者金幣到期或退款仍可能依既有帳務規則增加原廣告 balance，所以回收前應重新取得 preview。

完整操作範例：封存 A → 立即建立並獨立儲值／啟用 B → 後端自動結清 A → FE 讀到 A 的 `financiallyClosedAt` → 賣家選擇全額／部分回收，或轉移到符合條件的 B。

## 驗證與交付

已通過 `npm run build`、`npm run test:api`、`npm run test:coin-ledger`、`npm run test:cron`，以及 Swagger 解析／契約檢查。整合測試使用獨立的 disposable PostgreSQL 資料庫並在結束後刪除，不修改已設定的 local／development／staging DB。

涵蓋商品 null／單一廣告回應、封存後並行建立新廣告、派發／未完成週期／待領寶箱阻擋、到期清理後自動結清、已領金幣保留、手動與排程並行／重試、返還資金與結清並行、單筆失敗隔離，以及跨頁候選不被阻擋紀錄餓死。本次沒有部署或對真實環境執行結清。
