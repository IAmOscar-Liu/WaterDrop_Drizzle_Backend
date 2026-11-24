# 刪除操作與歷史資料保護盤點

日期：2026-11-16

## 狀態與範圍

此分支 `fix/deletion-history-safety` 原從 `development` 的 `32f1b43` 建立，後已合併 development 至 `7e58d37`。本文件保留原始盤點；每日重設入口已移除，分類已改為軟刪除與同名恢復，通知刪除已改為隱藏並保留內容。裝置解除已限制指定本人裝置；帳號軟刪除已依確認權限擴及管理員刪除賣家／員工、賣家刪除本人員工。

盤點對象為原始碼中的路由及資料存取行為，未驗證 dev 服務實際部署版本，也未對 dev 資料庫執行刪除或重設。同步 development 後，本分支已包含收益與廣告自動補款功能。

## 已實作：移除公開每日重設 API

- 移除 `POST /api/auth/reset/daily-stats` 路由及僅供此入口使用的 controller/service 方法。部署後，不論是否登入或 body 是否含 `userId`，舊路徑均回 404 `RESOURCE_NOT_FOUND`。
- 舊 controller 會優先使用 body 的 `userId`，因此除了重設自己外，也存在指定其他使用者狀態的風險；此次直接移除整個公開入口，不保留替代公開重設 API。
- 保留 `GET /api/auth/daily-stats`。App 如有呼叫舊 POST，應移除該呼叫，使用 GET 重新讀取狀態；不得以其他 API 重建自行重設功能。
- 保留 `src/repository/treasureBox.ts` 的內部 `resetDailyStats`、每日排程及維護腳本；正常每日額度更新不受影響。
- API 回歸驗證涵蓋匿名、本人登入及 body 指定其他使用者三種舊路徑呼叫，確認兩位使用者的每日額度、觀看紀錄與寶箱狀態皆不變。
- 此變更不需要資料庫 migration，也未重設任何既有使用者資料。尚未部署。

使用者期望：刪除不應破壞訂單、統計及歷史資料，預期只允許刪除購物車與收藏。先前已確認保留管理員專用的商品軟刪除；後續已確認分類／通知軟刪除及指定本人裝置的技術清理；帳號軟刪除亦已確認保留並依角色及所屬賣家限制。

## 已實作：分類軟刪除與同名恢復

- 分類沿用既有不分大小寫的名稱唯一索引，包含軟刪除列；建立／改名輸入會去除前後空白。
- 新增 `categories.deleted_at`。App／admin 的 `/product/categories/list` 共用非刪除清單，只列出 `deletedAt=null` 的分類。
- 管理員建立分類時，若名稱不存在則新增；若已存在，回傳同一 ID，並在需要時清除 `deletedAt`。不改原名稱拼寫與建立時間，不新增重複列；並行建立／恢復亦適用。
- 管理員 DELETE 只設定 `deletedAt`，保留分類、商品及所有商品分類關聯，不更新商品時間。重複刪除保留原時間，不重複寫活動紀錄。`detachedProductCount` 為相容舊 FE 保留，固定為 0。
- PUT 只允許改名未刪除分類；刪除分類須先用同名建立恢復。改名仍不得使用任何已存在（含刪除）的分類名稱。
- 商品既有分類關聯及歷史讀取保留；這不是新增交易當時分類快照，也不修改一般商品編輯 API 明確替換分類的既有行為。
- 已產生 local/dev/stg migration；目前只套用 local，dev/stg 須於部署本分支前執行對應 migration。未在共享資料庫刪除或恢復任何分類。
- 詳細 FE 合約見 [分類軟刪除與恢復](../api/FE-confirmation/CATEGORY_SOFT_DELETE_AND_RESTORE.md)。

## 已實作：通知只隱藏，保留歷史內容

