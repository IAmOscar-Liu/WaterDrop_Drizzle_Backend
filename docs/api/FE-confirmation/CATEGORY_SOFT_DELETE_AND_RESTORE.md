# 分類軟刪除與同名恢復

本分支實作日期：2026-11-24；尚未部署。分類欄位仍為 `name`，不是 `title`。所有操作沿用原本權限與 bearer token。

## 清單

- App：`GET /api/product/categories/list`。
- Admin：`GET /api/admin/product/categories/list`。
- 都只回傳未刪除分類，依名稱排序，成功仍為 `{success:true,data:Category[]}`，未新增分頁或包含已刪除分類的選項。
- Category 新增 `deletedAt: string | null`；清單中的值皆為 null。

## 建立／恢復

管理員呼叫 `POST /api/admin/product/categories/create`，body：

```json
{"name":"電子產品"}
```

- 名稱去除前後空白；既有唯一規則為不分大小寫，且涵蓋已刪除分類。空白名稱仍回 400。
- 新名稱：新增分類，`deletedAt=null`。
- 已存在且未刪除：成功回傳原分類，不新增重複資料，也不回名稱重複錯誤。
- 已存在但已刪除：清除 deletedAt，恢復原 ID、原名稱拼寫、原建立時間及原商品關聯。不建立新 ID，也不將輸入的不同大小寫當成改名。
- 成功一律 200，回應 `{success:true,data:Category}`，不額外區分 created/restored。並行重複請求也只會產生一個分類 ID。
- 更新本地清單時請依回傳 ID upsert，或重新抓取清單；不要假設每次建立必定回傳新 ID。

## 刪除

管理員 `DELETE /api/admin/product/categories/{id}` 改為軟刪除。成功範例：

```json
{
  "success": true,
  "data": {
    "id": "CATEGORY_UUID",
    "deleted": true,
    "deletedAt": "2026-11-24T12:00:00.000Z",
    "detachedProductCount": 0
  }
}
```

- 分類從可選清單消失，但分類資料、商品及商品分類關聯均保留；不要顯示「已從 N 個商品移除分類」。
- `detachedProductCount` 為相容舊版本保留，固定為 0，不代表原本沒有關聯商品。
- 重複刪除同一 ID 仍成功，回原刪除時間；不存在 ID 回 404。賣家／員工仍不得建立、改名或刪除分類。
- 同名建立會恢復其歷史關聯，所以原本的商品會再次關聯到可用分類。

## 改名與歷史資料

`PUT /api/admin/product/categories/{id}` 只允許改名未刪除分類；已刪除分類回 404，應先用原名稱建立恢復。改名撞到其他分類的名稱（包含刪除列，不分大小寫）回 409。

商品詳情等既有關聯資料仍可能帶出已刪除的分類，並有 deletedAt 可辨識。非刪除清單是供選項使用，不應據此推論未回傳的歷史分類已永久消失。此變更不提供交易當時分類快照；也未改變商品編輯送 categoryIds 會明確替換關聯的舊合約。

## 部署與測試

先套用 Drizzle migration 新增 `categories.deleted_at`，再部署讀取此欄位的 BE。既有分類預設 null，因此維持可見。

- Local：`0125_deep_captain_universe`（已套用）。
- Development：`0075_glamorous_ironclad`（已產生，尚未套用）。
- Staging：`0023_fuzzy_doctor_faustus`（已產生，尚未套用）。

API 測試覆蓋並行新增／恢復、不分大小寫唯一、名稱修剪、兩種清單排除刪除列、關聯保留、重複刪除、改名限制及原管理員權限。
