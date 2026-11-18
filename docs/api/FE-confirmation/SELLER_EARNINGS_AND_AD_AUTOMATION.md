# FE／AI 實作規格：賣家收益、存提申請與廣告管理

最後更新：2026-11-18（新增批次設定自動補款；本次新增尚未部署）。既有功能狀態：已合併至 development，local 與 dev 資料庫遷移完成且結構一致；尚未推送本次提交或部署／重啟 dev 服務。

團隊業務摘要及完整新增 API 一覽見 [11/17 定案摘要與附錄](../../plans/SELLER_EARNINGS_MEETING_AGENDA_ZH_TW.md)。本文保留 FE 串接所需的參數、欄位及操作細節。

## 文件用途與交付方式

交付 FE 的兩份文件：

1. `SELLER_EARNINGS_MEETING_AGENDA_ZH_TW.md`：給開發者及產品人員閱讀的精簡業務定案。
2. 本文件：給 FE 開發者與 AI 使用的詳細串接及畫面實作規格，不是後端原始碼副本。以下包含新 API、既有 API 異動、角色限制、資料映射、操作流程與驗收項目。

可直接交給 FE AI 的任務：

> 請先閱讀這兩份文件，再檢查目前前端專案的路由、登入角色、API client、表單、金額處理、列表與錯誤處理方式，依現有架構實作本文列出的畫面及 API 串接。沿用專案元件與樣式，不重做後端帳務計算。後端負責抽成、退款、保留款、欠款、收益開放及自動補款；前端呈現後端數值與允許的操作。不得自行新增未列出的 API、銀行串接、退款凍結、補款排程或錢包互轉。完成後提供修改清單與下方驗收結果；若目標環境尚未部署，明確區分模擬測試與真實串接結果。

本文的路徑均包含 `/api/admin`；賣家登入同樣使用後台 API。所有路由需要既有登入憑證。成功回應以 `{ "success": true, "data": ... }` 包裝；沿用現有 API client 與錯誤合約，不假設每個錯誤都有固定 `code`，應保留 `message` 及可用的追蹤資訊。

## API 總表與權限

| 方法 | 完整路徑 | 使用者及用途 |
| --- | --- | --- |
| GET | `/api/admin/seller-earnings/summary` | 賣家本人／管理員：收益與餘額 |
| GET | `/api/admin/seller-earnings/transactions` | 賣家本人／管理員：交易歷史 |
| GET | `/api/admin/seller-earnings/requests` | 賣家本人／管理員：申請歷史 |
| POST | `/api/admin/seller-earnings/requests` | 僅賣家：建立入出金申請 |
| PATCH | `/api/admin/seller-earnings/requests/:id` | 管理員審核；賣家只可取消自己的待處理申請 |
| POST | `/api/admin/seller-earnings/:sellerId/adjustments` | 僅管理員：人工增減收益 |
| POST | `/api/admin/seller-earnings/:sellerId/shipping-subsidy-reversals` | 僅管理員：核實零費用後退回超商補貼 |
| POST | `/api/admin/advertisement/batch/budget` | 所屬賣家／管理員：批次補款 |
| PATCH | `/api/admin/advertisement/batch/status` | 所屬賣家／管理員：批次啟用／暫停 |
| GET | `/api/admin/advertisement/:id/auto-refill` | 所屬賣家／管理員：讀取自動補款設定 |
| PUT | `/api/admin/advertisement/batch/auto-refill` | 所屬賣家／管理員：批次設定自動補款 |
| PUT | `/api/admin/advertisement/:id/auto-refill` | 所屬賣家／管理員：儲存自動補款設定 |

一般員工不支援上述新功能。管理員查詢前三支 GET 時必須帶 `sellerId`；不是全平台列表。賣家省略該參數即查自己。切換賣家時重置列表頁碼，快取鍵必須包含賣家、日期與列表篩選，避免顯示上一位賣家的資料。

既有 API 異動：

