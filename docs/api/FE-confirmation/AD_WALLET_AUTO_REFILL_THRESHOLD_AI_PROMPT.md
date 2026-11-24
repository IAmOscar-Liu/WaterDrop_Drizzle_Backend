# 可直接交給 FE AI 的實作指令

請在目前 FE 專案實作「賣家廣告錢包自動補款停止門檻」。先讀專案 AGENTS／README、現有登入角色判斷、API client、廣告錢包頁及金額工具，再依下列合約完成程式與適當測試。保留無關修改，遵循現有元件與版型；不要修改 BE、資料庫或部署設定，不要以真實資金寫入測試。

## 目標與範圍

在廣告錢包／錢包與交易紀錄頁顯示與編輯一個賣家層級的金額設定。不要放到每則廣告的自動補款／扣款額度設定裡；不要混入賣家收益錢包。

本機參考版 FE 中，錢包 client 位於 `src/lib/accountWalletApi.ts`，頁面位於 `src/pages/AdRevenue.tsx`，使用 `oscarClient`；先確認你目前 checkout 的實際結構，不要假設檔名一定相同。目前的 `accountWalletApi.getWallet(accountId?)` 已讀取 `/api/admin/account-wallet/{me|accountId}`，可直接擴充。

## BE 合約（勿自行改名或推測其他 API）

需要已部署 BE commit `0a7f6cb` 的功能；已合併本機 development，migration 已套用，但遠端 API 需實際部署才可用。

1. 賣家讀取 `GET /api/admin/account-wallet/me`。
2. 管理員讀取 `GET /api/admin/account-wallet/{accountId}`，accountId 是選中的賣家帳號 UUID。
3. 賣家儲存 `PATCH /api/admin/account-wallet/me/auto-refill-settings`。
4. 平台管理員儲存 `PATCH /api/admin/account-wallet/{accountId}/auto-refill-settings`。
5. PATCH body 僅包含 `{"autoRefillStopThreshold":"10000.00"}`。
6. GET 與 PATCH 皆回傳 `{success:true,data:AccountWallet}`。Wallet 保留既有欄位，新增 `autoRefillStopThreshold: string`；`walletBalance`、`lockedBalance` 也都是十進位字串。
7. 初始預設 `"0.00"`，0 代表關閉額外停止門檻。非負、最多兩位小數；十進位字串最多 16 位整數，不接受逗號、貨幣符號、科學記號或其他 body 欄位。建議以字串傳送，勿用浮點數四捨五入掩蓋不合法輸入。
8. 錢包未初始化為 409；輸入格式錯誤或目標非賣家為 400；未登入為 401；無權限／停用帳號為 403。沿用既有 API 錯誤解析，不把失敗當成成功。
9. 員工不得修改；賣家不能修改別人的錢包。管理員必須先選定目標賣家。不要讓管理員用自己 `/me` 來設定賣家門檻。

## 精確業務語意

- 可用餘額 = `walletBalance - lockedBalance`，排除已保留款項。
- 每次「自動」補款前，BE 在錢包鎖內重新判斷可用餘額是否低於門檻。
- 門檻 10,000，可用 9,999.99：不自動補款。
- 門檻 10,000，可用 10,000，單次補款 500：允許這次，剩下 9,500 後停止後續補款。這不是扣款後必須維持的最低保留額。
- 門檻 0：只取消額外門檻，仍須有足夠可用餘額支付完整補款金額。
- 門檻可以大於當前餘額，這是合法且有意義的設定。
- 手動補款／批次補款不受門檻限制，原本餘額及資格驗證照常。不要用新門檻灰化這些操作或改動既有驗證。
- 觸發門檻時不關閉各廣告 `enabled`、不修改投放狀態、不新增扣款。既有 auto-refill GET 的 `lastReason` 可回 `wallet_below_auto_refill_threshold` 並保留 `waitingSince`。
- 已有其他 lastReason（如 `insufficient_wallet_balance`、`not_eligible`、`balance_sufficient`、`funding_disabled`）仍可出現；對未知值保留通用呈現。
- 儲存設定只排入背景工作，不立即補款；儲存成功不等於資金已移動。錢包補足、保留款釋放或門檻降低後由 BE 正常重試，不需要 FE 對每個廣告發送啟用或補款請求。

## UI 與狀態要求

在廣告錢包區新增：

- 「自動補款停止門檻」金額輸入、單位「元」與「儲存」按鈕，可提供取消／重設為已儲存值。
- 顯示目前可用餘額及已儲存門檻。0 可顯示「未設定門檻」。
- 說明：「當錢包可用餘額低於此金額時，暫停所有廣告的自動補款。設為 0 表示不設定停止門檻。手動補款不受影響。」另補一句「以每次補款前的可用餘額判斷；等於門檻仍可補款」。
- 若已有廣告自動補款原因顯示，新增 `wallet_below_auto_refill_threshold` →「錢包可用餘額低於自動補款門檻」。

分開管理伺服器已儲存值與表單草稿。輸入時不寫入；僅按儲存提交一次 PATCH。儲存中停用重複提交。成功採用回傳的 wallet 更新共享狀態／query cache；不要用輸入草稿當成伺服器成功值。失敗保留草稿、顯示錯誤，不覆蓋已儲存值。管理員切換賣家時清除舊草稿，並取消或忽略屬於舊賣家的延遲回應。

金額計算使用專案既有精確工具或字串／整數分（大額用 BigInt）；不要直接用 Number 相減產生可用金額誤差，也不要在 JSON 序列化 BigInt。可接受 UI 輸入的 10000 或 10000.5，送出時正規化為 "10000.00"／"10000.50"。拒絕負數、空字串及超過兩位小數，不默默截斷。API 缺少新欄位時，視為版本不相容／尚未部署，給出可理解的提示，不要假裝讀到了已儲存的 0。

## 驗證與交付

用 mock API 做必要測試，不真實呼叫 PATCH 或補款 API：

1. 正確載入門檻；賣家及管理員各使用正確路徑。
2. 只有儲存才發 PATCH，body 僅含 autoRefillStopThreshold；防止連點、取消不送出。
3. 0、正數、小數、高於當前餘額皆可；負數、空白、超精度被拒絕。
4. PATCH 成功更新 wallet；錯誤保留草稿及既有設定。
5. 管理員切換目標時，舊回應不汙染新目標；員工無修改權限。
6. lockedBalance 扣除後的可用金額顯示精確；等於門檻與扣款前判斷說明正確。
7. 低於門檻不改單則開關／廣告狀態，也不禁用手動及批次補款。
8. 缺少新欄位或未知 lastReason 有可理解的顯示。

執行專案適用的 build、typecheck 及相關測試；若有既有失敗，分清楚原本問題與本次新增問題。最後回報修改檔案、UI 所在位置、測試結果及未解限制。不要自動提交或部署，除非使用者另有授權。
