# 地平線 FE 補充答覆：廣告結清、金幣到期、錢包儲值與收益來源

日期：2026-10-07  
核對範圍：目前 `development` checkout 的 API 路由、服務、repository、schema 與排程。本文只說明現有行為，不新增 API、不修改程式或資料庫，也不代表已逐一驗證部署環境的排程執行狀態。

請搭配先前提供的 [BE_REQUIREMENT_1001_API_CHANGES.md](BE_REQUIREMENT_1001_API_CHANGES.md) 閱讀，尤其是「回收廣告費」、「Admin login and token refresh」與「Company internal statistics」章節。該文件開頭的部署狀態是交付當時的紀錄；實際環境是否部署／套用 migration，需以該環境為準。

## 先回答四項是否已包含

FE 目前觀察到的「手動結清及回收、管理員確認入帳、金幣到期處理」是正確的。已完成的範圍不能解讀成下列四項都已提供。

| FE 問題 | 目前是否支援 | 現有實作與 FE 做法 |
| --- | --- | --- |
| 1. 封存滿 25 小時，自動結清並把剩餘廣告預算存回錢包 | **沒有這個自動流程** | 由有權限的使用者呼叫 financial-close，再預覽及確認回收。到期排程不會自動呼叫這兩個動作。 |
| 2. 用戶金幣到期後，折現並直接存入來源賣家錢包 | **有到期／返還帳務，但不是直接入錢包** | 廣告出資且符合返還條件的部分回到來源廣告餘額；已結清廣告可再手動回收至賣家錢包。不同金幣來源有不同處理，不能把全部到期金幣一律算成賣家入帳。 |
| 3. 賣家自行付款／儲值到錢包的 checkout API | **沒有** | 現有 `/account-wallet/:accountId/credit` 僅供平台管理員記錄已確認的入帳，不建立付款訂單或收款頁。 |
| 4. 金幣收益、現金收益與可提現金額的正式統計來源 | **尚無完整的賣家收益結算／提現契約** | 可取得錢包餘額、資金流、營運銷售指標及廣告帳務；不可把這些欄位直接當成已結算收益或可匯到銀行的金額。 |

下列 endpoint 均為完整路徑；有保護的 API 使用既有 Bearer access token。Swagger 入口為 `/api-docs`，可依 `Advertisement`、`Account Wallet`、`Dashboard` 分類查詢。

## 1. 廣告封存後如何結清、回收？

### 時間與排程的實際規則

- 廣告第一次轉為 `archived` 時，後端寫入 `archivedAt` 與 `archiveGraceEndsAt`。
- 寬限時間由 `AD_ARCHIVE_GRACE_HOURS` 決定，程式預設 **24 小時**，不是固定 25 小時。FE 應以該廣告實際的 `archiveGraceEndsAt` 為準。
- 寬限期結束只是結清條件之一；若仍有待處理的寶箱領取需求（`demand` allocation），結清會回 409。
- 金幣維護排程在程式中設定為每 30 分鐘執行一次，處理寶箱、金幣到期、結算批次及廣告派發紀錄。它**不會設定廣告的 `financiallyClosedAt`，也不會自動把廣告餘額搬到錢包**。
- 排程需要程序持續運行、`NO_CRON` 不為 `true`，且啟用 coin ledger。批次上限、執行失敗與積壓都可能影響處理時間，因此不能用「已過 25 小時」判定一定結清完成。

### FE 可接的手動流程

| 步驟 | API | FE 行為 |
| --- | --- | --- |
| 1. 封存 | `PUT /api/admin/advertisement/status/:id`，body `{"status":"archived"}` | 由有權限的操作者確認；已封存廣告不能重新啟用。若廣告已封存，略過此步。 |
| 2. 讀取狀態 | `GET /api/admin/advertisement/:id` | 查看 `archivedAt`、`archiveGraceEndsAt`、`financiallyClosedAt` 及廣告餘額。不要只靠 FE 倒數推定成功。 |
| 3. 結清 | `POST /api/admin/advertisement/:id/financial-close` | 不需 body。來源賣家或平台管理員操作；未符合條件時處理 409 並顯示後端訊息。 |
| 4. 回收預覽 | `GET /api/admin/advertisement/:id/budget-withdrawal-preview` | 結清後重新取得 `eligible`、`reasons`、`balance`、`confirmationToken`，讓使用者確認。 |
| 5. 回收 | `POST /api/admin/advertisement/:id/budget-withdrawal` | 使用剛取得的預覽提交全額或指定金額。回收僅允許 active 平台管理員或 active 所屬賣家；employee 不可操作。 |
| 6. 更新畫面 | 錢包、錢包交易、廣告明細／報表 API | 以後端回傳及重查結果更新金額，不自行假設已入帳。 |