| API | FE 修改 |
| --- | --- |
| `GET /api/admin/advertisement/metrics` | 使用新增儲值欄位與既有期間消耗，詳見下文。 |
| `GET /api/admin/refund/list`、`GET /api/admin/refund/:refundItemId` | 讀取 `shippingReimbursement`，呈現原運費與資格。 |
| `PATCH /api/admin/refund/:refundItemId/status` | 改用原運費勾選及其他補償拆分欄位，保留原退款狀態流程。 |
| `POST /api/admin/account-wallet/:accountId/credit` | 已停用並回傳 410；移除管理員直接入金入口，改由既有賣家申請完成入帳。 |
| 既有廣告錢包摘要／交易列表 | 支援 `seller_deposit`、`seller_withdrawal` 類型及 `sellerDeposits`、`sellerWithdrawals` 摘要欄位，既有歷史保留。 |

## 錢包及金額定義

現有廣告錢包與新收益錢包完全分開。廣告預算只扣現有錢包，不能使用收益錢包或提領保留款。既有 wallet 的 `totalRevenueCash`／`totalRevenueCoin` 不作為新收益資料來源。

新收益金額回傳十進位字串。現金以 TWD、`coins`／`coinBalance`／`coinEarnings` 以金幣枚數表示。交易中的 `coinValue`／`grossCoinValue` 是金幣的 TWD 等值，乘以 10 才是金幣數。內部收益保留六位小數，不要用浮點數累加帳務。

## 收益查詢

| API | 用途 |
| --- | --- |
| `GET /api/admin/seller-earnings/summary` | 目前餘額、待開放、保留款、可申請提領額、欠款與期間收益 |
| `GET /api/admin/seller-earnings/transactions` | 收益交易歷史 |
| `POST /api/admin/seller-earnings/:sellerId/adjustments` | 管理員人工增減收益 |
| `POST /api/admin/seller-earnings/:sellerId/shipping-subsidy-reversals` | 管理員核實整個超商寄送已取消且未產生物流費後，退回原運費補貼 |

賣家只能查看自己；管理員查詢時必須提供 `sellerId`；員工不支援新錢包操作。查詢接受 `startAt`／`endAt`（含兩端的時間戳記）；不傳即查起算後全部期間。交易列表另接受 `page`（預設 1）、`limit`（預設 20，上限 100），回傳 `transactions`、`total`、`totalPages`、`page`、`limit`。日期只篩選歷史收支，summary 的餘額永遠是目前值。

Summary 主要欄位：

- `cashBalance`、`coinBalance`：目前剩餘收益。
- `cashEarnings`、`coinEarnings`：選定期間的商品銷售減已完成商品退款，尚未扣佣金；不含運費、人工調整及提領。
- `pendingCash`／`pendingCoins`、`releasedCash`／`releasedCoins`、`reservedCash`／`reservedCoins`：分幣別的待開放、已開放與保留款；`retainedCashRemainder`／`retainedCoinsRemainder` 是未保留款中未達提領單位的尾數。
- `pendingAmount`、`releasedAmount`、`reservedAmount`：TWD 等值。保留款仍包含在已開放餘額中。
- `withdrawableCash`、`withdrawableCoins`：已扣保留款及尾數限制的可申請組合；`withdrawableAmount` 為其 TWD 合計。
- `debt`：待抵扣款項；大於零時不可新提領，不顯示成負的可提現金額。
- `breakdown`：依 `type` 彙整期間收支、商品毛收益、佣金及額外退款。類型包括 `sale`、`refund`、`shipping`、`shipping_credit`、`shipping_reversal`、`adjustment`、`release`、`withdrawal`。`release` 只改變開放狀態，不是另一筆收入。
- `accountingWarnings`：運費資料無法核對的寄送與訂單 ID；管理員需核對並以獨立調整補正，不用未知金額自動入扣帳。
- `coverageStart`：收益起算時間；未設定時為 null。`asOf` 為查詢時間。

人工調整 body：`direction`（`increase`／`decrease`）、`cash`、`coins`（字串，省略預設 0）、`reason`、`idempotencyKey`（8–120 字元）。合計必須大於零。只限管理員；增加先抵欠款，剩餘立即開放；減少依既定扣款規則處理，不收佣金、不影響商品歷史收益。