- `DELETE /api/notification` 及 `/api/notification/sync` 共用流程改為只設定 `deletedAt`，保留原始 `title`、`body`、`metadata`、`orderId`、使用者、讀取狀態及建立時間。同步所需 version 與 updatedAt 照常更新。
- 刪除後一般／同步清單與未讀數排除該訊息，detail 回 404，mark-as-read 不回傳已刪除內容。SSE 只送 ID／版本／統計的刪除事件；歷史內容在重播時仍不得洩露。
- 1–200 唯一 ID、所有權、混合批次原子回滾與既有回應格式保留。Legacy 重複刪除仍回 404，sync 重複刪除仍成功且不增加版本／事件。
- 沒有新增復原或歷史查詢入口，不需資料庫 migration。過去已被清空的內容不會自動恢復。尚未部署。
- 更新通知 SSE 測試驗證兩種 DELETE 保留原文／metadata／訂單關聯，同時持續隱藏及阻擋歷史重播。

## 已實作：限定解除本人指定裝置

- 保留 `DELETE /api/auth/device-token`，不影響訂單、通知與財務歷史。userId 僅使用登入憑證，不接受 body 偽造目標使用者。
- 原有 deviceId 查詢已限制本人，但未傳 deviceId 時會刪除本人的所有裝置。已移除該 fallback，改為必須提供非空 deviceId 或 fcmToken，兩者都提供則同時比對；不合規 body 回 400。
- DELETE 在單一 SQL 中同時檢查所有權與目標，保留本人其他裝置及他人的全部裝置。無匹配／重試一律成功回空陣列，避免洩露他人綁定資訊。
- 帳號換綁後延遲抵達的舊使用者解除請求不能移除新使用者綁定。兩條件模式也不會用舊 token 誤刪更新後的註冊。
- 不需 migration，未改註冊及排程清理。App 必須在清除舊憑證前帶指定裝置資料完成登出解除；詳見 [Flutter 裝置解除](../api/FLUTTER_DEVICE_TOKEN_REMOVAL_API_CHANGES.md)。尚未部署。

## 已實作：賣家與員工帳號軟刪除

- 管理員可軟刪除賣家與員工（含未分配員工）；賣家只可刪除本人員工，不能刪除自己／其他賣家。員工不得刪除帳號；管理員目標受保護。
- 設定目標 inactive、deletedAt、deletedByAccountId，保留帳號 email、錢包及業務歷史。刪除重試保留原操作人／時間，不重複活動紀錄。
- 撤銷目標 session；刪除賣家也撤銷其員工 session。員工資料與群組仍保留，但母賣家已刪除／停用時，登入、建立／更新 session 及一般登入 API 都會拒絕。
- 不自動刪除員工／商品，不改商品／廣告狀態，也不自動處理餘額；這些是另外的業務操作／政策。
- 不需新增 schema migration，未對共享 DB 刪除任何帳號；尚未部署。詳見 [帳號軟刪除權限更新](../api/FE-confirmation/ACCOUNT_SOFT_DELETE_API_CHANGES.md)。

## 已完成的商品保護

- 商品永久刪除路由 `DELETE /api/admin/product/:id/permanent` 已移除，舊路徑回傳 404。
- `DELETE /api/admin/product/:id` 僅平台管理員可操作，保留商品與規格資料；將商品及規格下架、暫停未封存廣告，並清除購物車與收藏關聯。
- 尚無恢復軟刪除 API，已刪除商品也不能透過一般更新 API 恢復。
- FE 契約見 [商品刪除 API 修正通知](../api/FE-confirmation/ADMIN_PRODUCT_DELETION_API_CHANGES.md)。

## 發現與建議

| 優先度 | 入口 | 現行行為與風險 | 建議方向（尚未實作） |
| --- | --- | --- | --- |
| 已實作 | 原 `POST /api/auth/reset/daily-stats` | 舊入口允許登入使用者重設自己或 body 指定使用者的每日狀態及寶箱。 | 已移除公開路由及 controller/service，保留排程內部功能；App 需移除舊呼叫。 |
| 已實作 | `DELETE /api/admin/product/categories/:id` | 舊版本永久刪除分類及商品分類關聯。 | 已改軟刪除並保留關聯；分類名稱唯一，同名建立恢復同一 ID。 |
| 已實作 | `DELETE /api/notification` 及 `/api/notification/sync` | 舊版本清空通知內容及訂單關聯。 | 已改為只隱藏並保留原始內容；一般 API／SSE 仍不洩露已刪除訊息。 |
| 已實作／已確認保留 | `DELETE /api/admin/account/:id` | 舊版只允許刪除員工。 | 已擴為管理員可刪除賣家／員工；賣家只可刪除本人員工。保留歷史並撤銷受影響帳號的存取權。 |
| 已確認保留 | `DELETE /api/admin/product/:id` | 管理員專用軟刪除，保留商品業務資料。 | 維持現行保護並納入回歸驗證。 |
| 已確認保留／已加固 | `DELETE /api/auth/device-token` | 原入口缺省裝置 ID 可刪除本人所有裝置。 | 已限制必須指定本人 deviceId／fcmToken；保留其他裝置與所有業務歷史。 |

