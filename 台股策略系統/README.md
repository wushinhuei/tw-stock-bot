# 台股策略系統

目前系統已改為 Apps Script 雲端執行，GitHub Pages 只負責顯示結果。

## 目錄

```text
apps_script/
```

Google Apps Script 後端：
- 每 1 分鐘觸發一次，但只有台股交易日 08:45-15:45 真正更新。
- 週末、證交所休市日與非更新時段直接回傳快取，節省 Apps Script 與資料 API 用量。
- 抓 TWSE MIS 即時報價。
- 抓 TWSE BFT41U 盤後定價交易。
- 抓 TWSE T86 法人買賣超。
- 抓 TWSE MI_MARGN 融資融券。
- 抓 Yahoo Finance 歷史線圖。
- 自動模擬買賣、當沖與盤後定價交易。
- 記錄扣除手續費與交易稅後的損益。

```text
web/
```

GitHub Pages 前端：
- 顯示總資產、報酬率、持倉、交易紀錄。
- 每 1 分鐘讀取 Apps Script 最新結果；休市或非更新時段只讀快取。
- 按「更新資料」會要求 Apps Script 立即重抓。
- Apps Script 失敗時會退回靜態備援資料。

```text
simulation_result.json
```

靜態備援與人工檢查用的模擬結果。

## 操作方式

平常不需要開機，也不需要打開本機程式。Apps Script 觸發器會在 Google 雲端自動執行。

如果要修改交易邏輯，主要改：

```text
apps_script/Code.gs
```

修改後用 clasp 推送到 Apps Script，並更新 Web App 部署版本。

## 本機測試

策略核心測試使用 Node.js 內建測試工具，不需要另外安裝套件：

```powershell
node --test ..\tests\strategy_core.test.js
```

目前涵蓋每日停損、下一週半倉限制、最低現金保留，以及盤後重複刷新不得重複交易。
