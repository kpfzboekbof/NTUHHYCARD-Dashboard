@AGENTS.md

# Git 安全規則

- **推送 main 前必須先拉取最新版本**：執行 `git pull --rebase origin main` 確認 local 是最新的，再 push。
- **絕對不要 force push main**：禁止 `git push --force`、`git push --force-with-lease` 到 main 分支。
- **注意不要意外刪除檔案**：commit 前用 `git diff --stat` 檢查變更，確認沒有非預期的檔案刪除。
