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
- 完整資料每 30 分鐘讀取 Apps Script 最新快取；休市或非更新時段只讀快取。
- 若背景買賣紀錄改變，會立即刷新網頁資料。
- 按「更新資料」才會要求 Apps Script 立即重抓。
- Apps Script 失敗時會退回靜態備援資料。

## 操作方式

平常不需要開機，也不需要打開本機程式。Apps Script 觸發器會在 Google 雲端自動執行。

如果要修改交易邏輯，主要改：

```text
apps_script/Code.gs
```

修改後用 clasp 推送到 Apps Script，並更新 Web App 部署版本。
