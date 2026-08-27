# Firebase 安全認證遷移說明

**適用儲存庫：** `leunghn-tech/Primay_P.1-P.6_Chinese-Laguage`

**遷移分支：** `security/firebase-auth-migration`

**基線標籤：** `pre-firebase-security-migration-20260827`

## 目的與安全模型

本遷移移除舊版「在 Firestore 儲存明文密碼，再由瀏覽器比對」的做法。網站改由 **Firebase Authentication Email/Password** 驗證密碼；Firestore 則以 Authentication 自動簽發的 **UID** 作為資料主鍵。Firebase 官方文件指出，用戶端要求會先被 Security Rules 評估，而未登入要求的 `auth` 為 `null`；以 `request.auth.uid` 比對資料文件 UID 是使用者隔離的基礎做法。[1] [2]

| 身分 | Authentication 帳戶 | Firestore 文件 | 允許的瀏覽器端權限 |
|---|---|---|---|
| 學生 | Email/Password；畫面只顯示登入帳號 | `/users/{uid}`，`role: "student"` | 只可讀取及更新**自己的**進度資料。 |
| 管理員 | Email/Password；畫面名稱固定為 `admin` | `/users/{adminUid}`，`role: "admin"` | 可讀取與列出新資料模型下的學生資料；不可由瀏覽器刪除或修改學生文件。 |
| 未登入者／匿名帳戶 | 不可存取新版學生資料 | 無 | 不可讀、列、建、改、刪任何 `/users` 文件。 |
| 舊版資料 | 保留於舊路徑，只供 Firebase Console 的具權限管理者處理 | `/artifacts/chinese-training-platform/public/data/students/{legacyId}` | 網頁客戶端一律拒絕存取。 |

> **重要：** 使用者要求的管理員顯示帳號是 `admin`。Firebase Email/Password 必須使用電子郵件格式的識別字，因此程式只在內部把 `admin` 對應到保留識別字 `admin@chinese-training-platform.invalid`，不會在登入畫面顯示此識別字，也不會把密碼放入原始碼或 Firestore。

## 已加入的程式碼與規則

| 檔案 | 用途 |
|---|---|
| `firebase-secure-auth.js` | Firebase Authentication 登入、註冊、登出、UID 個人檔案載入、管理員介面與節流進度同步。 |
| `firebase-progress-bridge.js` | 24 個題庫頁的 Firebase 初始化、學生登入閘道、每 60 秒變更檢查與離頁同步。 |
| `firestore.rules` | 最小權限規則：學生 UID 隔離、管理員角色限制、停用瀏覽器端刪除及拒絕舊公開路徑。 |
| `firebase.json`、`tests/firestore-rules.test.mjs` | Firestore Emulator 本地規則測試設定與完整權限測試案例。 |
| `tests/firebase-security-static-check.mjs` | 防止匿名登入、硬編碼管理員密碼及舊公開資料路徑重現的靜態回歸檢查。 |

新程式只同步維持關卡進度所需的白名單鍵值，並限制鍵數、值長度及總資料量。教學提示、診斷紀錄、瀏覽器偏好、未知鍵和任何帳戶／密碼資訊不會上傳。進度寫入採 45 秒延遲、題庫頁 60 秒輪詢、離開頁面與手動備份時同步，且若資料未變更便不寫入。

## 既有帳戶與進度處理

舊 `students` 文件以可猜測的帳戶名稱為文件 ID，且現行資料與 Firebase Authentication 帳戶並無安全可用的對應關係。舊密碼不會被複製、雜湊後遷移、匯出或重用。每位既有學生均須以新密碼註冊新的 Firebase Authentication 帳戶；這是修復密碼外洩風險的必要步驟。

同一裝置上的學生在註冊時，如系統偵測到既有本機學習資料，會先顯示確認視窗。學生可選擇把**白名單內的本機進度**帶入新帳戶；不帶入舊密碼、帳戶資料或未知瀏覽器資料。共用裝置時，學生必須選擇「不帶入」，以免將別人的本機進度放進新帳戶。

舊 Firestore 文件應在規則發布後保留至少 90 日，但只能由具 Firebase Console 權限的管理者存取。寬限期結束、確認無保留需要及完成最小必要紀錄後，才應由管理者在 Firebase Console 以受控程序刪除舊文件與過去匿名 Authentication 帳戶。切勿把含歷史密碼欄位的舊文件匯出至 Git、共享雲端硬碟或一般報告。

## 正式發布前的 Firebase Console 操作

下列操作會影響正式服務，必須在程式分支完成檢查、管理者已確認維護時段後才執行。Firebase 官方指引要求先於 Authentication 的 Sign-in method 啟用 Email/Password；新註冊會以 `createUserWithEmailAndPassword` 建立帳戶並自動登入。[1]

