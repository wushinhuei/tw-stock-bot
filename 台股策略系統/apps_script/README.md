# Apps Script

此資料夾是 Google Apps Script 後端原始碼。部署後提供前端使用的 JSON endpoint。

## 部署

1. 建立或開啟 Apps Script 專案。
2. 放入 `Code.gs` 與 `appsscript.json`。
3. 執行 `initSettings` 一次，建立策略設定分頁。
4. 建立 Web App deployment。
5. 將 Web App endpoint 填入 `web/apps_script_config.js`。

## actions

- `read`
- `refresh&force=1`
- `status`
- `settings`
- `initSettings`
- `reset`

