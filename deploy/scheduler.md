# Cloud Scheduler 設定

Cloud Run Job 不會自行常駐，交易日由 Scheduler 於台北時間 08:20 觸發；程式自行執行到 13:35。建立兩個排程：

```powershell
gcloud scheduler jobs create http tw-stock-weekday `
  --location=asia-east1 --schedule="20 8 * * 1-5" --time-zone="Asia/Taipei" `
  --uri="https://asia-east1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT_ID/jobs/tw-stock-simulator:run" `
  --http-method=POST --oauth-service-account-email="SERVICE_ACCOUNT"
```

台灣休市日仍會觸發，正式環境應由候選資料產生器的交易日檢查直接結束。服務帳號只授予 Run Invoker、指定 Firestore 路徑及指定 Storage bucket 權限。

Apps Script 的 Script Property 設定 `TW_STOCK_CLOUD_DASHBOARD_URL`，值為公開唯讀 dashboard JSON 或受控的 Apps Script 可讀端點。Storage 原始行情 bucket 不應公開。
