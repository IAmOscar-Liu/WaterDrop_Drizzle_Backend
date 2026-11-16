# 刪除操作與歷史資料保護盤點

日期：2026-11-16

## 狀態與範圍

此分支 `fix/deletion-history-safety` 從 `development` 的 `32f1b43` 建立，供後續處理刪除與歷史資料保護問題。本次只有文件，尚未實作下列建議。

盤點對象為 development 程式碼中的路由及資料存取行為，未驗證 dev 服務實際部署版本，也未對 dev 資料庫執行刪除或重設。收益規劃仍留在 `feat/revenue-stat`，不包含於此分支。

使用者期望：刪除不應破壞訂單、統計及歷史資料，預期只允許刪除購物車與收藏。先前已確認保留管理員專用的商品軟刪除；技術資料清理與其他軟刪除是否列為例外，需在實作前確認。

## 已完成的商品保護

- 商品永久刪除路由 `DELETE /api/admin/product/:id/permanent` 已移除，舊路徑回傳 404。
- `DELETE /api/admin/product/:id` 僅平台管理員可操作，保留商品與規格資料；將商品及規格下架、暫停未封存廣告，並清除購物車與收藏關聯。
- 尚無恢復軟刪除 API，已刪除商品也不能透過一般更新 API 恢復。
- FE 契約見 [商品刪除 API 修正通知](../api/FE-confirmation/ADMIN_PRODUCT_DELETION_API_CHANGES.md)。

## 發現與建議

| 優先度 | 入口 | 現行行為與風險 | 建議方向（尚未實作） |
| --- | --- | --- | --- |
| 高 | `POST /api/auth/reset/daily-stats` | 僅要求登入，一般 App 使用者可重設自己的每日觀看計數、已看廣告清單與觀看額度，並停用現有寶箱。即使不是 DELETE，也會改寫觀看狀態。 | 移除對外重設入口，保留正常排程所需內部功能；檢查 App 是否仍依賴此路由。 |
| 高 | `DELETE /api/admin/product/categories/:id` | 平台管理員可永久刪除分類及所有商品分類關聯。商品、訂單仍在，但原分類關係消失，可能影響依分類回溯與分析。 | 禁止永久刪除，評估改為停用；歷史分類分析若要求維持交易當時分類，另需確認是否需要快照，不能只靠停用解決。 |
| 中 | `DELETE /api/notification` | 保留通知資料列並設定 deletedAt，但同時清空 title、body、metadata 及 orderId；不刪除訂單本身，卻失去通知內容及訂單關聯。 | 若需保留通知歷史，改為只隱藏、不清空內容；同步確認資料保留政策。 |
| 待確認例外 | `DELETE /api/admin/account/:id` | 所屬賣家或平台管理員可軟刪除員工子帳號，保留帳號及歷史資料；不能用此入口刪除賣家或管理員。 | 確認是否保留此停用功能，或統一調整為明確的停用操作。 |
| 已確認保留 | `DELETE /api/admin/product/:id` | 管理員專用軟刪除，保留商品業務資料。 | 維持現行保護並納入回歸驗證。 |
| 待確認例外 | `DELETE /api/auth/device-token` | 實際刪除使用者推播裝置 token，不影響訂單及統計歷史。 | 建議保留登出／解除裝置所需清理，避免無效或不應接收推播的裝置繼續收到通知。 |

目前未發現可直接永久刪除訂單、退款、廣告、錢包交易或廣告觀看歷史的公開 API。此結論是本次原始碼盤點結果，不代表所有更新 API 都不可能改變歷史報表，也不代表已完成正式安全稽核。

每日重設可能影響觀看資格與額度，但是否能突破金幣帳本的其他限制，需要另行測試；本次沒有驗證重複領獎漏洞。

## 程式碼追查位置

- 分類刪除：`src/routers/admin/admin-product.ts` → `deleteCategory`，位於 `src/repository/product.ts`。
- 每日重設：`src/routers/auth.ts` → `resetDailyStats`，位於 `src/repository/treasureBox.ts`。
- 通知刪除：`src/routers/notification.ts` → `src/repository/notification.ts` → `mutateNotifications`，位於 `src/repository/notificationSync.ts`。另有 `src/routers/notificationSync.ts` 定義同步版本路由，實作時需確認實際掛載及共用流程。
- 員工軟刪除：`src/routers/admin/admin-account.ts` → `softDeleteSubAccount`，位於 `src/repository/account.ts`。
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
2. 確認通知應保留原文的期限，以及員工停用是否沿用現有 API。
3. 決定分類停用對列表、商品編輯及統計的行為；檢查既有分類報表是否依賴目前關聯。
4. 盤點 FE／Flutter 對每日重設與通知刪除的依賴，避免直接移除後造成流程中斷。

## 預期驗收

- 一般使用者無法自行重設每日觀看狀態；排程正常重設仍可運作。
- 分類不再可永久刪除；保留既有關聯，停用後的新建／編輯行為符合確認後規則。
- 若採用通知隱藏方案，刪除操作不再清空原始內容及訂單關聯，但一般列表與未讀數仍正確排除隱藏通知。
- 訂單、退款、廣告、交易及觀看歷史不被這些操作永久移除。
- 購物車、收藏與必要裝置解除流程維持正常。
- API 變更同步更新 Swagger、FE 文件及必要測試，執行 Build 與相關整合測試。

本文件只是待辦盤點，不表示上述建議已獲確認或已部署。
