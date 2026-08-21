# 台股策略系統

本系統用於台股每日模擬交易觀察。前端是靜態網頁，後端資料由 Google Apps Script 提供；策略設定由 Google Sheet 管理。

## 前端

入口：

```text
web/index.html
```

常用動作：

- 讀取資料：`action=read`
- 強制刷新：`action=refresh&force=1`
- 快速狀態：`action=status`
- 讀策略設定：`action=settings`
- 初始化設定表：`action=initSettings`
- 重置模擬：`action=reset`

## 模擬原則

- 只模擬，不下單。
- A 級候選股才可考慮進場。
- 現金水位低於警戒時停止新增部位。
- 當日軟停損、硬停損、週停損皆優先於交易機會。
- 交易觸發時前端透過交易簽名變動自動刷新。

