# Cloud Scheduler 設定

Cloud Run Job 採短任務模式：Scheduler 每 5 分鐘觸發，程式只在台北時間工作日 08:50 至 13:20 處理一次行情、策略及模擬委託，完成後立即結束。盤外、週末及證交所公告休市日會在讀取帳戶、Firestore、行情及寫入資料前直接退出。只建立一個排程：

```powershell
gcloud scheduler jobs create http tw-stock-weekday `
  --location=asia-east1 --schedule="*/5 8-13 * * 1-5" --time-zone="Asia/Taipei" `
  --uri="https://run.googleapis.com/v2/projects/project-aef205b5-5c27-4084-94c/locations/asia-east1/jobs/tw-stock-simulator:run" `
  --http-method=POST --headers="Content-Type=application/json" --message-body="{}" `
  --oauth-service-account-email="tw-stock-scheduler@project-aef205b5-5c27-4084-94c.iam.gserviceaccount.com" `
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" `
  --attempt-deadline=60s --max-retry-attempts=0
```

排程在 08:00 至 13:55 間觸發，但程式只接受 08:50 至 13:20，因此盤外觸發只需極短的啟動與時間判斷。進入交易時段後，程式先讀取證交所 OpenAPI 的年度開休市資料；休市日回傳 `TWSE_MARKET_CLOSED`，不初始化模擬引擎、不讀寫 Firestore／Storage，也不抓候選行情。若證交所行事曆暫時無法取得，為避免交易日漏跑會記錄警告並繼續，但候選行情仍不得使用假價格。

排程時間點的第一個有效 tick 是 08:50，最後一個是 13:20。每個正常交易日有 55 次有效 tick；連同盤外快速退出，一個工作日最多觸發 72 次，比每 4 分鐘版本的 90 次少 20%。若 55 次有效 tick 都用滿 55 秒、1 vCPU，22 個交易日約為 66,550 vCPU 秒。為了限制最壞成本，工作不自動重試，失敗留待下一個 5 分鐘 tick；實際額度仍會與同一帳單帳戶下其他 Cloud Run 用量合併計算。

Apps Script 的 Script Property 設定 `TW_STOCK_CLOUD_DASHBOARD_URL`，值為公開唯讀 dashboard JSON 或受控的 Apps Script 可讀端點。Storage 原始行情 bucket 不應公開。
