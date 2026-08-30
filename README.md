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

## 環境變數

| 變數 | 用途 |
|---|---|
| `REDCAP_URL`、`REDCAP_TOKEN` | REDCap API（預設 `https://redcap.ntuh.gov.tw/api/`） |
| `USER_PASSWORD` | 全站登入密碼 |
| `ADMIN_PASSWORD` | 管理者操作密碼 |
| `REDIS_URL` | app 狀態儲存（Vercel 環境） |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob，screening 每日掃描檔 |
| `SCREENING_API_TOKEN` | 院內 scraper 上傳用的 Bearer token |
| `REPORT_API_TOKEN` | 外部 PA 週報 routine 拉取 `/api/report/weekly` |
| `GMAIL_USER`、`GMAIL_APP_PASSWORD` | 共識會議提醒信 |
| `APP_BASE_URL` | 信件內連結的站台位址（未設時退回 Vercel 提供的 host） |

## 部署

**Vercel 是唯一維護中的部署目標。** 應用依賴 Vercel Blob（screening）與 Redis（app 狀態），重建計畫後續階段還會加上 Postgres 與排程。

repo 內的 `Dockerfile` 與 `docker-compose.yml` **未維護、目前不可用**：`docker-compose.yml` 缺少 `USER_PASSWORD`（沒有它 proxy 會把每個頁面導回 `/login`）、`REDIS_URL`（app 狀態無處存放，重建即遺失）與 `BLOB_READ_WRITE_TOKEN`（screening 功能無法運作），也沒有掛載 `/app/data` volume。設計書 §15 Phase 0 建議移除這兩個檔案；在做出決定前先保留但不要當成可用的部署路徑。
