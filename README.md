# 台股多策略雲端模擬

這個專案以 Google Cloud Run Job 模擬上市股票盤中零股交易，不連券商 API、不真實下單。Firestore 保存帳戶、持倉、委託、交割及消息索引；Cloud Storage 保存壓縮行情、RSS 與回測輸入；Apps Script 負責 Google Sheets 設定、報表、通知及公開 API；GitHub Pages 顯示儀表板。

## 網址

- 前端網站：https://wushinhuei.github.io/tw-stock-bot/
- 音訊無縫循環與 MP3 輸出：https://wushinhuei.github.io/tw-stock-bot/audio-loop/
- Apps Script 專案：https://script.google.com/d/10V4wAflJ30eQBWCsfikj-4xPX5uKY0IgBIGeaDarqeUJoiMd5ob8O_9o/edit

## 執行流程

```text
Cloud Scheduler 每 5 分鐘觸發短任務；交易日 08:50 至 13:20 執行，證交所休市日快速退出
        ↓
上市普通股成交量前 50 名 → 指定產業 → 最多完整分析 30 檔
        ↓
技術 35、量價 OBV 20、籌碼 15、基本面 10、官方消息 15、執行品質 5
        ↓
A 級 80 分以上才可模擬當沖、隔日沖或波段
        ↓
Firestore / Storage → Apps Script 唯讀代理 → GitHub Pages
```

一般買進與停利最多重新掛價 3 次；抽單確認前不得送替代單。買單立即圈存，成交列 T+2 應付款，賣款 T+2 前列應收。現金至少保留 40%，另保留權益 5% 與 5,000 元較高者。每日 -2% 停止新增部位；每週 -5% 只允許減碼和平倉。

台灣媒體查核來源包含中央通訊社、經濟日報、工商時報、MoneyDJ 與 DIGITIMES。媒體證據只在官方消息 15 分內作 -3 至 +3 分修正：單一媒體只提示，至少兩個獨立來源或一個媒體加官方事件識別碼一致才計分，而且媒體加分不能單獨把 B 級升為 A 級。中央社可使用其公開 RSS；其他來源只接受人工輸入或已取得授權的 RSS/API，不爬取全文。

Investing.com 僅透過允許的 RSS 保存標題、摘要、時間、分類及原文連結；內容只作國際風險提示，不進入正式 100 分、不直接觸發交易，失敗也不會中斷持倉管理。

## 主要目錄

- `cloud_simulator/`：Cloud Run 多策略核心、評分、OBV、委託、交割、新聞提示與回測入口。
- `台股策略系統/apps_script/`：設定、報表、通知及公開唯讀 API；未設定雲端網址時保留舊版回退。
- `台股策略系統/web/`：GitHub Pages 儀表板。
- `操作規則.md`：選股、進出場、資金與風控規則。

## 本機驗證

```powershell
npm.cmd install
npm.cmd test
npm.cmd run check
```

## 雲端部署

1. 建立 Firestore、私人 Cloud Storage bucket、Artifact Registry 與最小權限服務帳號。
2. 修改 `cloudbuild.yaml` 的 `_GCS_BUCKET`，執行 `gcloud builds submit --config cloudbuild.yaml`。
3. 依 `deploy/scheduler.md` 建立台北時間工作日每 5 分鐘觸發的排程；程式只接受 08:50 至 13:20，並在初始化模擬與讀寫雲端資料前排除證交所休市日。
4. `CANDIDATE_SNAPSHOT_URL` 可傳完整 `candidates[]`，或 `volumeRows[]` 與 `enrichmentBySymbol` 讓 Cloud Run 篩選及評分。
5. Apps Script 的 Script Property 設 `TW_STOCK_CLOUD_DASHBOARD_URL`，建立新版 Web App 部署後驗證匿名讀取。

回測使用 `RUN_MODE=backtest` 與 `BACKTEST_INPUT_URL`。資料須含按時間排列的 `frames[]`，不可用未來事件回填當時分數。Investing.com RSS 只從啟用後做前測對照，不列入三年正式評分。

本系統只做模擬與績效追蹤，不保證獲利。