原運費補貼退回 body：`shipmentId`、`evidence`（管理員核對未產生費用的說明）。只處理已記錄的超商補貼，該寄送的所有配送必須為 cancelled，且管理員必須確認外部零費用證據。每次寄送最多退回一次，重送回傳同一筆紀錄。配送取消狀態本身不代表沒有費用。

## 入金／出金申請

| API | 用途 |
| --- | --- |
| `POST /api/admin/seller-earnings/requests` | 賣家提出申請 |
| `GET /api/admin/seller-earnings/requests` | 查詢申請與審核歷史 |
| `PATCH /api/admin/seller-earnings/requests/:id` | 管理員處理申請，或賣家取消自己的待處理申請 |

建立範例：

```json
{
  "wallet": "revenue",
  "direction": "withdrawal",
  "cash": "400",
  "coins": "1000",
  "idempotencyKey": "seller-withdrawal-unique-001"
}
```

- `wallet=advertising`：支援現金 `deposit`／`withdrawal`，coins 必須為 0。
- `wallet=revenue`：僅支援 `withdrawal`。
- 現金提領為整元；金幣提領為 10 枚倍數；入金最多兩位小數。合計必須大於零。
- 提領建立時立即保留款項；入金建立時不增加餘額。
- 同一申請重試沿用同一 key；不同金額重用 key 回傳 409。
- 管理員不能主動建立一般入金／出金申請。舊 `POST /api/admin/account-wallet/:accountId/credit` 已停用，回傳 `410 WALLET_CREDIT_REQUIRES_REQUEST`。

審核 body：`action`、必填 `reason`、選填 `cash`／`coins`。兩種金額各自只能維持或減少，不能互換或增加；需要更多金額必須由賣家另提申請。

- 提領：`pending → processing → completed`。開始實際付款前送 processing；確認匯款完成才送 completed。
- 入金：管理員確認實際收到款項後，`pending → completed`。
- 待處理可 `rejected`；賣家可取消自己的 pending（`cancelled`）。全數不核准用 rejected，不用零元完成。
- processing 不可改金額、取消或拒絕；實際付款狀況不明時先核對，不能自行釋放款項。
- 減額、取消與拒絕會釋放多餘保留款。退款／人工扣款造成待處理提領的金幣現金組合不足時，該申請會取消並說明原因；已 processing 的款項受到保護。

列表接受 `sellerId`（管理員必填）、`status`、`page`、`limit`，回傳 `requests` 與分頁。每筆包含原申請 `requestedCash`／`requestedCoins`、最終 `cash`／`coins`、status、reason、history。既有廣告錢包交易新增 `seller_deposit`、`seller_withdrawal` 類型，原本歷史 API 保留；摘要增加 `sellerDeposits`／`sellerWithdrawals`。

## 批次廣告與儲值統計

- `POST /api/admin/advertisement/batch/budget`：body 為 `{ "items": [{ "advertisementId": "UUID", "amount": "500" }], "idempotencyKey": "unique-batch-key" }`。1–100 則不重複廣告，必須同一賣家。統一金額時每項填同一 amount。整批成功或整批回滾，錯誤包含出問題的廣告 ID，不會默默只加值部分廣告。
- `PATCH /api/admin/advertisement/batch/status`：body 為 `{ "advertisementIds": ["UUID"], "status": "active" }`，status 只接受 active／paused。逐則回傳 `{ advertisementId, success, data? , statusCode?, message? }`。外層成功不代表每則都成功。
- `GET /api/admin/advertisement/metrics` 新增 `totalFundedAmount`、`periodFundedAmount`，保留 `periodViewSpend`。加總 wallet_funding 與舊 deposit，包含手動／批次／自動補款，不含廣告間轉入、結算返還或回收。日期依事件時間、含 startAt／endAt 兩端。

以上寫入只允許所屬賣家或平台管理員，員工不能操作；保留現有廣告啟用及封存限制。

## 事件觸發自動補款

`GET /api/admin/advertisement/:id/auto-refill` 查詢，`PUT` 設定：

```json
{ "enabled": true, "amount": "500" }
```

只有開關與每次固定扣款金額。預設關閉、新設定預設 500 元，最低 100 元；更新時省略 amount 保留原設定。廣告餘額低於 100 元才補款，剛好 100 元不補。沒有每日上限。

