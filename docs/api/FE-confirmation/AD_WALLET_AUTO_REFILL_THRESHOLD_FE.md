# FE 串接：廣告錢包自動補款停止門檻

日期：2026-11-24。BE 功能 commit：`0a7f6cb`，已合併至本機 `development`。資料庫 migration 已套用，BE 程式仍須部署後，遠端 API 才會有新行為。

## 功能與畫面

請在賣家的「廣告錢包／錢包與交易紀錄」頁，新增「自動補款停止門檻」金額欄位及「儲存」按鈕。這是每個賣家共用的錢包設定，影響該賣家的所有廣告；不是單則廣告設定，也不是收益錢包設定。

建議說明文字：

> 當錢包可用餘額低於此金額時，暫停所有廣告的自動補款。設為 0 表示不設定停止門檻。手動補款不受影響。

「可用餘額」＝ `walletBalance - lockedBalance`，請一併顯示。門檻可以高於目前餘額，不可因此禁止儲存。

門檻在**每次自動扣款前**檢查：設定 10,000，可用 10,000、補款 500 時，允許這次補款；剩下 9,500 後，其他廣告便不再自動補款。可用 9,999.99 時不補款。因此這不是「扣款後必須保留 10,000」的最低保留額。

## API

沿用現有 bearer token／API client。

| 使用者 | 讀取錢包與門檻 | 儲存門檻 |
| --- | --- | --- |
| 賣家本人 | `GET /api/admin/account-wallet/me` | `PATCH /api/admin/account-wallet/me/auto-refill-settings` |
| 平台管理員 | `GET /api/admin/account-wallet/{accountId}` | `PATCH /api/admin/account-wallet/{accountId}/auto-refill-settings` |

管理員須先選擇目標賣家，`accountId` 是該賣家的帳號 ID。員工不得修改；不可用員工自己的 `/me` 錢包代替賣家的錢包。

PATCH body（只有此欄位）：

```json
{"autoRefillStopThreshold":"10000.00"}
```

金額必填、非負、最多兩位小數。建議一律送十進位字串；字串最多 16 位整數，不能使用逗號、貨幣符號或科學記號。`"0.00"` 表示取消額外門檻。

GET／PATCH 成功皆為 `{success:true,data:AccountWallet}`；下列為部分欄位：

```json
{
  "success": true,
  "data": {
    "accountId": "SELLER_ACCOUNT_UUID",
    "walletBalance": "15000.00",
    "lockedBalance": "1000.00",
    "autoRefillStopThreshold": "10000.00"
  }
}
```

既有錢包預設 `autoRefillStopThreshold: "0.00"`。儲存成功以回傳 wallet 更新畫面；只改輸入值時不要呼叫 API。儲存設定本身不移動款項；背景補款可能稍後改變餘額。

錯誤：400 金額格式錯誤／目標不是賣家；401 未登入或憑證失效；403 權限不足／帳號不可用；409 錢包尚未初始化。不要將失敗的草稿顯示成已儲存設定。

## 自動補款等待狀態

原本的單則廣告自動補款設定中，`lastReason` 新增 `wallet_below_auto_refill_threshold`，建議顯示「錢包可用餘額低於自動補款門檻」。BE 保留 `enabled: true` 與 `waitingSince`；FE 不應自動關閉開關或自行修改廣告投放狀態。錢包補足／保留款釋放／調低門檻後，符合資格的廣告可由背景流程重試。

手動補款及批次補款不受此門檻限制，但仍需有足夠可用餘額及符合原有廣告資格。預算不足等其他限制維持原規則。

## 驗收重點

- 正確讀取、修改及重新整理門檻；輸入變更不立即儲存，取消不寫 API。
- 拒絕負數、空白、超過兩位小數；允許 0，以及高於目前餘額的門檻。
- 正確顯示可用餘額，使用精確金額處理；10,000 相等邊界與扣款前判斷說明清楚。
- 儲存中禁止重複送出；失敗保留草稿並顯示原已儲存值。
- 管理員切換賣家不沿用前一位的草稿或延遲回應。
- 低於門檻時，各廣告開關仍顯示開啟；手動／批次補款仍能使用。

BE 已通過 build、seller-earnings、account-wallet 及 API e2e 測試。local/dev/stg 實際 schema 一致且無待執行 migrations；不代表已部署 API，或三個環境業務資料相同。
