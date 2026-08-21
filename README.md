# 台股策略系統

這是依照交接包重建的台股每日自動買賣模擬系統。目前只做模擬與觀察，不連券商、不真實下單。

## 快速開始

直接開啟：

```text
台股策略系統/web/index.html
```

前端預設連到交接包提供的 Google Apps Script Web App endpoint。若 endpoint 暫時無法回應，畫面會使用本機備援資料並顯示狀態，不會停在更新中。

## 專案結構

```text
台股策略系統/
├─ README.md
├─ 發布檢查清單.md
├─ apps_script/
│  ├─ Code.gs
│  ├─ appsscript.json
│  └─ README.md
└─ web/
   ├─ index.html
   ├─ app.js
   ├─ styles.css
   ├─ apps_script_config.js
   ├─ actual_data.js
   └─ simulation_result.js
```

## 策略目標

- 初始資金：100,000 元。
- 月目標報酬：3% 到 5%。
- 觀察期：自 2026-08-20 起 30 個交易日。
- 原則：保本優先、沒條件不操作、以週績效檢討。

