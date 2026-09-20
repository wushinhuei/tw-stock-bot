# PROJECT PLAN

## 專案
tw-stock-bot：台股純做多雲端模擬交易與績效追蹤系統。

## 最高原則
- 僅模擬交易，不連券商 API、不執行真實下單。
- 以現有 README.md、操作規則.md、程式碼、測試與部署設定為需求依據。
- 不自行降低既有風控、資料品質或驗收標準。
- GitHub repository 為跨 Work 執行週期的持久化狀態來源。

## 無人值守工作目標
1. 盤點現有程式、測試、CI/CD、Cloud Run/Cloud Build/Apps Script/GitHub Pages 狀態。
2. 修正可重現的程式、排序、資料一致性、建置與部署問題。
3. 保持模擬交易核心規則與 README/操作規則一致。
4. 補足必要測試並執行可用的 build/check/test。
5. 每個可驗證工作單元完成後更新 WORK_PROGRESS.md 與 NEXT_TASK.md。
6. 所有必要驗收條件完成後才將 STATUS 設為 COMPLETE。

## 驗收條件
- [ ] 專案結構與主要執行路徑已盤點。
- [ ] 現有自動測試通過；若環境無法執行，需記錄明確原因。
- [ ] npm run check 通過；若環境無法執行，需記錄明確原因。
- [ ] 已知可重現的 Critical/High 問題已修正或明確標記 BLOCKED。
- [ ] 交易/委託/成交/時間排序與資料顯示邏輯一致。
- [ ] Cloud Build/部署設定經靜態檢查，能驗證時完成實際驗證。
- [ ] README 與實際行為一致。
- [ ] 不含秘密、Token、服務帳號金鑰等敏感資料。
- [ ] WORK_PROGRESS.md 記錄最終測試、部署與 commit 狀態。

## 安全界線
不得啟動真實金融交易、付款、刪除 production 資料、force push、公開秘密資料或進行其他不可逆高風險操作。需要人工核准時標記 WAITING_FOR_USER，但繼續其他安全且不受阻塞的工作。

## 執行策略
每輪：READ → UNDERSTAND → CONTINUE → TEST → VERIFY → CHECKPOINT → COMMIT → CONTINUE。
不得依賴前一輪聊天記憶；先讀本檔、WORK_PROGRESS.md、NEXT_TASK.md、README.md、操作規則.md及最新 repository 狀態。