**financial-close 成功不等於錢包已入帳。** 它會處理可返還的廣告出資餘額、將剩餘平台墊付依既有邏輯轉為平台促銷費用，並關閉 funding account／標記廣告已結清。回收至錢包是另一筆使用者確認的操作。

全額回收範例（UUID 與 token 請代入實際值）：

```http
POST /api/admin/advertisement/ADVERTISEMENT_UUID/budget-withdrawal
Content-Type: application/json
Authorization: Bearer ACCESS_TOKEN
```

```json
{
  "mode": "all",
  "expectedBalance": "1000.00",
  "confirmationToken": "TOKEN_FROM_LATEST_PREVIEW",
  "idempotencyKey": "recover-ad-20261007-0001"
}
```

指定金額時使用 `mode: "amount"` 並加上 `amount: "300.00"`；`mode: "all"` 不可帶 `amount`。金額使用十進位字串。同一筆回收的逾時重試保留原 body 與 idempotency key；`BALANCE_CHANGED` 需要重新預覽及確認新的操作。其他欄位與錯誤碼請依 [原交付文件](BE_REQUIREMENT_1001_API_CHANGES.md)。

即使 FE 原本移除了封存／結清 UI，目前後端前置條件仍存在。要提供回收功能，需讓有權限操作者能完成上述流程，或由既有管理流程先完成。不要用瀏覽器計時器假裝有後端自動結清／回收服務。

## 2. 用戶金幣到期後，資金實際去哪裡？

### 廣告出資的金幣

一般廣告來源的到期未用金幣，後端會辨識賣家出資與平台出資部分。符合返還條件的賣家出資部分按目前換算邏輯形成台幣等值，入帳位置是：

```text
用戶到期未使用金幣（符合返還條件的賣家出資部分）
  → 來源廣告餘額增加
  → 若該廣告已封存且 financial-close 完成
  → 操作者重新預覽／確認「回收廣告費」
  → 賣家 walletBalance 增加
```

例如應返還的 100 枚金幣按目前 10 coins/TWD 換算為 NT$10，會先增加來源廣告餘額 NT$10；賣家錢包此時不會因此增加。FE 顯示實際入帳時應使用後端的 `currencyEquivalent`、餘額及交易紀錄，不自行依「用戶到期金幣總數 ÷ 10」認列賣家收益。

- 廣告返還交易類型：`seller_return_credit`。
- 真正回收到錢包後才出現：廣告端 `budget_withdrawal`、錢包端 `advertisement_budget_return`。
- 平台出資／墊付部分依平台資金沖回規則處理，不會一律變成賣家收入。
- 已結清的廣告也可能收到較晚發生的金幣到期／退款返還；操作者可以取得新預覽後再次回收，或按既有規則轉至直接接替廣告。廣告不會因此重新啟用。
- 到期工作主要處理 lot 的到期可用金額；不能把保留中、已消費或所有歷史金幣都視為可立即返還。

### 其他來源不能混算

退款現金尾差轉成的金幣若符合到期返還條件，現有程式會寫入 `product_seller_coin_return_transactions`，但這條流程**沒有直接增加 `account_wallets.wallet_balance`**。此 repository 也沒有提供該表的專用賣家查詢 endpoint。不能僅因資料表名稱包含 seller return 就判斷已存入錢包。

歷史未歸屬或人工金幣也不能在沒有來源帳本證據時歸給某個廣告／賣家。

### FE 可讀的 API

