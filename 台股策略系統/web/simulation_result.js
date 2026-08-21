window.TW_STOCK_SIMULATION_RESULT = {
  asOf: "2026-08-20T14:05:00+08:00",
  equity: 100620,
  cash: 75420,
  initialCapital: 100000,
  dailyPnl: 620,
  dailyReturnPct: 0.0062,
  monthlyTargetMinPct: 0.03,
  monthlyTargetMaxPct: 0.05,
  tradeSignature: "fallback-20260820-001",
  risk: {
    cashReservePct: 0.7495,
    status: "normal",
    message: "現金水位充足，可等待 A 級訊號。"
  },
  positions: [
    { symbol: "2330", name: "台積電", shares: 20, avgPrice: 1170, lastPrice: 1180, pnl: 200, pnlPct: 0.0085, plan: "達日內獲利鎖定時分批出場" }
  ],
  trades: [
    { time: "2026-08-20 09:42", action: "BUY", symbol: "2330", name: "台積電", shares: 20, price: 1170, note: "A 級訊號，小部位測試" },
    { time: "2026-08-20 13:28", action: "HOLD", symbol: "2330", name: "台積電", shares: 20, price: 1180, note: "未達出場條件，保留觀察" }
  ],
  reports: {
    weekly: "週檢討尚未完成，需累積交易日。",
    thirtyDay: "30 日觀察期自 2026-08-20 起算。"
  }
};

