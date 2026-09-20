# NEXT TASK

## 下一個工作
建立 tw-stock-bot 的可重現基線：盤點目錄、package scripts、測試、Cloud Build/部署設定及目前已知問題，然後執行可用測試。

## 目的
讓後續每一次 Scheduled Work 都能從客觀的 GitHub 狀態繼續，而不是重做或依賴聊天記憶。

## 執行步驟
1. 讀 PROJECT_PLAN.md、WORK_PROGRESS.md、README.md、操作規則.md。
2. 檢查 package.json、測試目錄、cloudbuild.yaml、deploy/ 與 GitHub Actions（若存在）。
3. 執行或等價驗證 npm install、npm test、npm run check；保存失敗訊息，不得猜測成功。
4. 優先修正可重現且風險低的 build/test/check 問題。
5. 檢查近期與「時間排序、模擬交易日誌、Cloud Build」相關程式路徑，若問題仍存在則建立最小重現並修正。
6. 每完成一個可驗證工作單元，更新 WORK_PROGRESS.md。
7. 將下一個最小工作寫回本檔。
8. 在本輪額度允許範圍內持續處理，不因完成單一小步驟而停止。

## 完成條件
- 基線檢查結果已寫入 WORK_PROGRESS.md。
- 測試/check 有實際結果或明確 BLOCKED 原因。
- NEXT_TASK.md 指向下一個尚未完成且可驗證的工作。

## 重試與停止
同一錯誤不得無限重試。重複失敗時記錄 ERROR、ATTEMPTS、LIKELY_CAUSE、NEXT_RECOMMENDED_ACTION，改做其他不受阻塞工作。只有 PROJECT_PLAN.md 所有必要驗收條件成立才可 STATUS=COMPLETE。