觸發點為觀看扣款完成、廣告錢包入金完成、開啟或修改自動補款設定。沒有新增每分鐘排程。不以廣告分配或寶箱開啟觸發補款。多則等待補款時優先處理等待最久者。

錢包不足支付完整金額就跳過，不部分補款、不透支。手動暫停、封存、已結清、商品下架／軟刪除、賣家停用時不補款。可用金額排除提領保留款。`waitingSince` 與 `lastReason` 提供等待及未執行原因，例如 `insufficient_wallet_balance`、`not_eligible`、`balance_sufficient`、`funding_disabled`；資金不足的廣告維持原有停止曝光規則。

觀看與入金已提交後，補款失敗不回滾原操作。待處理事件保存在資料庫；事件重試與服務啟動時可補處理，不建立頻繁輪詢。並發事件會再次檢查餘額，不重複補款。

## 批次設定自動補款（2026-11-18）

`PUT /api/admin/advertisement/batch/auto-refill`

```json
{
  "advertisementIds": ["廣告 UUID 1", "廣告 UUID 2"],
  "enabled": true,
  "amount": "500.00"
}
```

- 每次 1–100 則不重複廣告，同一組 enabled／amount 套用至所有選取項目。賣家只可設定自己的廣告；管理員可跨賣家，員工不可操作。
- amount 可省略：保留每則廣告既有金額；尚無設定時預設 500 元。批次關閉可只傳 IDs 與 enabled=false，不重設原金額。
- 單則與批次均為最低 100 元、最多兩位小數；技術上限 90,071,992,547,409.91 元，尚未另訂業務上限。建議以十進位字串傳送。
- 請求格式、重複 ID 或金額範圍錯誤整批回 400，不進行任何設定。合法請求則依傳入順序逐則處理；不存在／無權限項目失敗，不回滾其他成功設定。
- 回應為 `{ success: true, data: [...] }`；每項包含 advertisementId、success，成功含 data 設定，失敗含 message 及可能的 statusCode／code。外層成功不代表所有廣告成功。
- 成功代表設定已保存，不代表已補款。enabled=true 會立即嘗試低餘額補款；資金不足或不符合資格時仍可保存設定，使用 lastReason 顯示原因。請同步刷新設定、廣告餘額及廣告錢包。
- 這不是一次性整批儲值，不使用 batch/budget 的整批回滾規則，也不需要 idempotencyKey。重送會重新檢查低餘額條件：餘額足夠不重複補；若期間又被消耗至門檻以下，可再次補款。

FE 在廣告列表多選操作增加「設定自動補款」，顯示開關、可選的統一金額及可能立即扣款的提示；結果逐則呈現，僅重試失敗項目。不要將保存設定顯示成全部儲值成功。

## 原運費一次性退還

管理員退款 list／detail 新增 `shippingReimbursement`，含 `buyerPaidAmount`、status、canReimburse、claimedByRefundId、shipmentId、shippingAmount、otherAmount。

虛擬商品未提供運費欄位時按零運費核對；訂單運費核對一致後，回傳 `buyerPaidAmount: "0.00"`、`status: "not_applicable"`、`canReimburse: false`，不列入運費待核對警示。實體寄送缺少運費資料仍須核對。

退款更新新增 `reimburseOriginalShipping` 與 `otherExtraRefundAmount`。使用新拆分欄位時不要同時送 extraRefundAmount，後端會計算合計。已建立寄送快照的退款有正額外退款時，需使用拆分欄位。買家原付款與退款輸出保持不變。

選取原運費時立即保留同一寄送的一次性資格；退款完成後耗用，取消／拒絕釋放。商品間共用同一寄送也不能重複領。已完成退款仍不可編輯。資料缺失、歷史不明或運費無法與訂單實收核對時，回傳 needs_review，不能勾選原運費退還；請管理員核對，不把未知當作零或可再次退還。`canReimburse` 表示寄送資格，FE 仍須遵守退款狀態的可編輯限制。

## 發布與測試注意事項

