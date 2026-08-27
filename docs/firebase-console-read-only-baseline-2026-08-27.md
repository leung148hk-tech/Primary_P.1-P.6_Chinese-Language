# Firebase Console 只讀基線紀錄

**檢查日期：** 2026-08-27（GMT+8）

**Firebase 專案：** `chinese-training-platform`

**檢查帳戶：** 已驗證可存取此專案的 Google 帳戶（帳戶識別資料不在此報告重複記錄）。

**操作範圍：** 僅檢視；沒有新增、修改或刪除 Firebase Authentication 使用者、登入供應商、Firestore 資料或安全規則。

## 已確認項目

| 項目 | 只讀檢查結果 | 遷移含義 |
|---|---|---|
| Firebase 專案存取 | 成功載入專案的 Authentication 設定頁。 | 已具備進行安全盤點的主控台存取權。 |
| 用量方案 | 左側主控台顯示 Spark（No-cost / $0 per month）。 | 遷移須維持節流寫入、最小資料及用量監察設計。 |
| 登入供應商 | **Anonymous** 目前為 Enabled。未見 Email/Password 已啟用。 | 目前網站可透過匿名帳戶直接存取後端；上線前需要轉向正式 Firebase Authentication 並限制資料規則。 |
| Authentication 使用者清單 | 清單顯示共 **68** 個使用者（第 1–50 列，共 68），已見的帳戶均為 `(anonymous)`。 | 這些匿名 UID 不能作為學生身分帳戶；不可在未盤點相連 Firestore 資料前刪除。 |
| 可見建立／登入日期 | 可見匿名帳戶主要介乎 2026-06-08 至 2026-08-27。 | 顯示舊版已長期透過匿名認證產生工作階段，需規劃保留或清理策略。 |

## 尚待只讀確認

1. Firestore 現行 Security Rules 的完整內容、發布時間及規則是否允許匿名使用者讀寫全部學生資料。
2. Firestore 既有資料庫中的集合、文件數量、學生資料實際欄位及是否含明文密碼。
3. Authentication 的 Authorized domains、Email/Password 是否可安全啟用，以及目前是否存在非匿名帳戶。
4. Firestore 使用量／配額趨勢，及目前是否使用了其他可能受規則變更影響的路徑。
5. 現有 Firebase Hosting 或其他前端部署位置（如有），以安排測試與發布順序。

## 安全變更前控制措施

在完成資料備份、程式碼遷移分支、規則測試和用戶遷移安排之前，不應停用 Anonymous、啟用強制規則或刪除任何 Authentication／Firestore 資料。這些動作可能即時影響現有學生登入和學習進度。

## Firestore 資料結構（只讀觀察）

| 路徑／項目 | 觀察結果 | 遷移注意事項 |
|---|---|---|
| Firestore 資料庫 | `(default)`；資料庫位置 `nam5`。 | 需使用同一資料庫撰寫及測試新規則。 |
| 舊版應用程式根資料 | 已確認存在階層 `artifacts / chinese-training-platform / public / data`。 | 與舊版原始碼的 `artifacts/{appId}/public/data/...` 路徑一致。 |
| `public` 文件 | 顯示為不存在的父文件，但含有 `data` 子集合／文件階層。 | Firestore 允許無欄位父文件有子集合；遷移時不可據此判斷為可刪除。 |
| 下一層資料 | 已看見 `data` 入口，尚未展開到 `students` 子集合。 | 下一步只讀盤點學生文件數量和欄位，避免接觸或外洩個人資料。 |

> 注意：本段的資料結構檢視不涉及新增、修改、刪除或匯出學生資料。

## 舊版學生集合（只讀盤點）

已確認學生資料集合位於：

```text
artifacts/chinese-training-platform/public/data/students
```

