# 台股極短線自動分析系統 + Line Bot 智慧風控助手

專為台股當沖與極短線操作設計的自動化分析系統與 Line 機器人，特點如下：
1. **扣費淨純利算計**：自動帶入券商雙向手續費折扣（如6折、2.8折）與當沖證交稅減半，計算淨保本價與淨報酬目標。
2. **極短線風控警報**：盤中秒級監控分時 VWAP 均價線與 -1.5% ~ -2% 停損線，即時發送 Line 緊急平倉卡片。
3. **Web Dashboard & Line Flex Message**：提供現代化網頁儀表板與 Line 互動卡片。

## 目錄結構
```
tw-stock-bot/
├── backend/
│   ├── app.py                  # FastAPI 主伺服器
│   ├── fee_calculator.py       # 雙向手續費與淨保本價算計模組
│   ├── analytics_engine.py     # 短線/當沖量價與 VWAP 診斷引擎
│   └── line_bot_handler.py     # Line Flex Message JSON 產生器
├── frontend/
│   └── index.html              # Web Dashboard 與 Line 模擬器
└── requirements.txt            # Python 依賴
```

## 快速啟動方法

1. **安裝依賴**
   ```bash
   pip install -r requirements.txt
   ```

2. **啟動後端 API 伺服器**
   ```bash
   python backend/app.py
   ```

3. **開啟前端 Web Dashboard**
   在瀏覽器中直接開啟 `frontend/index.html` 即可瀏覽極短線診斷儀表板、純利試算器與 Line 卡片模擬。
