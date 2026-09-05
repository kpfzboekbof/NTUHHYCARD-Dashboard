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
| `GMAIL_USER`、`GMAIL_APP_PASSWORD` | 共識會議提醒信、催辦信、看門狗警報 |
| `ALERT_EMAIL` | （選用）看門狗系統警報的收件人；未設定時寄給 `GMAIL_USER` 本身。警報**不會**寄給人員名單裡的任何人 |
| `APP_BASE_URL` | 信件內連結的站台位址（登入連結必須有此設定或 Vercel 自動變數，不接受請求標頭） |
| `CRON_SECRET` | Vercel Cron 呼叫 `/api/cron/*` 的 Bearer token（Vercel 會自動帶上）；未設定時排程端點只接受 manager session |
| `SNAPSHOT_STALE_HOURS` | 快照多久沒更新算停擺（看門狗用，預設 30） |

## 尚未開始鍵入的表單

`ntuh_nhi_ed_vital` 與 `ntuh_exam_ct` 在 REDCap 有 instrument，但實際上還沒有人在鍵入——ED Vital 全部 7,053 位未排除病人裡只有 2 位有任何一列資料，CT 則是 7,169 筆記錄裡連一個欄位都沒填過（2026-08-31 實測）。照常追蹤的話這兩張表會永遠停在 0%，把負責人畫成永遠落後，就是當初移除 Holter/Treadmill 幽靈表單的同一個問題。

因此它們在 `config/forms.ts` 標了 `pendingEntry`，並成為 `hiddenForms` 的**預設值**——只有在管理者從未存過設定時才套用。開始鍵入的那天，到 `/assign` 把勾取消再存檔即可讓它重新出現，不需要改程式或重新部署。表單定義本身一直都在，drift 報告也照常比對。

## 使用模型

**這個 Dashboard 只有一位使用者：資料庫負責人。** 其他同仁在 REDCap 裡鍵入資料，不會登入這個系統。所有頁面都是負責人的監控視圖；要觸達鍵入者只有一條路——寄信（目前是共識會議提醒信）。設計書 §1.5 有完整說明。

## 登入

兩條路徑並存，都是給負責人自己用的：

| | 共用密碼 | Email magic link |
|---|---|---|
| 身分 | 沒有——只知道「有人」 | `person` 表裡的一個人 |
| 稽核 | 記成 `legacy-shared-admin` | `audit_log` 記 `person.id`，看得到真名 |
| 使用 | 記密碼 | 收信點連結 |

magic link 的連結 15 分鐘有效且只能用一次——`login_token` 表記錄已使用，純簽章擋不住轉寄重放。要用的話先到 `/admin/people` 按「從 REDCap 匯入」建立自己的 `person` 列並給 `manager` 角色。不想用就繼續用共用密碼，兩者都會一直有效。

覺得可以退役共用密碼時設 `LEGACY_AUTH=off`，`src/lib/auth.ts` 的 DJB2 路徑就可以整個刪掉。

`/admin/people` 的主要用途其實不是登入，而是**對照表**：REDCap 帳號 ↔ etiology labeler 代碼 ↔ email ↔ 顯示名稱。這是讓 `/owners`、`/productivity` 之後能停止用顯示名稱字串比對人的前提（設計書 Phase 5）。

伺服器端的權限檢查只有一個進入點：`requireRole()`（`src/lib/auth/identity.ts`）。角色模型有五級但實務上只用 `manager`。proxy 只做簽章層級的樂觀檢查，不查資料庫——Next 16 文件明確要求 proxy 不當成完整授權層。

## 快取與資料新鮮度（衍生視圖）

每個重頁面（總覽、熱力圖、未完成清單、負責人進度、Etiology、品管、鍵入進度）都是從 REDCap 匯出推導出來的「視圖」，一次推導要 10 秒到一分鐘。這些視圖以前放在 5 分鐘就忘掉的快取裡，只有一位操作者的情況下，幾乎每次隔一陣子再開頁面都要在轉圈圈前面等 REDCap 重跑一次。

現在（`src/lib/views/`）：

