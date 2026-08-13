# 台股每日自動買賣模擬

這個專案用固定規則模擬台股每日買賣，不會自動下單。  
前端部署在 GitHub Pages，資料與模擬邏輯由 Google Apps Script 在雲端定時執行。

## 網址

- 前端網站：https://wushinhuei.github.io/tw-stock-bot/
- Apps Script 專案：https://script.google.com/d/10V4wAflJ30eQBWCsfikj-4xPX5uKY0IgBIGeaDarqeUJoiMd5ob8O_9o/edit

## 架構

```text
Google Apps Script 每 1 分鐘執行
        ↓
抓 TWSE MIS 即時報價、TWSE 法人/資券、Yahoo 歷史線圖
        ↓
依大盤、族群、技術、動能、籌碼、風控規則評分
        ↓
模擬買進、賣出、當沖
        ↓
扣除手續費與交易稅後記錄損益
        ↓
GitHub Pages 前端讀取 Apps Script Web API
```

盤中網頁會每 1 分鐘直接呼叫 Apps Script `action=refresh`，主動重抓 TWSE MIS 報價；盤後則讀取已儲存的最新結果。

## 主要檔案

```text
index.html
```

GitHub Pages 根目錄入口，導向台股策略系統網頁。

```text
台股策略系統/web/
```

前端網站。包含畫面、樣式、Apps Script endpoint 設定與靜態備援資料。

```text
台股策略系統/apps_script/
```

Apps Script 後端。負責抓資料、計算訊號、模擬交易、儲存最新狀態。

```text
操作規則.md
```

股票選股、進出場、風控、籌碼與當沖規則。

## 資料來源

- TWSE MIS 即時報價
- TWSE T86 三大法人買賣超
- TWSE MI_MARGN 融資融券
- Yahoo Finance 歷史線圖

## 注意

本系統只做模擬與績效追蹤，不連券商 API、不真實下單、不保證獲利。
