window.PRECOMPUTED_SIMULATION = {
  "initialCapital": 100000,
  "cash": 80240.55249343831,
  "positions": [
    {
      "symbol": "2049",
      "name": "上銀",
      "shares": 26,
      "avgCost": 382,
      "totalCost": 9946,
      "stopPrice": 324.8,
      "targetPrice": 412.6
    },
    {
      "symbol": "2317",
      "name": "鴻海",
      "shares": 37,
      "avgCost": 264.5,
      "totalCost": 9800.5,
      "stopPrice": 247.6,
      "targetPrice": 285.7
    }
  ],
  "realizedPnl": -12.947506561679802,
  "totalFees": 50,
  "totalTaxes": 11,
  "trades": [
    {
      "date": "2026-08-10",
      "action": "買進",
      "symbol": "2049",
      "name": "上銀",
      "shares": 26,
      "price": 382,
      "grossAmount": 9932,
      "fee": 14,
      "tax": 0,
      "pnl": 0,
      "reason": "B 級共振，強制依規則買進；手續費 $14"
    },
    {
      "date": "2026-08-10",
      "action": "買進",
      "symbol": "2317",
      "name": "鴻海",
      "shares": 37,
      "price": 264.5,
      "grossAmount": 9786.5,
      "fee": 14,
      "tax": 0,
      "pnl": 0,
      "reason": "B 級共振，強制依規則買進；手續費 $14"
    },
    {
      "date": "2026-08-10",
      "action": "當沖",
      "symbol": "2049",
      "name": "上銀",
      "shares": 20,
      "price": 382,
      "grossAmount": 15300.052493438321,
      "fee": 22,
      "tax": 11,
      "pnl": -12.947506561679802,
      "reason": "符合魔王線放量與三快減，日內模擬平倉；買 379.5 / 賣 378.01"
    }
  ],
  "daily": [
    {
      "date": "2026-08-10",
      "equity": 99797.80249343831,
      "cash": 80240.55249343831,
      "positionValue": 19557.25,
      "dayPnl": -202.19750656168617,
      "marketLabel": "積極做多"
    }
  ],
  "dailyStopped": false,
  "weeklyLimited": false,
  "finalEquity": 99797.80249343831,
  "totalReturn": -0.0020219750656168545,
  "maxDrawdown": -0.0020219750656168545,
  "generatedAt": "2026-08-10T04:23:20.438Z",
  "source": {
    "provider": "Yahoo Finance chart API",
    "generatedAt": "2026-08-10T04:20:46.082Z",
    "startDate": "2026-08-10"
  }
};
