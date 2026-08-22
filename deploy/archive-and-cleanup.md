# 月封存與自動清理

## 保存規則

- `raw/`：逐次行情保留 90 天。
- `monthly/`：每月合併為 `YYYY-MM.jsonl.gz`，在 Cloud Storage 保留 3 年。
- Google Drive：每月複製一份 `tw-stock-YYYY-MM.jsonl.gz`，不自動刪除。
- `public/dashboard.json`：不套用刪除規則。
- Artifact Registry：每個映像套件保留最近 3 個版本。

## 每月 Cloud Run 封存工作

使用與模擬器相同映像建立另一個短工作，於每月 1 日 01:00 壓縮上個月資料：

```powershell
gcloud run jobs create tw-stock-monthly-archive `
  --image=asia-east1-docker.pkg.dev/project-aef205b5-5c27-4084-94c/tw-stock/tw-stock-simulator:CURRENT_TAG `
  --region=asia-east1 --service-account=tw-stock-runtime@project-aef205b5-5c27-4084-94c.iam.gserviceaccount.com `
  --set-env-vars=RUN_MODE=monthly-archive,GCS_BUCKET=project-aef205b5-5c27-4084-94c-tw-stock-data `
  --cpu=1 --memory=512Mi --task-timeout=300s --max-retries=0
```

第二個 Scheduler 仍在每帳單帳戶 3 個免費工作的範圍內：

```powershell
gcloud scheduler jobs create http tw-stock-monthly-archive `
  --location=asia-east1 --schedule="0 1 1 * *" --time-zone="Asia/Taipei" `
  --uri="https://run.googleapis.com/v2/projects/project-aef205b5-5c27-4084-94c/locations/asia-east1/jobs/tw-stock-monthly-archive:run" `
  --http-method=POST --headers="Content-Type=application/json" --message-body="{}" `
  --oauth-service-account-email="tw-stock-scheduler@project-aef205b5-5c27-4084-94c.iam.gserviceaccount.com" `
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" --attempt-deadline=60s --max-retry-attempts=0
```

## Google Drive 月備份

更新 Apps Script 後手動執行一次 `configureMonthlyArchive` 並完成新增的 Cloud Storage 唯讀授權。它會建立「台股策略系統月封存」資料夾，並建立每月 1 日 03:00 左右執行的 `archivePreviousMonthToDrive` 觸發條件。重複執行時會以檔名去重。

## 清理政策

先確認前一個月的 `monthly/` 檔及 Google Drive 副本都存在，再套用：

```powershell
gcloud storage buckets update gs://project-aef205b5-5c27-4084-94c-tw-stock-data --lifecycle-file=deploy/storage-lifecycle.json
gcloud artifacts repositories set-cleanup-policies tw-stock --location=asia-east1 --policy=deploy/artifact-cleanup.json
```

Cloud Storage Lifecycle 與 Artifact Registry cleanup 都可能需要約 24 小時才開始反映。