| 順序 | 操作 | 原因與驗收 |
|---|---|---|
| 1 | 在 Authentication → Sign-in method 啟用 **Email/Password**，保留 Anonymous 暫時啟用。 | 先讓新網站具備正式登入能力；此步不會中斷舊網站。 |
| 2 | 在 Authentication → Users 新增管理員 Authentication 使用者：內部識別字 `admin@chinese-training-platform.invalid`，密碼使用管理者已另行提供的值。 | 只使用 Firebase Auth 儲存密碼；不把密碼加入程式碼、報告或 Firestore。 |
| 3 | 在 Firestore → Data 以管理員的實際 UID 建立 `/users/{adminUid}` 文件。**最小必要欄位是 `role: "admin"`**；`schemaVersion`、顯示名稱與空進度物件只屬管理介面描述資料，並非授權所需。 | 管理員角色必須在受保護資料中建立，不能由前端自行取得。 |
| 4 | 於本地及 Firebase Rules Playground 重做本文件的測試矩陣。 | 官方文件指出 Rules Playground 適合快速模擬，而 Emulator 適合完整自動化測試。[3] [4] |
| 5 | 宣布短暫維護時段，先發布 `firestore.rules` 的最終拒絕舊路徑版本，隨即把已驗證的遷移分支合併／發布到 `main`。 | 兩個服務沒有跨產品原子發布。選擇「先封鎖舊公開資料」優先保障學生資料，代價是舊版頁面在 GitHub Pages 建置完成前可能有短暫登入中斷。 |
| 6 | 在 `https://leunghn-tech.github.io/Primay_P.1-P.6_Chinese-Laguage/` 進行新學生註冊、學生重新登入、題庫進度同步、登出、管理員登入和報表讀取測試。 | 確認正式網站版本與正式規則一致。 |
| 7 | 驗收後停用 Anonymous。 | 防止日後繼續產生無用途匿名帳戶；不可在第 1–6 步之前停用，避免排錯範圍擴大。 |

## 已完成的生產切換紀錄（2026-08-27）

在管理者明確確認後，以下操作已完成。此紀錄不包含任何密碼、學生名稱、舊帳戶名稱或可存取資料。

| 項目 | 結果 |
|---|---|
| Email/Password 供應商 | 已啟用。 |
| 管理員模型 | 已建立 Firebase Authentication 管理員帳戶；登入畫面名稱維持 `admin`，授權以該帳戶 UID 的 `/users/{uid}` 文件 `role: "admin"` 為準。生產角色文件只保存這個最小必要欄位。 |
| Firestore Rules | 已發布新版最小權限規則，完全拒絕舊公開學生資料路徑。 |
| 正式網站 | 安全遷移拉取請求已合併到 `main`，GitHub Pages 已完成建置。 |
| 管理員驗收 | 正式網站的管理員登入及受控學生清單讀取已成功驗證；現時尚未有新模型學生文件，故清單為 0。 |
| 未登入者驗收 | 以未登入 Firebase 用戶端請求舊學生資料及新版管理員文件均取得 HTTP 403 / `PERMISSION_DENIED`。 |
| 匿名登入 | 已停用；既有匿名 Authentication 帳戶未刪除。 |
| 學生實機註冊 | 未建立人為測試學生，以避免產生不必要的帳戶和學生資料。該流程已由 Firestore Emulator 的規則測試與靜態網站檢查驗證；首次實際學生註冊時，應由管理者依本文件的測試矩陣覆核。 |

> Firebase Authentication 預設最低密碼長度為 6 個字元，並支援在 Console 設定更強的密碼政策。[1] 使用者指定的管理員密碼符合最低長度，但安全強度偏低；完成首次驗收後，應立即改為獨特且更長的密碼，並為 Firebase 專案擁有者的 Google 帳戶啟用多重驗證。

## 規則驗收矩陣

| 測試主體 | 路徑與操作 | 預期結果 |
|---|---|---|
| 未登入者 | `get /users/{studentUid}`、`list /users` | 均拒絕。 |
| 學生 A | `get/update /users/{studentAUid}`，只更改 `progress`、`updatedAt` | 允許。 |
| 學生 A | `get/update /users/{studentBUid}`、`list /users` | 均拒絕。 |
| 學生 A | 將自己的 `role` 改為 `admin` 或刪除自己的文件 | 拒絕。 |
| 學生 A | 新建 `/users/{ownUid}`，角色指定為 `admin` | 拒絕。 |
| 管理員 | 讀取單一學生、列出 `/users` | 允許。 |
| 管理員 | 瀏覽器端修改或刪除學生文件 | 拒絕；需使用 Firebase Console／受信任後端的受控程序。 |
| 任意網頁客戶端 | 讀寫舊 `/artifacts/.../students/{legacyId}` 路徑 | 拒絕。 |

完成這些測試後，才可把遷移分支併入 `main`。Firestore Emulator 的規則單元測試使用模擬身分測試並且不會接觸正式資源，是本儲存庫的主要自動化驗收方法。[3]

## 參考資料

[1] [Firebase：使用密碼型帳戶進行 JavaScript Authentication](https://firebase.google.com/docs/auth/web/password-auth)

[2] [Firebase：Security Rules 與 Firebase Authentication](https://firebase.google.com/docs/rules/rules-and-auth)

[3] [Firebase：測試 Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator)

[4] [Firebase：以 Rules Playground 快速驗證 Security Rules](https://firebase.google.com/docs/rules/simulator)
