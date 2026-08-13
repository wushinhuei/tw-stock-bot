# 台股策略系統

目前系統已改為 Apps Script 雲端執行，GitHub Pages 只負責顯示結果。

## 目錄

```text
apps_script/
```

Google Apps Script 後端：
- 每 1 分鐘自動更新。
- 抓 TWSE MIS 即時報價。
- 抓 TWSE T86 法人買賣超。
- 抓 TWSE MI_MARGN 融資融券。
- 抓 Yahoo Finance 歷史線圖。
- 自動模擬買賣與當沖。
- 記錄扣除手續費與交易稅後的損益。

```text
web/
```

GitHub Pages 前端：
- 顯示總資產、報酬率、持倉、交易紀錄。
- 每 1 分鐘讀取 Apps Script 最新結果。
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