- 新收益記帳由 `SELLER_EARNINGS_LAUNCH_AT` 控制，值為含時區的 ISO 時間。未設定不自動建立銷售收益。部署時明確選定啟用時間，不設定過去時間來代替歷史匯入。
- 只記錄該時間起確認付款的訂單；舊銷售不匯入，沒有對應新銷售入帳的退款不扣新收益錢包。
- 每天 Asia/Taipei 03:00 開放滿保留期的剩餘收益，啟動時補處理已到期項目。正式／stg 為 336 小時；明確 local／development 為 33 小時 36 分鐘。實際匯款仍需管理員處理。
- local 已依序套用 `drizzle/local/0122_fixed_stingray.sql` 與 `0123_fluffy_spyke.sql`；`.env.local` 收益起算時間為 `2026-11-17T00:00:00+08:00`，不自動回補已處理的歷史交易。dev 已套用 `drizzle/dev/0073_peaceful_green_goblin.sql`，`.env.development` 起算時間為 `2026-11-17T17:30:27.930+08:00`；本機環境檔不會隨 Git 推送，實際 dev 服務須同步設定並載入新版本。stg／production 尚未遷移，應以各自 migration history 產生及檢查遷移，不跨環境複製 snapshot。
- 新表必須先部署，才啟動新版本。退款／廣告流程也會使用新表，即使未啟用自動收益仍不能略過遷移。
- Flutter 路徑、請求及既有回應不新增必要欄位；新資料放於獨立表及 admin API，避免共用 relation 將內部欄位送到 App。
- `NO_CRON=true` 停用排程及啟動時補處理；API 事件觸發補款仍可執行。測試使用獨立拋棄式資料庫，不操作共享環境資料。

## FE 畫面實作與資料映射

| 畫面／區塊 | 資料來源與操作 |
| --- | --- |
| 廣告收入總覽：金幣收益 | `summary.coinEarnings`，單位枚；選定期間商品收益，尚未扣抽成，不是金幣餘額。 |
| 廣告收入總覽：現金收益 | `summary.cashEarnings`，單位 TWD；選定期間商品收益，尚未扣抽成。 |
| 廣告收入總覽：可提現金額 | `summary.withdrawableAmount`，不要自行將全部現金及金幣餘額相加代替。 |
| 收益錢包 | 分別呈現 cashBalance／coinBalance、待開放、已開放、申請保留款及尾數；使用 API 已計算的值，不再扣一次抽成或保留款。 |
| 欠款與運費警示 | debt 大於零顯示待抵扣款項並停用新提領；accountingWarnings 非空呈現待核對資訊，不當作零運費。 |
| 收益交易列表 | transactions，顯示類型、時間、現金／金幣變動及 detail；release 是狀態變更，不列為新收入。 |
| 入出金申請頁 | requests，顯示 wallet、direction、status、原始／最終金額、reason、history；建立時選正確錢包。 |
| 管理員帳務調整 | 選賣家、增減方向、cash、coins、原因；與銀行入出金申請分開。 |
| 廣告列表／設定 | 多選批次補款或狀態操作，單則提供自動補款開關與金額。 |
| 退款列表／明細 | 運費實付額、資格、原運費勾選及其他補償；遵守既有退款可編輯狀態。 |

日期選擇應轉為含時區的起訖時間，例如臺北日期 11/17 對應 `2026-11-17T00:00:00+08:00` 至 `2026-11-17T23:59:59.999+08:00`。交由 HTTP client 編碼 query（尤其 `+08:00`），不要直接拼接未編碼的 `+`。歷史篩選含兩端，清除日期後回到完整起算期間。

收益摘要與交易列表接受日期；申請列表僅支援 sellerId、status、page、limit，目前沒有日期、wallet 或 direction 的伺服器篩選，不能自行假設有這些查詢參數，也不能把單頁篩選冒充完整資料結果。

金額以十進位字串傳送，顯示可格式化但不可把格式化後的逗號、貨幣符號送回。收益錢包提領以 withdrawableCash／withdrawableCoins 作表單上限；提交前後仍以後端檢查為準。期間商品收益可為負數，不能強制顯示零；未設定 coverageStart 或查詢失敗，也不要假裝是正常零收益。

### 申請狀態對應操作