- **先回答，再更新**：頁面永遠先拿到最後一次成功推導的結果；超過該視圖的更新間隔（completion 10 分、狀態矩陣 30 分、etiology 5 分、日誌 15 分）就在回應送出之後用 Next 的 `after()` 於背景重推導。標頭會顯示「背景更新中」，頁面每 15 秒輪詢一次，新資料落地就自動換上。只有**從來沒有任何快照**、按了「重新抓取」、或視圖被寫入動作標記為需要重推導時，請求才會等 REDCap。
- **儲存在哪**：推導結果 gzip 後放 Vercel Blob（`views/<key>.json.gz`，與狀態基準線同處——etiology 與日誌視圖含病歷號與欄位值，依上面「臨床資料一律留在 REDCap／管理資料庫只放中繼資料」的原則不進 Postgres）；Postgres 的 `derived_snapshot`（migration 0005）只放每個視圖的推導時間、大小、失效標記與重推導租約。沒有設定資料庫時退回 Redis（一天 TTL）。
- **REDCap 一次只做一件事**：背景重推導在同一個實例上排隊、跨實例用 `__redcap_export__` 這一列租約互斥（實測兩個匯出並行會從一分鐘變十分鐘）。前景重推導遇到租約被占用時，先回目前有的資料並標「背景更新中」，不會再開第二個匯出。
- **寫入只失效相關視圖**：etiology_final、QC 批次修正、/assign 的設定變更各自標記受影響的視圖（`src/lib/views/keys.ts`），不再 `clearAllCache()` 轟掉全站。Etiology 視圖是例外——共識會議寫完就要讀回自己的寫入，所以它被標記後**下一次讀取會等重推導**，其餘視圖照常先回舊資料。
- **寄信不用舊資料**：催辦與批次提醒信在矩陣超過 10 分鐘時會先重推導再寄。
- **背景重推導被平台砍掉**（函式時間上限）連續 3 次沒落地，該視圖就停止背景重試並在標頭顯示「背景更新失敗」，到該頁按「重新抓取」在前景重跑；`/admin/system` 的「衍生視圖快照」列出每個視圖的最後推導時間與重跑次數。
- **completion 改用壓縮格式**：`/api/completion` 回傳 `packed`（每筆病人一組狀態字串）而不是 ~19 萬列的 `rows`（約 30 MB JSON → 不到 0.5 MB），`useCompletionData` 在瀏覽器端還原成元件用的列。
- 每日快照 cron 推導完矩陣也會直接寫進視圖，早上第一次開 `/incomplete`、`/owners` 不用等。

## 排程（vercel.json）

兩條每日 cron（Hobby 方案的上限內）：

| 路徑 | 台北時間 | 做什麼 |
|---|---|---|
| `/api/cron/snapshot` | 05:30 | 快照 → 推導 → 與基準線 diff → 寫 `work_event` → 更新基準線。漏跑只會延遲「新交接」資訊，不會弄丟工作（佇列永遠從最新快照即時推導）。實測約 **38 秒**（7,169 病人 × 32 單元），刻意壓在 Vercel Hobby 的 60 秒函式上限內 |
| `/api/cron/watchdog` | 15:30 | 只管「系統自己壞了」：scraper 當日缺檔、快照停擺——這兩件事不會出現在任何佇列裡。每事件每日最多一封信，寄給負責人 |

手動觸發：manager 登入後直接 GET 這兩個路徑即可（不需要 CRON_SECRET）。

## 部署

**Vercel 是唯一維護中的部署目標。** 應用依賴 Vercel Blob（screening、狀態基準線、衍生視圖內容）、Redis（app 狀態）與 Postgres（人員、稽核、事件、視圖中繼資料）。部署新版前先 `npm run migrate` 套用 migration 0005。

repo 內的 `Dockerfile` 與 `docker-compose.yml` **未維護、目前不可用**：`docker-compose.yml` 缺少 `USER_PASSWORD`（沒有它 proxy 會把每個頁面導回 `/login`）、`REDIS_URL`（app 狀態無處存放，重建即遺失）與 `BLOB_READ_WRITE_TOKEN`（screening 功能無法運作），也沒有掛載 `/app/data` volume。設計書 §15 Phase 0 建議移除這兩個檔案；在做出決定前先保留但不要當成可用的部署路徑。