| API | 用途與限制 |
| --- | --- |
| `GET /api/admin/advertisement/:id/coin-ledger` | 來源賣家或平台管理員查看 `fundingAccount`、`cohorts`、`sellerReturns`、`fundingTransactions`；是廣告資金帳，不是錢包入帳明細。現況最多回最近 100 個 cohort、100 筆 seller return、200 筆 funding transaction，不可據此自行加總全歷史。沒有 funding account 的廣告可能回 404。 |
| `GET /api/admin/advertisement/metrics` | 廣告餘額、`sellerReturnedAmount`、`netSettledSpend`、`budgetWithdrawnAmount`、`periodBudgetWithdrawnAmount` 等；金幣返還與回收至錢包分開呈現。 |
| `GET /api/admin/account-wallet/me/transactions?type=advertisement_budget_return` | 確認登入帳戶實際收到的「回收廣告費」。 |
| `GET /api/admin/account-wallet/:accountId/transactions?type=advertisement_budget_return` | 平台管理員查指定賣家的實際回收入帳。 |

金幣到期由後端維護流程處理；沒有提供 FE「讓全部用戶金幣到期並轉入賣家錢包」的公開操作 endpoint。

## 3. 賣家自助付款／儲值 checkout 是否已提供？

**目前沒有。** 現有接口為平台管理員確認款項後的入帳操作：

```http
POST /api/admin/account-wallet/SELLER_ACCOUNT_UUID/credit
Authorization: Bearer PLATFORM_ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "amount": "1000.00",
  "idempotencyKey": "confirmed-seller-credit-20261007-0001",
  "reason": "Confirmed bank transfer",
  "externalReference": "CONFIRMED-PAYMENT-REFERENCE"
}
```

- 僅平台管理員可呼叫，target 必須是 seller；此端點亦允許向 inactive/banned seller 做入帳更正。
- 它記錄已由外部流程確認的款項或人工更正，**不會向金流商驗證付款、建立儲值付款單、回傳付款頁或等待付款 webhook**。`externalReference` 是記錄欄位，不是付款成功證明。
- 成功後錢包交易類型為 `admin_credit`。同一筆預期入帳重試必須沿用 idempotency key。
- 賣家端只能查看錢包／交易，不應把這個管理員接口接成「立即付款儲值」按鈕。
- 若已有公司採用的線下匯款流程，可由 FE 呈現該既有流程；確認收款與入帳由管理員處理。本文不新增匯款帳號、付款憑證上傳或付款申請 endpoint。
- 現有 ECPay 商品訂單付款流程使用商品訂單 ID，並不是賣家錢包儲值流程，不能直接借用來認列儲值成功。

另請區分：`PUT /api/admin/advertisement/budget/:id` 的 `operation: "increase"` 是**錢包 → 廣告**資金移轉，不是外部付款 → 錢包。舊 `/advertisement/deposit/:id` 已退休。

## 4. 收益、錢包餘額與可提現金額應如何呈現？

### 可直接使用的來源

| 畫面指標 | 現有正式 API／欄位 | 可表達的意思 |
| --- | --- | --- |
| 錢包餘額 | `GET /api/admin/account-wallet/me` → `data.walletBalance` | 帳戶目前錢包帳面餘額，包含確認入帳、廣告資金支出／回收；不代表商品收益或可銀行提現額。 |
| 錢包資金流 | `GET /api/admin/account-wallet/me/summary` | `openingBalance`、`adminCredits`、`legacyOpeningCredits`、`advertisementFundingDebits`、`advertisementBudgetReturns`、`closingBalance`。可搭配 `startAt`／`endAt` 查期間。 |
| 錢包逐筆交易 | `GET /api/admin/account-wallet/me/transactions` | 分頁查詢入帳／廣告撥款／廣告回收，用於對帳。 |
| 營運銷售指標 | `GET /api/admin/dashboard/kpi` | `grossMerchandiseValue` 是 paid 訂單品項 `lineTotal` 加總；`completedRefundAmount` 是 completed 退款的 `cashRefundAmount` 加總；`netSales` 為兩者相減。是既有營運口徑，不是現金與金幣收益拆分或可提現餘額。 |
| 廣告帳務 | `GET /api/admin/advertisement/metrics` | 顯示廣告支出、金幣結算返還、廣告預算回收等，不是賣家商品收益。 |
| 公司整體統計 | `GET /api/admin/dashboard/kpi/internal`、`GET /api/admin/dashboard/time-series/internal` | 僅 active 平台管理員可看；呈現平台金幣池、廣告資金流等，非賣家收益／提現報表。依原交付文件處理 `coverage`、`null` 與日期規則。 |