| 狀態 | 賣家 | 管理員 |
| --- | --- | --- |
| pending | 取消自己的申請 | 入金：確認收款後完成；提領：確認金額後開始付款；也可拒絕。 |
| processing | 只能查看 | 只在確認付款後完成，不改金額、不取消或拒絕。 |
| completed／cancelled／rejected | 查看紀錄 | 查看紀錄，不再修改。 |

提領審核範例（減少現金與金幣後開始付款）：

```json
{ "action": "processing", "cash": "300", "coins": "500", "reason": "確認本次付款金額" }
```

確認銀行付款後使用同一路徑：

```json
{ "action": "completed", "reason": "已核對銀行付款完成" }
```

審核畫面顯示原申請與目前核定值；若金額已減少，不能再次調高到原申請額。不得將點擊「開始付款」視為銀行付款成功。賣家取消同樣要送 reason。

### 原運費顯示對照

| status | 顯示 | 行為 |
| --- | --- | --- |
| available | 尚未退還 | 依 canReimburse 及退款可編輯狀態允許勾選。 |
| reserved | 已由退款保留 | 顯示相關退款；可能是本筆退款自己保留，不能單靠 status 禁用，需看 canReimburse。 |
| refunded | 已退還 | 禁止再次退還。 |
| not_applicable | 不適用／無原運費可退 | 禁用勾選，零運費顯示 0。 |
| needs_review | 運費待核對 | 未知金額顯示「待核對」，不能轉為 0 或允許勾選。 |

退款拆分欄位示例（併入既有合法退款更新內容）：

```json
{ "reimburseOriginalShipping": true, "otherExtraRefundAmount": 30 }
```

`otherExtraRefundAmount` 是 JSON number，與新錢包 API 的字串金額不同。此例代表退還原運費再加 30 元其他補償；不要同時送 `extraRefundAmount`。退貨寄回運費不放在此欄位，管理員另外調整收益。

### 重試、更新與錯誤處理

- 建立申請、人工調整與批次補款各自生成 idempotencyKey。同一次送出或網路逾時重試沿用原 key 與原內容；新操作使用新 key。不得在每次 retry 自動換 key。
- 提交中停用重複點擊。成功後重新取得受影響的摘要、歷史及申請；廣告補款還需更新廣告餘額、統計及廣告錢包。
- 儲存自動補款設定可能立即觸發補款；儲存後重新 GET 設定並更新相關餘額，不只修改本機開關。
- 批次狀態回應 data 是逐則結果陣列，逐項檢查 success；批次補款則整批成功或失敗，不能混用顯示方式。
- 400 顯示欄位／業務限制；403 停止無權限操作；409 顯示衝突並重新取得最新資料；410 停用舊直接入金流程。不要在未知付款結果時自動重新建立另一筆申請。
- 沿用現有重新整理機制；前端不定時呼叫補款或自行計算開放。即使 UI 顯示餘額足夠，並發退款或其他操作仍可能使提交失敗。

## FE 驗收清單

- [ ] 賣家只能看自己；管理員可選賣家，一般員工無新操作入口；切換賣家不殘留上一位資料。
- [ ] 三張收益卡正確映射；切換期間只改期間收益與歷史，不改目前餘額；負收益、空資料及失敗狀態分開處理。
- [ ] 現金與金幣單位正確，coinValue 換算為枚時乘 10，沒有重扣抽成或提領保留款。
- [ ] 廣告錢包支援入金／提領，收益錢包僅提領；管理員不能建立一般申請。
- [ ] 現金整元、金幣 10 枚倍數及各自可用上限有驗證；有欠款不可新提領。
- [ ] 審核只能減少各幣別，processing 不可修改／取消；完成付款才扣帳，重試不重複入扣帳。
- [ ] 退款導致 pending 申請取消後能刷新狀態與原因；不把 processing 保留款當可用額。
- [ ] 人工收益調整、退貨運費扣款與一般銀行存提分開；有原因與結果紀錄。
- [ ] 原運費只退一次；reserved 正確辨識本筆資格；虛擬商品零運費為 not_applicable，未知實體運費為 needs_review。
- [ ] 批次補款顯示總額及整批結果；批次狀態逐則回報失敗。
- [ ] 自動補款只提供開關及金額，最低 100、預設 500；低餘額／資金不足原因可見，沒有前端補款排程。
- [ ] 舊直接入金入口移除，新錢包交易類型有顯示文字；實際測試環境已部署對應後端及資料表。

