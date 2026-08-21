# Cloud Scheduler 設定

Cloud Run Job 採短任務模式：Scheduler 每 4 分鐘觸發，程式只在台北時間工作日 08:50 至 13:20 處理一次行情、策略及模擬委託，完成後立即結束。盤外與週末觸發會直接退出。只建立一個排程：

```powershell
gcloud scheduler jobs create http tw-stock-weekday `
  --location=asia-east1 --schedule="*/4 8-13 * * 1-5" --time-zone="Asia/Taipei" `
  --uri="https://run.googleapis.com/v2/projects/project-aef205b5-5c27-4084-94c/locations/asia-east1/jobs/tw-stock-simulator:run" `
  --http-method=POST --headers="Content-Type=application/json" --message-body="{}" `
  --oauth-service-account-email="tw-stock-scheduler@project-aef205b5-5c27-4084-94c.iam.gserviceaccount.com" `
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" `
  --attempt-deadline=60s --max-retry-attempts=0
```

排程在 08:00 至 13:58 間觸發，但程式只接受 08:50 至 13:20，因此多餘觸發只需極短的啟動與時間判斷。台灣國定休市日仍應由候選資料產生器的交易日檢查直接結束。服務帳號只授予 Run Invoker、指定 Firestore 路徑及指定 Storage bucket 權限。

排程時間點的第一個有效 tick 是 08:52，最後一個是 13:20，容許約 2 分鐘盤前誤差。每個正常交易日有 68 次有效 tick；連同盤外快速退出，一天最多觸發 90 次。即使每次都用滿 55 秒、1 vCPU，22 個交易日約為 108,900 vCPU 秒，仍低於 Cloud Run 每月 240,000 vCPU 秒免費額度並保留約 55% 餘裕。為了限制最壞成本，工作不自動重試，失敗留待下一個 4 分鐘 tick；實際額度仍會與同一帳單帳戶下其他 Cloud Run 用量合併計算。

Apps Script 的 Script Property 設定 `TW_STOCK_CLOUD_DASHBOARD_URL`，值為公開唯讀 dashboard JSON 或受控的 Apps Script 可讀端點。Storage 原始行情 bucket 不應公開。
