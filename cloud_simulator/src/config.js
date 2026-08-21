'use strict';

const CONFIG = Object.freeze({
  timezone: 'Asia/Taipei',
  initialCapital: 100000,
  topVolumeLimit: 50,
  maxCandidates: 30,
  marketPollMs: 5000,
  rssPollMs: 15 * 60 * 1000,
  sessionStart: '08:20',
  tradingStart: '09:10',
  dayTradeEntryCutoff: '12:30',
  overnightEntryStart: '13:00',
  forcedExitStart: '13:20',
  marketClose: '13:30',
  sessionEnd: '13:35',
  strategyCaps: Object.freeze({ SWING: 0.30, OVERNIGHT: 0.15, DAY_TRADE: 0.15 }),
  minCashReservePct: 0.40,
  dailyNewCapitalPct: 0.20,
  dailyTurnoverPct: 0.40,
  firstEntryPct: 0.10,
  addOnPct: 0.05,
  maxSymbolPct: 0.15,
  settlementReservePct: 0.05,
  settlementReserveMin: 5000,
  dailyStopPct: -0.02,
  weeklyStopPct: -0.05,
  brokerFeeRate: 0.001425,
  minBrokerFee: 1,
  sellTaxRate: 0.003,
  dayTradeTaxRate: 0.0015,
  maxReprices: 3,
  maxChasePct: 0.003,
  maxSpreadPct: 0.006,
  scoreThresholds: Object.freeze({ A: 80, B: 65, C: 50 }),
  investingRssUrls: Object.freeze([
    'https://www.investing.com/rss/news_25.rss',
    'https://www.investing.com/rss/news_11.rss',
    'https://www.investing.com/rss/news_95.rss',
    'https://www.investing.com/rss/news_14.rss'
  ]),
  taiwanMediaRss: Object.freeze([
    Object.freeze({ source: '中央通訊社', url: 'https://feeds.feedburner.com/rsscna/finance', acquisitionMethod: 'RSS' })
  ])
});

module.exports = { CONFIG };
