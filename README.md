# OHCA Dashboard

NTUH OHCA registry 的管理儀表板。REDCap（pid=8207）是唯一的資料來源，這個 app 只讀取並衍生管理視圖；每一列都深連結回 REDCap 的資料輸入頁——**Dashboard 是佇列，REDCap 是編輯器**。

正在依 [`docs/management-system-redesign.md`](docs/management-system-redesign.md) 分階段重建管理層（WorkUnit 設定化拆分、狀態機交接引擎、人員身分與進度模型）。

## 開發

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run test         # node --test（Node 22 原生剝離 TS 型別，無需額外套件）
```

Next.js 16 與訓練資料中的版本有出入（middleware 已改名 proxy 等）。**動任何程式碼前先讀 `node_modules/next/dist/docs/`**，見 [`AGENTS.md`](AGENTS.md)。

本地開發時，app 狀態（負責人指派、labeler、會議設定）寫在 gitignore 的 `./data/*.json`；部署環境改用 Redis。

管理資料庫（人員身分、稽核記錄）用 Postgres：`npm run migrate` 套用 `migrations/` 底下的 SQL。**這個專案的資料表必須獨立於其他應用程式**——migration runner 會先檢查目標資料庫裡有沒有不屬於本專案的資料表，有就拒絕執行。臨床資料一律留在 REDCap，這個資料庫只放 REDCap 表達不了的管理中繼資料。

## 環境變數

| 變數 | 用途 |
|---|---|
| `OHCA_DATABASE_URL` | 管理資料庫（人員、稽核）的 Neon 連線字串。未設定時退回 `DATABASE_URL`——專屬變數名是為了讓多專案共用的開發環境不會互撞 |
| `SESSION_SECRET` | 簽發／驗證個人登入 session |
| `REDCAP_URL`、`REDCAP_TOKEN` | REDCap API（預設 `https://redcap.ntuh.gov.tw/api/`） |
| `USER_PASSWORD` | 全站共用登入密碼（遷移期用，見下方「登入」） |
| `ADMIN_PASSWORD` | 管理者共用密碼（同上；另兼 RSVP 連結簽章） |
| `LEGACY_AUTH` | 設為 `off` 後不再接受上面兩組共用密碼，只剩個人登入 |
| `REDIS_URL` | app 狀態儲存（Vercel 環境） |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob，screening 每日掃描檔 |
| `SCREENING_API_TOKEN` | 院內 scraper 上傳用的 Bearer token |
| `REPORT_API_TOKEN` | 外部 PA 週報 routine 拉取 `/api/report/weekly` |
| `GMAIL_USER`、`GMAIL_APP_PASSWORD` | 共識會議提醒信 |
| `APP_BASE_URL` | 信件內連結的站台位址（未設時退回 Vercel 提供的 host） |

## 尚未開始鍵入的表單

`ntuh_nhi_ed_vital` 與 `ntuh_exam_ct` 在 REDCap 有 instrument，但實際上還沒有人在鍵入——ED Vital 全部 7,053 位未排除病人裡只有 2 位有任何一列資料，CT 則是 7,169 筆記錄裡連一個欄位都沒填過（2026-08-31 實測）。照常追蹤的話這兩張表會永遠停在 0%，把負責人畫成永遠落後，就是當初移除 Holter/Treadmill 幽靈表單的同一個問題。

因此它們在 `config/forms.ts` 標了 `pendingEntry`，並成為 `hiddenForms` 的**預設值**——只有在管理者從未存過設定時才套用。開始鍵入的那天，到 `/assign` 把勾取消再存檔即可讓它重新出現，不需要改程式或重新部署。表單定義本身一直都在，drift 報告也照常比對。

## 登入

兩條路徑並存，正在從左邊走到右邊：

| | 共用密碼（舊） | Email magic link（新） |
|---|---|---|
| 身分 | 沒有——只知道「有人」 | `person` 表裡的一個人 |
| 權限 | 兩級：使用者／管理者 | `manager` / `doctor` / `abstractor` / `labeler` / `viewer` |
| 稽核 | 記不到人 | `audit_log` 記 `person.id` |

個人登入的前置作業：`/admin/people` 按「從 REDCap 匯入」把 REDCap 使用者清單（帳號、姓名、email）帶進 `person`，再逐一設定角色與 labeler 代碼。之後每個人在 `/login` 選「改用 email 登入」收連結即可——連結 15 分鐘有效且只能用一次（`login_token` 表記錄已使用，純簽章擋不住轉寄重放）。

全員都以 email 登入過之後，設 `LEGACY_AUTH=off`；共用密碼即失效，`src/lib/auth.ts` 的 DJB2 路徑就可以整個刪掉。

伺服器端的權限檢查只有一個進入點：`requireRole()`（`src/lib/auth/identity.ts`）。proxy 只做簽章層級的樂觀檢查，不查資料庫——Next 16 文件明確要求 proxy 不當成完整授權層。

## 部署

**Vercel 是唯一維護中的部署目標。** 應用依賴 Vercel Blob（screening）與 Redis（app 狀態），重建計畫後續階段還會加上 Postgres 與排程。

repo 內的 `Dockerfile` 與 `docker-compose.yml` **未維護、目前不可用**：`docker-compose.yml` 缺少 `USER_PASSWORD`（沒有它 proxy 會把每個頁面導回 `/login`）、`REDIS_URL`（app 狀態無處存放，重建即遺失）與 `BLOB_READ_WRITE_TOKEN`（screening 功能無法運作），也沒有掛載 `/app/data` volume。設計書 §15 Phase 0 建議移除這兩個檔案；在做出決定前先保留但不要當成可用的部署路徑。