管理員代查指定帳戶時，錢包 API 使用 `/api/admin/account-wallet/:accountId` 及其 `/summary`、`/transactions` 子路徑；`/me` 永遠代表目前登入帳戶，不會自動指向所選賣家。

營運 KPI 的日期邊界依訂單／退款的 `createdAt` 篩選，再搭配當前 paid／completed 狀態；不是付款入帳日／完成退款日的賣家結算流水。請勿將 `netSales` 重新命名為「已結算現金收益」。

### 已有欄位不代表完整結算能力

`AccountWallet` 回應確實含有 `totalRevenueCash`、`totalRevenueCoin`、`lockedBalance`；但目前 repository 中沒有找到由訂單付款、出貨或退款完成流程持續維護前兩個收益累計欄位的完整實作，也沒有完整的收益凍結／解凍、提現申請與付款結算流程。這些欄位預設為零；不能把零解讀成「經正式收益結算後確認沒有收入」。

因此，FE 請依下列方式處理：

1. 錢包頁可展示「錢包餘額」、「已確認入帳」、「廣告撥款」、「回收廣告費」與逐筆紀錄。
2. 金幣收益、現金收益若指「賣家已結算可領取的商品銷售收益」，目前標示「尚未提供／待結算功能」，或暫不顯示該卡片；不要以錢包或廣告數字替代。
3. **不要自行以 `walletBalance - lockedBalance`、`netSales`、金幣數除以 10，計算並宣稱銀行可提現金額。** 目前沒有正式的可提現統計／提現申請 endpoint。
4. 回收預覽中的 `withdrawableAmount` 是「這支已結清廣告可搬回錢包的金額」，不是錢包可匯到銀行的金額；操作名稱維持「回收廣告費」。
5. 公司內部統計的 `value: null` 或 partial/unavailable coverage，請保留「資料不可用／資料不完整」語意，不補成零或當成完整收益。

若之後要新增自動結清回收、賣家自助付款或收益提現，需要另行定義對應工作流程與 API；本文件沒有宣告其他未列出的 endpoint 已存在。

## Swagger 查找與既有文件

| Swagger 分類 | 應查找的路徑 |
| --- | --- |
| `Advertisement` | `/api/admin/advertisement/status/{id}`、`/{id}/financial-close`、`/{id}/budget-withdrawal-preview`、`/{id}/budget-withdrawal`、`/{id}/coin-ledger`、`/metrics`（後五項同屬 `/api/admin/advertisement`） |
| `Account Wallet` | `/api/admin/account-wallet/me`、`/me/summary`、`/me/transactions`，以及管理員指定帳戶的 `/{accountId}`、`/{accountId}/summary`、`/{accountId}/transactions`、`/{accountId}/credit` |
| `Dashboard` | `/api/admin/dashboard/kpi`、`/time-series`、`/kpi/internal`、`/time-series/internal`（同屬 `/api/admin/dashboard`） |

- [BE requirement 1001 API 交付文件](BE_REQUIREMENT_1001_API_CHANGES.md)：回收 request/response、預覽、錯誤碼、冪等、內部統計及登入續期的 Axios 建議。
- [錢包與廣告資金 API](ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md)：管理員確認入帳的用途及 wallet → ad 資金方向；新增交易類型以較新的 BE requirement 1001 文件為準。
- [Deposit API 退休說明](ADMIN_ADVERTISEMENT_DEPOSIT_RETIREMENT.md)：使用 budget/increase，不恢復 deposit。

## 後端核對依據

- [廣告狀態、financial-close 與 coin-ledger 查詢](../../../src/repository/advertisement.ts)。
- [預覽及原子回收至錢包](../../../src/repository/advertisementWithdrawal.ts)。
- [金幣到期、廣告返還及退款尾差返還](../../../src/repository/coinLedger.ts)。
- [排程設定](../../../src/lib/scheduler.ts)及[維護入口](../../../src/lib/coinLedgerMaintenanceJob.ts)。
- [錢包 API／Swagger](../../../src/routers/admin/admin-account-wallet.ts)及[錢包帳務](../../../src/repository/accountWallet.ts)。
- [營運 KPI 口徑](../../../src/repository/adminDashboard.ts)與[公司內部統計](../../../src/repository/internalStatistics.ts)。

本次為文件答覆及程式唯讀核對，不宣稱已完成上述尚未提供功能的驗收，也未觸發 financial-close、回收、入帳或金幣維護工作。