| 項目 | 只讀觀察結果 | 風險／遷移含義 |
|---|---|---|
| 集合存在 | `students` 子集合可正常載入。 | 現有帳戶資料與 Firebase Authentication 目前並非同一身分系統。 |
| 可見文件 ID | `1`、`12`、`p0alpha20260820`、`p0gamma20260820`、`test`。 | 文件 ID 是可猜測的自訂使用者名稱，不可繼續作為授權依據或 Firebase Auth UID。 |
| 個人資料處理 | 本次只檢視文件清單；沒有打開任何個別學生文件、沒有複製姓名、密碼或學習紀錄。 | 後續只應以最小必要方式盤點欄位及規劃一次性遷移，不應在報告或版本控制中保存學生資料。 |

> 以上證實舊資料模型與原始碼審核結果一致：舊資料使用可預測使用者名稱作文件 ID，因此必須遷移至以 Firebase Auth UID 為主鍵的新資料路徑。

## Firestore Security Rules（現行已發布規則的只讀副本）

主控台 Rules 分頁顯示的目前規則版本時間為 **2026-06-08 13:19**。規則內容如下：

```text
rules_version = '2';
service cloud.firestore {
 match /databases/{database}/documents {
 // 允許任何人在正確的 APP 路徑下註冊與讀寫學生成績資料（不限30天，永久有效）
 match /artifacts/{appId}/public/data/students/{studentId} {
 allow read, write: if true;
 }
 // 保護其他系統設定
 match /{document=**} {
 allow read, write: if false;
 }
 }
}
```

| 安全判定 | 結論 |
|---|---|
| 學生資料讀取 | 任何網際網路使用者均可讀取指定路徑下的任何學生文件，**不需登入**。 |
| 學生資料寫入／覆蓋／刪除 | 任何網際網路使用者均可建立、覆蓋或刪除指定路徑下的學生文件，**不需登入**。 |
| 身分驗證 | 規則沒有檢查 `request.auth`、UID、角色或資料擁有者。 |
| 風險等級 | **緊急／嚴重**：舊資料含可預測帳戶 ID，而原始碼審核顯示它可能含明文密碼；資料保密性、完整性和帳戶安全均不受保護。 |

> 本次只讀檢查沒有點選「Publish」、沒有修改規則文字，亦沒有啟動規則模擬寫入。

## Firebase Authentication 設定（只讀觀察）

| 項目 | 結果 | 上線含義 |
|---|---|---|
| 帳戶連結政策 | 預設選項為「Link accounts that use the same email」。 | 可維持預設；不應為舊資料遷移而自動合併不明帳戶。 |
| 已授權網域 | `localhost`、`chinese-training-platform.firebaseapp.com`、`chinese-training-platform.web.app`。 | Firebase 的預設 Hosting 網域已授權；若目前網站另行部署在 GitHub Pages 或自訂網域，必須在啟用正式登入前新增該網域。 |
| Email/Password 供應商 | 在先前的登入供應商清單中未見啟用。 | 建立正式學生與管理員帳戶前，必須先啟用 Email/Password；此操作應在程式碼已支援新登入流程、備份已完成後進行。 |

> 本次沒有新增或刪除網域、沒有儲存 Authentication Settings，亦沒有啟用任何登入供應商。

## Firebase 專案與近期 Firestore 用量（只讀觀察）

| 項目 | 結果 |
|---|---|
| Firebase 方案 | Spark（No-cost / $0 每月）。 |
| 已註冊 Firebase App | 主控台顯示 1 個 App。 |
| Firestore 近一週圖表涵蓋期間 | 2026-08-19 至 2026-08-25（GMT+8）。 |
| 讀取操作 | 圖表資料點最小 0、最大 18；目前 0。 |
| 寫入操作 | 圖表資料點最小 0、最大 39；目前 0。 |

這些數字僅為控制台指定期間內的近期觀察，不可視為公開上線後 1,000+ 帳戶的容量保證。遷移後仍須以節流寫入、最小讀取、使用量告警／定期檢查及權限限制，保持在 Spark 配額內。
