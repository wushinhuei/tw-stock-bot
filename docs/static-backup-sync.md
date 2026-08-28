# GitHub Pages 靜態備援資料同步

GitHub Pages 會讀取 `台股策略系統/web/actual_data.js` 與 `台股策略系統/web/simulation_result.js` 作為靜態備援資料。這兩個檔案不應停留在舊交易日。

## 更新時機

- 每個交易日台北時間 15:45，由 GitHub Actions 自動更新一次。
- 雲端模擬器只要新增模擬成交，就立即觸發 GitHub Actions 更新一次。
- 若即時觸發失敗，收盤排程仍會補上最新備援資料。

## 雲端模擬器需要的環境變數

即時成交觸發需要在 Cloud Run 或執行環境設定：

- `GITHUB_STATIC_BACKUP_TOKEN`：可觸發 repository workflow dispatch 的 GitHub token。
- `STATIC_BACKUP_ON_TRADE=1`：明確啟用成交後立即同步。
- `GITHUB_STATIC_BACKUP_REPOSITORY=wushinhuei/tw-stock-bot`：可省略，預設就是本倉庫。
- `GITHUB_STATIC_BACKUP_WORKFLOW=update-static-dashboard.yml`：可省略，預設就是備援更新 workflow。
- `GITHUB_STATIC_BACKUP_REF=main`：可省略，合併到主分支後建議使用 `main`。
- `STATIC_BACKUP_COOLDOWN_MS=120000`：可省略，預設 2 分鐘內只觸發一次，避免連續成交造成過多 workflow。

## 運作方式

雲端模擬器完成訂單撮合後，會比較成交前後的交易筆數。只要本次 tick 或 session 新增交易，就呼叫 GitHub Actions 的 `workflow_dispatch`。workflow 會抓取 Cloud Run 儀表板資料，失敗時改抓 Apps Script refresh/read，最後回寫 GitHub Pages 靜態備援檔。

## 注意

GitHub Actions 的排程與 workflow dispatch 需要 workflow 存在於 `main` 才會正式穩定運作。因此本分支合併後，才會啟用完整自動同步。