如 FE AI 同時能讀取後端專案，可交叉核對 `src/routers/admin/admin-seller-earnings.ts`、`src/middleware/admin/sellerEarnings.ts`、`src/routers/admin/admin-advertisement.ts` 與 `src/routers/admin/admin-refund.ts`；Swagger 位於 `/api-docs`。本文已提供獨立交付需要的規則，不要求 FE 複製後端資料庫或記帳程式。

## 2026-11-17 dev 遷移驗證

已將收益功能合併至 development，套用 dev 遷移後，以 PostgreSQL 系統目錄比對 local 與 dev：兩者皆為 76 張 public 資料表，欄位型別／預設值／可空性、主外鍵與檢查限制、索引、列舉值及其順序、檢視表、非內建觸發器與資料存取政策均一致。比較已排除 PostgreSQL 版本對 NOT NULL 的目錄表示差異，並以實際列舉順序取代內部排序數值。兩邊均無待套用的已登錄遷移。

本次同步僅針對應用資料庫結構，未複製 local 訂單、帳戶、餘額或測試資料至 dev；各環境遷移歷史保留獨立。

## 廣告列表與單筆詳情自動補款開關（2026-11-18）

`GET /api/admin/advertisement/list` 的 `data.advertisements[]` 每筆，以及 `GET /api/admin/advertisement/:id` 的 `data`，均包含頂層 `autoRefill: boolean`：true 表示設定已開啟，false 表示關閉或尚未設定。FE 可直接顯示開關狀態，無須逐則查詢。

此值只代表設定，不代表廣告目前符合補款資格或已成功扣款；暫停的廣告仍可能設定為 true。需要每次補款金額或等待原因時，仍查詢 `GET /api/admin/advertisement/:id/auto-refill`。修改設定後刷新列表與詳情。原分頁、權限與其他欄位不變，不影響 Flutter API，無需資料庫遷移。

上述列表與單筆詳情亦包含頂層 `autoRefillAmount: string`，表示每次自動補款的設定金額（台幣，例如 `"500.00"`）。關閉時仍回傳保留的設定金額；尚未設定時回傳預設 `"500.00"`。此值不是廣告目前餘額，也不是已補款金額。

### 廣告列表：投放狀態與商品狀態篩選

`GET /api/admin/advertisement/list` 支援選填 `productStatus=active|inactive`，可與 `status=active|paused|depleted|archived` 組合（AND）。查詢全部時省略對應參數，不傳 `all`。賣家權限範圍不變，`total`、`totalPages` 與列表套用相同條件。

主頁籤使用廣告狀態：全部／啟用中／已暫停／預算不足／已封存。每個主頁籤下可設全部商品／商品上架中／商品已下架子頁籤。切換篩選時重設 `page=1`，不要只對當頁資料自行分類。`total` 是當前篩選組合的筆數，並非所有頁籤的統計。

```http
GET /api/admin/advertisement/list?status=active&productStatus=inactive&page=1&limit=20
```

此例查詢投放設定啟用、但商品已下架的廣告；商品下架時不會實際投放。軟刪除商品不會被排除，依資料庫的 `product.status` 篩選，FE 可額外用 `product.deletedAt` 標示已刪除。已封存廣告同樣可依商品狀態篩選，並用 `financiallyClosedAt` 區分結清中與已結清。

列表亦支援選填 `search`（去除頭尾空白後最多 200 字元），不分英文大小寫，以包含關鍵字比對「廣告標題或商品名稱」。空字串／全空白等同不篩選；`%`、`_` 為一般文字，不是萬用字元。搜尋與 `status`、`productStatus`、`sellerId` 同時套用，分頁總數亦一致。FE 請 URL encode 關鍵字並在修改搜尋時重設 `page=1`。

```http
GET /api/admin/advertisement/list?search=Netflix&status=active&productStatus=inactive&page=1&limit=20
```
