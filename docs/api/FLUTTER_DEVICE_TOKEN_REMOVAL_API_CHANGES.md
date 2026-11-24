# Flutter 裝置推播解除綁定修正

日期：2026-11-24。分支：`fix/deletion-history-safety`。尚未部署；不需資料庫 migration。

## 目的

保留 `DELETE /api/auth/device-token`，供登出／解除推播裝置使用。舊查詢已有 userId 所有權條件，但省略 deviceId 會刪除該使用者的所有裝置。本次移除這個廣泛刪除 fallback，要求明確指定目標裝置，且只能操作目前登入使用者持有的綁定。

## Request

沿用 App 使用者 bearer token。以下三種 body 擇一：

```json
{"deviceId":"CURRENT_INSTALLATION_ID"}
```

```json
{"fcmToken":"CURRENT_FCM_TOKEN"}
```

```json
{"deviceId":"CURRENT_INSTALLATION_ID","fcmToken":"CURRENT_FCM_TOKEN"}
```

- 至少提供 deviceId 或 fcmToken；不可空字串、只有空白、null、數字、陣列或物件。若兩者都傳，必須同時符合，不是擇一符合。
- 不接受 userId、all 等額外欄位；使用者 ID 僅從登入憑證取得。
- 識別值是 opaque 字串，不自動修剪或轉型；傳入註冊時的原始值。允許 fcmToken-only 以支援未保存 deviceId 的舊註冊。
- 空 body／缺少目標現在回 400，不再刪除所有裝置。未登入回 401。

## Response 與安全語意

成功格式維持 `{success:true,data:DeviceToken[]}`，data 為實際刪除的本人裝置綁定。不存在、已解除、已換綁別的帳號或不屬於本人時，一律成功回 `[]`，不洩露他人裝置資料；可安全重試。

單次操作不影響其他裝置，不刪除通知、訂單、交易或觀看歷史。沒有透過此入口解除所有裝置的操作。

若傳 deviceId 與舊 fcmToken，而該裝置的 token 已更新，兩者不再同時相符，因此不會移除新 token。若只傳 deviceId，則明確移除該登入使用者在該 installation 的目前綁定。

## Flutter 登出／換帳號順序

1. 使用舊使用者尚有效的憑證解除目前裝置綁定，帶上當前 deviceId；若也傳 token，確保是目前有效值。
2. 清除本機舊帳號的 badge/cache/timers 與登入憑證；不要在清除舊憑證後才嘗試需要認證的解除呼叫。
3. 換帳號時，依原註冊 API 將目前裝置／token 綁到新使用者。
4. 延遲到達的舊使用者解除請求不會刪除已轉給新使用者的綁定，因為 BE 在同一 DELETE 查詢檢查所有權與所有選擇條件。

POST 註冊 API、token 換綁流程、失效 token 排程清理的行為未改動。FCM 已排入佇列的推播仍無法撤回，App 原有 badgeUserId／帳號切換防護應保留。

## 驗證

API 回歸覆蓋：缺省／不合法 body 不寫入、未登入、他人 deviceId／fcmToken 皆無法刪除、兩條件必須同時相符、只解除一個裝置、無 deviceId 的 token、重試、token 更新與跨帳號換綁後的舊請求。測試使用 disposable DB 與假 token，不對真實裝置送推播。
