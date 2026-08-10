# 台股選股與操作策略系統

這個資料夾把「產業、基本、籌碼、技術、風控」策略整理成可執行的提醒系統。系統只做候選股分級與操作提醒，不會自動下單。

## 檔案

- `strategy_config.js`：策略參數、觀察族群、標的設定。
- `strategy_engine.js`：大盤濾網、族群強度、訊號分級、假突破冷卻、虧損限制等核心規則。
- `generate_watchlist.js`：讀取行情 JSON，輸出每日 Markdown 觀察清單。
- `update_actual_data.js`：抓 Yahoo Finance 台股行情，更新網頁使用的實際模擬資料。
- `web/index.html`：本機網頁儀表板，可看買賣建議、手動持股損益與 10 萬零股模擬自動交易。
- `sample_market_data.json`：範例資料，可用來測試輸出格式。
- `test_strategy_engine.js`：核心規則測試。
- `strategy_sop.md`：完整 SOP。
- `strategy_checklist.md`：盤前、盤中、進場、退場、盤後檢核表。

## 使用方式

### 打開網頁

可直接用瀏覽器開啟：

```text
C:\Users\a0802\Documents\股票分析\台股策略系統\web\index.html
```

若瀏覽器限制本機檔案功能，也可用本機預覽：

```powershell
cd 'C:\Users\a0802\Documents\股票分析\台股策略系統\web'
& 'C:\Users\a0802\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m http.server 8765 --bind 127.0.0.1
```

然後開啟：

```text
http://127.0.0.1:8765/index.html
```

網頁功能：

- 載入後直接自 2026-08-10 起，以 10 萬初始資金執行每日自動買賣模擬。
- 交易單位以 1 股零股為主，不再以 1,000 股整張為單位。
- 不提供人工選股、篩選、下單按鈕或檔案匯入選項。
- 依大盤濾網、A/B/C 分級、停損、目標價與當沖規則強制操作。
- 自動統計總資產、投報率、已實現損益、最大回撤、目前持倉。
- 自動紀錄每日資產與每筆波段/當沖模擬交易。
- 損益已扣除手續費與證券交易稅。
- 目前只模擬投報率，不自動下單；未來可把資料源與券商 API 接到同一套規則。

稅費假設：

- 股票買進：手續費 0.1425%，零股模擬每筆最低 1 元。
- 股票賣出：手續費 0.1425%，零股模擬每筆最低 1 元，另扣證券交易稅 0.3%。
- 現股當沖賣出：手續費 0.1425%，零股模擬每筆最低 1 元，另扣當沖證券交易稅 0.15%。
- 不同券商最低手續費與電子交易折扣不同；目前先用零股小額交易較合理的低門檻模擬。

### 產生 Markdown 報告與測試

```powershell
& 'C:\Users\a0802\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '台股策略系統\update_actual_data.js'
& 'C:\Users\a0802\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '台股策略系統\generate_watchlist.js' '台股策略系統\sample_market_data.json'
& 'C:\Users\a0802\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test '台股策略系統\test_strategy_engine.js'
```

目前實際行情模式：

- 資料來源：Yahoo Finance chart API。
- 起算日：2026-08-10。
- 目前候選池：2382、2049、1513、2330、2454、2317、2308、2357。
- 每次要更新目前損益時，先執行 `update_actual_data.js`，再重新整理網頁。

## GitHub Actions 每日自動模擬

已提供 workflow：

```text
.github/workflows/daily-tw-stock-simulation.yml
```

排程：

- 週一到週五 `15:20` 台北時間自動執行。
- 也可在 GitHub Actions 頁面用 `workflow_dispatch` 手動執行。

每日流程：

1. 抓 Yahoo Finance 台股行情並更新 `web/actual_data.js`。
2. 用 10 萬初始資金與零股規則重跑模擬。
3. 輸出 `web/simulation_result.js` 與 `simulation_result.json`。
4. 若結果有變更，自動 commit 回 GitHub。

注意：

- 目前只做模擬操作與績效紀錄，不自動下單。
- 若要讓 GitHub Pages 顯示最新結果，需將 GitHub Pages 指向包含 `台股策略系統/web/index.html` 的分支/路徑，或另行配置部署流程。

輸出報告預設寫到：

```text
台股策略系統\每日觀察清單.md
```

## 資料格式

輸入 JSON 需包含：

- `date`：報告日期。
- `portfolio`：總資金、今日/本週已實現損益。
- `market`：加權指數收盤、20MA、50MA。
- `groups`：族群強度。
- `candidates`：候選股票與各項條件。
- `breakoutHistory`：近期假突破紀錄。

參考 `sample_market_data.json`。
