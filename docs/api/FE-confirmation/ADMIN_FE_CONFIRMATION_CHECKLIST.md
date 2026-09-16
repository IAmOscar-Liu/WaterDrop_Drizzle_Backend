# 地平線 FE API 確認與完成狀態

日期：2026-09-09｜範圍：目前 dev 後台仍依賴舊端的主要功能。

以下是目前地平線尚未改接你這邊的 API。缺少的麻煩補齊或提供替代接口；已有接口的，請確認是否支援下列功能。提供接口與欄位範例後，我再配合修改前端。

以下路徑統一省略 `/api/admin` 前綴；「缺接口」指目前比對版本沒有同等接口，若已有其他路徑可直接提供。

## 1. 尚缺接口或需要替代接口

| 功能               | 目前接口                                                                                                                       | 需要支援                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 新增／刪除子帳號   | `POST /account/sub-account`；`DELETE /account/:id`                                                                         | 子帳號建立、刪除及賣家歸屬；若改用 parent／employee 流程，請提供替代方式    |
| 修改／刪除商品分類 | `PUT /product/categories/:id`；`DELETE /product/categories/:id`                                                            | 分類更名、刪除；刪除時自動從關聯商品移除該分類，商品本身保留                    |
| 刪除商品           | `DELETE /product/:id`；`DELETE /product/:id/permanent`                                                                     | 軟刪除／永久刪除及關聯資料限制                                              |
| 調整單支廣告預算   | `PUT /advertisement/budget/:id`                                                                                              | `{ operation, amount }`，增加／減少／設定預算，同步處理賣家錢包撥入或退回 |
| 廣告收入與錢包查詢 | `GET /ad-revenue/account`；`GET /ad-revenue/transactions`；`GET /ad-revenue/summary`                                     | 帳戶餘額、收入摘要、交易紀錄與分頁；管理員指定賣家查詢                      |
| 錢包加值／預算調整 | `POST /ad-revenue/charge`；`PUT /ad-revenue/budget`                                                                        | 提供正式加值與調整方式；以後端確認入帳為準，不直接照搬舊端增加餘額的做法    |
| 後台儀表板         | `GET /dashboard/kpi`；`GET /dashboard/time-series`；`GET /dashboard/pending-tasks`；`GET /dashboard/recent-activities` | 指標、趨勢、待辦與最近活動                                                  |
| 廣告報表           | `GET /advertisement/metrics`；`GET /advertisement/product/:productId/dashboard`                                            | 廣告列表指標及單一商品廣告統計                                              |
| 側欄提示數量       | `GET /sidebar-notifications/summary`                                                                                         | 訂單、運單、廣告提示數量；支援賣家範圍與已看時間                            |

### 後端完成結果（2026-09-16）

本節已完成，並已由 `npm test` 的一次性 PostgreSQL 測試資料庫驗證。請以
Swagger `/api-docs` 與
[Section 1 後台 FE API 更新](ADMIN_SECTION_1_UPDATE_2026-09-16.md) 為準。

廣告預算的 `decrease` 與低於目前餘額的 `set` 依已確認的不可提回政策回傳
`409 operation_not_supported`；加值仍使用賣家錢包原子扣款。舊的
`/ad-revenue/*` 路徑不另建相容別名，請改接 `account-wallet` 與
`advertisement` 路徑。

## 2. 已有接口，但需確認差異才能切換

| 功能             | 目前接口                                                                           | 尚未切換原因／請確認                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 登入／刷新／登出 | `POST /account/login`；`POST /account/refresh-token`；`POST /account/logout` | 舊端固定 24 小時到期，你這邊目前是 30 天且刷新會延長；請確認採哪一套期限與 cookie 設定               |
| 註冊             | `POST /account/register`                                                         | 你這邊要求`realName`，目前前端未送；請確認正式必填欄位，我再配合調整                               |
| 修改密碼         | `PUT /account/change-password`                                                   | 路由已有，本次隨登入流程整組保留，待上述確認後一起切換                                               |
| 編輯帳號／頭像   | `PUT /account/update`                                                            | 舊端支援`avatarUrl`／`avatar_url`，你這邊更新欄位尚未接收頭像；需確認更新與清除方式              |
| 子帳號列表       | `GET /account/list`                                                              | 需支援管理員的`sellerId/accountGroupId` 篩選；一般帳號列表已改接，只有子帳號篩選用途仍保留         |
| 廣告加值         | `PUT /advertisement/deposit/:id`                                                 | 舊端會扣賣家錢包再增加廣告餘額；你這邊目前沒有相同錢包扣款步驟，需確認帳務處理                       |
| 廣告啟用／停用   | `PUT /advertisement/status/:id`                                                  | 需確認商品下架不得啟用廣告、餘額門檻、狀態值及操作權限                                               |
| 批次觀看統計     | `GET /advertisement/list/view-count`                                             | 你這邊目前以登入者 ID 篩選賣家，與管理員全站查詢不同；單支廣告觀看統計已改接                         |
| 儲存運費設定     | `POST /delivery/helper/fee`                                                      | 冷藏運費上限目前比較到一般宅配上限，需確認；GET 查詢已改接                                           |
| 系統推播         | `POST /system/send-notification`                                                 | 前端目前送空 tokens，舊端實際未發送；你這邊要求明確 tokens。請提供全體／指定對象的發送方式及權限規則 |

### 後端確認結果（2026-09-16）

本節 10 項後端工作均已完成，並由 `npm test` 的一次性測試資料庫驗證。
請以 `/api-docs` 及以下交接文件為準：

- [Section 2 後台 FE API 更新](ADMIN_SECTION_2_UPDATE_2026-09-16.md)
- [2026-09-16 帳戶錢包與廣告加值](ADMIN_ACCOUNT_WALLET_UPDATE_2026-09-16.md)

確認範圍包含：後台 access token/refresh cookie、註冊必填欄位、修改密碼、
頭像更新／清除、管理員子帳號篩選、錢包扣款後廣告加值、廣告狀態與操作權限、
單支／批次觀看統計權限、冷藏運費上限，以及管理員對 APP 使用者／群組推播。

## 3. 提領：另外標示為尚未完成，不是已可用的舊功能

| 功能           | 目前前端預留接口                                                 | 需要提供                                                                                             |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 提領申請／紀錄 | `POST /ad-revenue/withdrawal`；`GET /ad-revenue/withdrawals` | 兩邊目前比對版本都未提供這組路由。請提供正式申請／查詢接口、狀態與金額欄位；若已有其他接口可直接告知 |

### 後端確認結果（2026-09-16）

本節維持 **pending**，目前沒有可供 FE 串接的提領 API。請勿顯示可操作的
提領 UI，也不要呼叫上述預留路徑。賣家收入結算時間、逾期退款、手續費與運費
分攤、銀行帳戶驗證、歷史餘額及實際撥款方式確認後，後端才會實作正式接口。

本次可交付文件總覽請從 [FE confirmation package](README.md) 開始閱讀。

## 請回覆

每項提供「可用接口或替代接口、request／response 範例或 Swagger、可測試日期」即可；規則不同的部分先確認，我再接前端。

已改接的接口、未使用的舊封裝，以及 APP／退款新需求不列入本次清單。背景排程接手另外確認，目前不因這份清單停用舊後端。
