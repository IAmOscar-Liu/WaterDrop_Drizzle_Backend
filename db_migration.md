# 資料庫修改記錄 (Database Migration Log)

### 1. 新增廣告顯示控制欄位 (Add Advertisement Display Control Fields)

- **原因**: 需要控制廣告與商品在不同分頁的顯示邏輯，並支援防呆機制。
- **動作**: 在 `advertisements` 表中新增 `show_in_ad_feed` 與 `show_in_marketplace` 欄位。

### 2. 更新帳號角色枚舉 (Update Account Role Enum)

- **原因**: 為了區分「賣家主帳號」與「員工子帳號」。
- **動作**: 在 `accountRoleEnum` 中新增 `employee` (員工) 選項。

### 3. 新增最後登入時間欄位 (Add Last Login Time Field)

- **原因**: 為了記錄並顯示使用者的最後登入時間（若無紀錄會顯示「從未登入」）。
- **動作**: 在 `accounts` 表中新增 `last_login_at` 欄位 (Timestamp, Nullable)。

### 4. 新增錢包相關欄位 (Add Wallet Fields)

- **原因**: 為了支援賣家資金的獨立管理（Unallocated Funds），不再完全依賴廣告統計加總。
- **動作**: 在 `accounts` 表中新增以下欄位：
  - `wallet_balance`: 錢包餘額 (Double, Default 0)
  - `total_revenue_cash`: 總現金收入 (Double, Default 0)
  - `total_revenue_coin`: 總金幣收入 (Double, Default 0)
  - `locked_balance`: 凍結金額 (待提現) (Double, Default 0)

### 5. 新增母子帳號關聯 (Add Parent Account Relation)

- **原因**: 支援子帳號（員工）歸屬於特定主帳號（老闆），以便繼承權限與數據檢視。
- **動作**: 在 `accounts` 表中新增 `parent_id` 欄位 (UUID, Self-Reference Nullable)。