目前未發現可直接永久刪除訂單、退款、廣告、錢包交易或廣告觀看歷史的公開 API。此結論是本次原始碼盤點結果，不代表所有更新 API 都不可能改變歷史報表，也不代表已完成正式安全稽核。

每日重設可能影響觀看資格與額度，但是否能突破金幣帳本的其他限制，需要另行測試；本次沒有驗證重複領獎漏洞。

## 程式碼追查位置

- 分類刪除：`src/routers/admin/admin-product.ts` → `deleteCategory`，位於 `src/repository/product.ts`。
- 每日重設：公開路由已移除；內部 `resetDailyStats` 位於 `src/repository/treasureBox.ts`，由排程／維護腳本使用。
- 通知刪除：`src/routers/notification.ts` → `src/repository/notification.ts` → `mutateNotifications`，位於 `src/repository/notificationSync.ts`。另有 `src/routers/notificationSync.ts` 定義同步版本路由，實作時需確認實際掛載及共用流程。
- 員工軟刪除：`src/routers/admin/admin-account.ts` → `softDeleteAccount`，位於 `src/repository/account.ts`。
- 裝置清理：`src/routers/auth.ts` → `src/repository/user.ts`。
- 掛載入口：`src/app.ts`；不能只搜尋 HTTP DELETE，還需追查 POST、PUT 等修改流程。

## 其他邊界

- 購物車及收藏的移除符合使用者需求，商品下架、軟刪除或結帳時的相應清理也需保留。
- 商品更新會重建商品分類關聯；即使禁止分類刪除，分類調整仍可能改變使用現行關聯產生的歷史分析。
- 排程／內部清理另包含過期憑證、同步事件與快照、冪等資料、廣告分派及作業紀錄。它們並非公開刪除 API，不應直接套用全面禁止刪除；後續應分別檢查保留期限與追查需求。
- 廣告分派清理會先清空觀看紀錄的 assignmentId，再移除過期分派，保留觀看紀錄本身；仍有追溯資訊減少的取捨。
- Seed／維護腳本可能有實體刪除操作，不屬於此次 API 結論；不得在 dev 或其他共享環境任意執行。

## 後續實作前確認

1. 明確區分不可永久刪除的業務資料、可移除的購物車／收藏，以及必要的技術資料清理例外。
2. 通知原文保留及既有帳號 DELETE 權限已確認；如需另外限制保留期限，另案處理。
3. 決定分類停用對列表、商品編輯及統計的行為；檢查既有分類報表是否依賴目前關聯。
4. 盤點 FE／Flutter 對每日重設與通知刪除的依賴，避免直接移除後造成流程中斷。

## 預期驗收

- 一般使用者無法自行重設每日觀看狀態；排程正常重設仍可運作。
- 分類不再可永久刪除；保留既有關聯，停用後的新建／編輯行為符合確認後規則。
- 通知隱藏方案已實作，刪除操作不再清空原始內容及訂單關聯，但一般列表與未讀數仍正確排除隱藏通知。
- 訂單、退款、廣告、交易及觀看歷史不被這些操作永久移除。
- 購物車、收藏與必要裝置解除流程維持正常。
- API 變更同步更新 Swagger、FE 文件及必要測試，執行 Build 與相關整合測試。

除明確標示已實作的項目外，其餘仍是待辦盤點，不表示已獲確認或已部署。
