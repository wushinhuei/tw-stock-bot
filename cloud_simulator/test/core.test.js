'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CONFIG } = require('../src/config');
const { SimulationEngine, createAccount, maxEntryBudget, riskState } = require('../src/engine');
const { analyzeObv } = require('../src/indicators');
const { parseRss, scoreOfficialEvents, scoreTaiwanMedia, validateTaiwanMediaItem } = require('../src/news');
const { OrderManager } = require('../src/orders');
const { availableToBuy, buildSettlementLedger, settlementDate } = require('../src/settlement');
const { entryDecision, exitDecision } = require('../src/strategies');
const { gradeWithMedia, scoreCandidate } = require('../src/scoring');
const { MemoryRepository } = require('../src/repository');
const { buildUniverse } = require('../src/scanner');
const { adaptCandidatePayload } = require('../src/candidate_adapter');
const { runTick, tickDecision } = require('../src/main');
const { createDashboardServer } = require('../src/api');
const { closedDatesFromSchedule, rocCompactToYmd } = require('../src/trading_calendar');
const { createMonthlyArchive, previousTaipeiMonth } = require('../src/monthly_archive');
const { fetchQuotes } = require('../src/twse');
const { enrichCandidatesWithLiveScores } = require('../src/live_scoring');
const { aggregateBars, fetchChart, weeklyBars } = require('../src/yahoo');
const { executionRiskReasons, scoreChipSignals } = require('../src/chip');

function bars(count, start = 100) {
  return Array.from({ length: count }, (_, i) => ({
    open: start + i * 0.2, high: start + i * 0.2 + 1, low: start + i * 0.2 - 0.5,
    close: start + i * 0.2 + 0.5, volume: 1000 + i * 30
  }));
}

test('score totals 100 points at most and maps A/B/C thresholds', () => {
  const daily = bars(70);
  const result = scoreCandidate({
    strategy: 'SWING', dailyBars: daily, weeklyBars: bars(60), quoteFresh: true,
    chipScore: 1, fundamentalScore: 1, officialNewsScore: 1, liquidityScore: 1, spreadPct: 0.001
  });
  assert.ok(result.score <= 100);
  assert.equal(Object.values(result.components).reduce((a, b) => a + b, 0), result.score);
  assert.equal(result.grade, result.score >= CONFIG.scoreThresholds.A ? 'A' : 'B');
  assert.equal(require('../src/scoring').gradeFor(80, false), 'A');
  assert.equal(result.metrics.obv.bullish, true);
});

test('scanner uses only TWSE common stocks, top 50 and target industries', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    symbol: String(1000 + i), volume: 10000 - i, market: 'TWSE',
    securityType: i === 0 ? 'ETF' : 'COMMON_STOCK', group: i % 2 ? '半導體' : '金融'
  }));
  const result = buildUniverse(rows, {});
  assert.ok(result.length <= 30);
  assert.ok(result.every(row => row.market === 'TWSE' && row.securityType === 'COMMON_STOCK' && row.group === '半導體'));
  assert.ok(result.every(row => Number(row.symbol) < 1050));
});

test('TWSE MIS quotes bypass intermediary caches', async () => {
  let requestedUrl = '';
  let requestedOptions = null;
  const quotes = await fetchQuotes(['2330'], async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      async json() {
        return { msgArray: [{ c: '2330', n: '台積電', z: '1200', b: '1195_', a: '1200_', f: '5_', d: '20260825', t: '11:08:10' }] };
      }
    };
  });
  assert.match(requestedUrl, /[?&]_=[0-9]+/);
  assert.equal(requestedOptions.cache, 'no-store');
  assert.match(requestedOptions.headers['Cache-Control'], /no-cache/);
  assert.equal(requestedOptions.headers.Pragma, 'no-cache');
  assert.equal(quotes['2330'].timestamp, '2026-08-25T11:08:10+08:00');
});

test('Yahoo chart requests bypass caches and bar aggregation preserves OHLCV', async () => {
  let requestedUrl = '';
  let requestedOptions;
  const result = await fetchChart('2330.TW', '5d', '5m', async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return { ok: true, async json() { return { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }], error: null } }; } };
  });
  assert.ok(result);
  assert.match(requestedUrl, /[?&]_=[0-9]+/);
  assert.equal(requestedOptions.cache, 'no-store');
  const grouped = aggregateBars([
    { timestamp: '2026-08-25T01:00:00Z', open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { timestamp: '2026-08-25T01:05:00Z', open: 100, high: 103, low: 100, close: 102, volume: 20 }
  ], 15 * 60 * 1000);
  assert.deepEqual({ open: grouped[0].open, high: grouped[0].high, low: grouped[0].low, close: grouped[0].close, volume: grouped[0].volume },
    { open: 100, high: 103, low: 99, close: 102, volume: 30 });
});

test('Cloud live scoring computes OBV and blocks incomplete technical data', async () => {
  const candidate = {
    symbol: '2330', price: 120, bidPrice: 119.5, askPrice: 120, timestamp: '2026-08-25T11:00:00+08:00',
    strategy: 'SWING', chipOk: true, fundamentalOk: true,
    components: { chip: 15, fundamental: 10, officialNews: 8 }
  };
  const completeBars = { bars5m: bars(80), bars15m: bars(80), dailyBars: bars(100), weeklyBars: weeklyBars(bars(100).map((bar, i) => ({ ...bar, timestamp: new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString() }))), provider: 'test' };
  const [complete] = await enrichCandidatesWithLiveScores([candidate], { now: new Date('2026-08-25T03:01:00Z'), fetchBars: async () => completeBars });
  assert.equal(complete.dataStatus, 'COMPLETE');
  assert.equal(complete.scoringMethod, 'CLOUD_LIVE_V2');
  assert.equal(complete.metrics.obv.bullish, true);
  const [stale] = await enrichCandidatesWithLiveScores([{ ...candidate, timestamp: '2026-08-25T09:00:00+08:00' }], { now: new Date('2026-08-25T03:01:00Z'), fetchBars: async () => completeBars });
  assert.equal(stale.entryTier, 'NONE');
  assert.equal(stale.grade, 'BLOCKED');
  const [incomplete] = await enrichCandidatesWithLiveScores([candidate], { now: new Date('2026-08-25T03:01:00Z'), fetchBars: async () => ({ bars5m: [], bars15m: [], dailyBars: [], weeklyBars: [] }) });
  assert.equal(incomplete.grade, 'BLOCKED');
  assert.equal(incomplete.dataStatus, 'INCOMPLETE');
  assert.match(incomplete.blockedReasons.join(','), /OBV不足/);
});

test('Apps Script scenario adapter enforces top 50 and creates 100-point components', () => {
  const candidate = rank => ({
    symbol: String(2300 + rank), name: '測試股', group: '半導體', price: 100, bidPrice: 99.9, askPrice: 100,
    grade: 'A', dayTradeOk: false, overnightOk: false, industryOk: true, fundamentalOk: true,
    chipOk: true, trendOk: true, volumePriceOk: true, momentumOk: true,
    executionPlan: { spreadPct: 0.001 }, metrics: { volumeRank: rank, volumeRatio: 1.6, ma20: 95, ma50: 90, latestQuoteTime: '2026-08-21T03:52:00Z' }
  });
  const result = adaptCandidatePayload({ generatedAt: '2026-08-21T03:52:52Z', scenario: [{ date: '2026-08-21', candidates: [candidate(5), candidate(55)] }] }, { time: '11:52' });
  assert.equal(result.mode, 'APPS_SCRIPT_SCENARIO');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].metrics.volumeRank, 5);
  assert.equal(Object.values(result.candidates[0].components).reduce((a, b) => a + b, 0), result.candidates[0].score);
  assert.equal(result.candidates[0].strategy, 'SWING');
});

test('stale quote and official risk hard-block an otherwise strong candidate', () => {
  const result = scoreCandidate({
    strategy: 'SWING', dailyBars: bars(70), weeklyBars: bars(60), quoteFresh: false,
    chipScore: 1, fundamentalScore: 1, officialNewsScore: 1, liquidityScore: 1,
    officialRiskBlocked: true
  });
  assert.equal(result.grade, 'BLOCKED');
  assert.equal(result.blockedReasons.length, 2);
});

test('OBV confirms rising price and volume', () => {
  const signal = analyzeObv(bars(70), 42, 20);
  assert.equal(signal.aboveMa42, true);
  assert.equal(signal.rising, true);
  assert.equal(signal.bullish, true);
});

test('Investing RSS stores allowed metadata and deduplicating hash', () => {
  const xml = '<rss><channel><item><title>AI chips surge on cloud investment</title><description>Semiconductor demand rises.</description><link>https://example.test/a</link><pubDate>Thu, 20 Aug 2026 01:00:00 GMT</pubDate></item></channel></rss>';
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'Investing.com');
  assert.equal(items[0].advisoryOnly, true);
  assert.ok(items[0].relatedIndustries.includes('半導體'));
  assert.ok(items[0].hash.length === 64);
});

test('official future events do not leak into scoring and disposition blocks', () => {
  const now = new Date('2026-08-20T01:00:00Z');
  const result = scoreOfficialEvents([
    { publishedAt: '2026-08-20T02:00:00Z', impact: 'POSITIVE', title: 'future' },
    { publishedAt: '2026-08-20T00:00:00Z', type: 'DISPOSITION', title: '處置股票' }
  ], now);
  assert.equal(result.score, 0.5);
  assert.equal(result.blocked, true);
});

test('single Taiwan media report is advisory only and does not score', () => {
  const items = [{ source: '中央通訊社', acquisitionMethod: 'RSS', eventKey: 'evt-1', title: '公司接獲新訂單', url: 'https://example.test/1', publishedAt: '2026-08-21T01:00:00Z', sentiment: 'POSITIVE' }];
  const result = scoreTaiwanMedia(items, [], new Date('2026-08-21T02:00:00Z'));
  assert.equal(result.modifier, 0);
  assert.equal(result.evidence[0].scored, false);
});

test('two independent Taiwan media sources can add a capped verified modifier', () => {
  const common = { eventKey: 'evt-2', title: 'AI伺服器訂單成長', publishedAt: '2026-08-21T01:00:00Z', sentiment: 'POSITIVE', impact: 'HIGH' };
  const items = [
    { ...common, source: '中央通訊社', acquisitionMethod: 'RSS', url: 'https://example.test/cna' },
    { ...common, source: 'DIGITIMES', acquisitionMethod: 'MANUAL', url: 'https://example.test/dt' }
  ];
  const result = scoreTaiwanMedia(items, [], new Date('2026-08-21T02:00:00Z'));
  assert.ok(result.modifier > 0 && result.modifier <= 3);
  assert.equal(result.evidence[0].scored, true);
});

test('unlicensed automated media collection is rejected', () => {
  const result = validateTaiwanMediaItem({ source: '經濟日報', acquisitionMethod: 'SCRAPE', eventKey: 'x', title: 'x', url: 'https://example.test', publishedAt: '2026-08-21T01:00:00Z' });
  assert.equal(result.accepted, false);
});

test('media points alone cannot promote a B candidate to A', () => {
  assert.equal(gradeWithMedia(81, 79, false), 'B');
  assert.equal(gradeWithMedia(81, 80, false), 'A');
  const daily = bars(70);
  const common = { eventKey: 'evt-3', title: '供應鏈正面消息', publishedAt: '2026-08-21T01:00:00Z', sentiment: 'POSITIVE', impact: 'HIGH' };
  const result = scoreCandidate({
    strategy: 'SWING', dailyBars: daily, weeklyBars: bars(60), quoteFresh: true,
    chipScore: 0.8, fundamentalScore: 0.8, officialNewsScore: 0.6, liquidityScore: 1, spreadPct: 0.001,
    scoringTime: '2026-08-21T02:00:00Z', taiwanMediaItems: [
      { ...common, source: '中央通訊社', acquisitionMethod: 'RSS', url: 'https://example.test/cna' },
      { ...common, source: 'DIGITIMES', acquisitionMethod: 'MANUAL', url: 'https://example.test/dt' }
    ]
  });
  assert.equal(result.grade, 'B');
});

test('replacement order is impossible before cancel acknowledgement', () => {
  const manager = new OrderManager(CONFIG);
  const order = manager.create({ tradeDate: '2026-08-20', strategy: 'SWING', symbol: '2330', side: 'BUY', quantity: 5, price: 100, signalTimestamp: 't1' });
  assert.throws(() => manager.replacement(order, 101, 't2'));
  const pending = manager.requestCancel(order, 'price moved');
  const cancelled = manager.confirmCancel(pending);
  const replacement = manager.replacement(cancelled, 101, 't2');
  assert.equal(replacement.quantity, 5);
  assert.equal(replacement.repriceCount, 1);
});

test('conservative matching waits for a later quote and supports partial fills', () => {
  const manager = new OrderManager(CONFIG);
  const order = manager.create({ tradeDate: '2026-08-20', strategy: 'SWING', symbol: '2330', side: 'BUY', quantity: 5, price: 101, signalTimestamp: 't1', createdAt: '2026-08-20T01:00:00Z' });
  const sameTime = manager.match(order, { timestamp: '2026-08-20T01:00:00Z', askPrice: 100, availableQuantity: 5 });
  assert.equal(sameTime.filledQuantity, 0);
  const partial = manager.match(order, { timestamp: '2026-08-20T01:00:05Z', askPrice: 100, availableQuantity: 2 });
  assert.equal(partial.status, 'PARTIAL');
  assert.equal(partial.filledQuantity, 2);
});

test('T+2 skips weekends and ledger does not count open orders', () => {
  assert.equal(settlementDate('2026-08-21', new Set()), '2026-08-25');
  const ledger = buildSettlementLedger([
    { tradeDate: '2026-08-21', side: 'BUY', status: 'FILLED', filledQuantity: 10, averagePrice: 100, fee: 1, tax: 0 },
    { tradeDate: '2026-08-21', side: 'SELL', status: 'OPEN', filledQuantity: 10, averagePrice: 110, fee: 1, tax: 3 }
  ]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].buyPayable, 1001);
  assert.equal(ledger[0].sellReceivable, 0);
});

test('40% cash reserve and settlement reserve constrain entry budget', () => {
  const account = createAccount(100000);
  account.bankCash = 45000;
  account.cash = 45000;
  account.equity = 100000;
  assert.equal(maxEntryBudget(account, 'SWING', CONFIG), 5000);
  account.settlements = [{ date: '2026-08-25', netPayable: 5000 }];
  assert.equal(availableToBuy(account, CONFIG), 35000);
});

test('daily -2% and weekly -5% stop new risk', () => {
  const account = createAccount(100000);
  account.equity = 94900;
  account.dayStartEquity = 97000;
  account.weekStartEquity = 100000;
  const state = riskState(account, CONFIG);
  assert.equal(state.dailyStopped, true);
  assert.equal(state.weeklyStopped, true);
  assert.equal(state.allowNewRisk, false);
});

test('strategy windows and exits enforce day trade and overnight rules', () => {
  const candidate = { grade: 'A', blockedReasons: [], closeNearHigh: true, intradayReturnPct: 0.02, volumeRatio: 1.2 };
  assert.equal(entryDecision(candidate, 'OVERNIGHT', { time: '13:10', marketMode: 'NORMAL' }, CONFIG).allowed, true);
  assert.equal(entryDecision(candidate, 'OVERNIGHT', { time: '12:50', marketMode: 'NORMAL' }, CONFIG).allowed, false);
  assert.equal(exitDecision({ strategy: 'DAY_TRADE', averagePrice: 100 }, { bidPrice: 98.9 }, { time: '10:00' }, CONFIG).emergency, true);
  assert.equal(exitDecision({ strategy: 'OVERNIGHT', averagePrice: 100, previousClose: 99, holdingDays: 1 }, { bidPrice: 103 }, { time: '10:00' }, CONFIG).exit, true);
});

test('engine ignores duplicate entry signal and preserves one active order', () => {
  const engine = new SimulationEngine({ config: CONFIG, repository: new MemoryRepository(), account: createAccount(100000) });
  const candidate = { symbol: '2330', grade: 'A', score: 90, strategy: 'SWING', blockedReasons: [] };
  const context = { date: '2026-08-20', time: '10:00', signalTimestamp: 'same', marketMode: 'NORMAL' };
  engine.processCandidates([candidate], context);
  engine.processCandidates([candidate], context);
  assert.equal(engine.account.orders.length, 1);
});

test('after-market refresh cannot duplicate the same order', () => {
  const engine = new SimulationEngine({ repository: new MemoryRepository() });
  const candidate = { symbol: '2330', strategy: 'SWING', grade: 'A', score: 90, price: 100, askPrice: 100, blockedReasons: [] };
  const context = { date: '2026-08-21', time: '13:25', signalTimestamp: '2026-08-21T05:25:00.000Z', marketMode: 'NORMAL' };
  engine.processCandidates([candidate], context);
  engine.processCandidates([candidate], context);
  assert.equal(engine.account.orders.length, 1);
});

test('profitable OBV-confirmed swing position permits only one 5% add-on', () => {
  const engine = new SimulationEngine({ repository: new MemoryRepository() });
  engine.account.positions.push({ symbol: '2330', strategy: 'SWING', quantity: 50, averagePrice: 100, lastEntryPrice: 100, marketValue: 5100, addOnCount: 0 });
  const candidate = { symbol: '2330', strategy: 'SWING', grade: 'A', score: 90, price: 103, askPrice: 103, blockedReasons: [], metrics: { obv: { bullish: true } } };
  const context = { date: '2026-08-21', time: '10:00', signalTimestamp: '2026-08-21T02:00:00.000Z', marketMode: 'NORMAL' };
  engine.processCandidates([candidate], context);
  engine.processCandidates([candidate], { ...context, signalTimestamp: '2026-08-21T02:01:00.000Z' });
  assert.equal(engine.account.orders.length, 1);
  assert.match(engine.account.orders[0].reason, /一次策略加碼/);
});

test('chip score uses institutional, margin, securities lending and day-trade heat within 15 points', () => {
  const healthy = scoreChipSignals({
    institutional: { totalNet: 100000, foreignNet: 80000, trustNet: 10000 }, institutionalNetRatio: 0.04,
    margin: { marginToday: 900 }, marginChangeRatio: -0.02,
    shortLending: { todayBalance: 800 }, securitiesLendingChangeRatio: -0.01,
    dayTradeRatio: 0.30
  });
  const crowded = scoreChipSignals({
    institutional: { totalNet: -100000, foreignNet: -80000, trustNet: 0 }, institutionalNetRatio: -0.04,
    margin: { marginToday: 1200 }, marginChangeRatio: 0.08,
    shortLending: { todayBalance: 1300 }, securitiesLendingChangeRatio: 0.12,
    dayTradeRatio: 0.65
  });
  assert.equal(healthy.score, 15);
  assert.ok(crowded.score < healthy.score);
  assert.equal(Object.values(healthy.details).reduce((sum, value) => sum + value, 0), 15);
  assert.equal(scoreChipSignals({ margin: { marginToday: 100 }, marginChangeRatio: null }).details.dayTradePoints, 2);
});

test('official notice reason and excessive day-trade heat become execution blockers', () => {
  const reasons = executionRiskReasons({
    strategy: 'DAY_TRADE', dayTradeEligible: false, noticeActive: true,
    noticeReason: '最近六日當沖比率異常', chipSignals: { dayTradeRatio: 0.61 }
  });
  assert.match(reasons.join(','), /注意股票.*當沖比率異常/);
  assert.match(reasons.join(','), /非當日沖銷標的/);
  assert.match(reasons.join(','), /超過60%/);
});

test('detailed chip weakness lowers score and notice blocks otherwise tradable candidate', () => {
  const result = scoreCandidate({
    strategy: 'SWING', dailyBars: bars(70), weeklyBars: bars(60), quoteFresh: true,
    chipScore: 1, fundamentalScore: 1, officialNewsScore: 1, liquidityScore: 1, spreadPct: 0.001,
    chipSignals: {
      institutional: { totalNet: -1000, foreignNet: -1000 }, marginChangeRatio: 0.08,
      securitiesLendingChangeRatio: 0.12, dayTradeRatio: 0.61, noticeActive: true,
      noticeReason: '週轉率與當沖比率異常'
    }
  });
  assert.ok(result.components.chip <= 2);
  assert.equal(result.grade, 'BLOCKED');
  assert.match(result.blockedReasons.join(','), /注意股票/);
});

test('75-79 point complete candidate uses at most a 5% trial entry', () => {
  const engine = new SimulationEngine({ config: CONFIG, repository: new MemoryRepository(), account: createAccount(100000) });
  const candidate = {
    symbol: '2330', grade: 'B', score: 77, strategy: 'SWING', price: 100, askPrice: 100,
    dataStatus: 'COMPLETE', blockedReasons: [], components: { technical: 25, volumeObv: 10 }
  };
  engine.processCandidates([candidate], { date: '2026-08-25', time: '10:00', signalTimestamp: 'trial-1', marketMode: 'NORMAL' });
  assert.equal(engine.account.orders.length, 1);
  assert.ok(engine.account.orders[0].quantity * engine.account.orders[0].price <= 5000);
  assert.match(engine.account.orders[0].reason, /小額試單/);
});

test('short tick accepts only weekdays from 08:50 through 13:20 Taipei time', () => {
  assert.equal(tickDecision(new Date('2026-08-21T00:49:00Z')).allowed, false);
  assert.equal(tickDecision(new Date('2026-08-21T00:50:00Z')).allowed, true);
  assert.equal(tickDecision(new Date('2026-08-21T05:20:00Z')).allowed, true);
  assert.equal(tickDecision(new Date('2026-08-21T05:21:00Z')).allowed, false);
  assert.equal(tickDecision(new Date('2026-08-22T02:00:00Z')).reason, 'NON_TRADING_DAY');
});

test('out-of-window tick exits without reading or writing repository', async () => {
  const repository = {
    loadState() { throw new Error('must not load'); },
    saveState() { throw new Error('must not save'); }
  };
  const result = await runTick({ now: new Date('2026-08-21T00:40:00Z'), repository });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'OUTSIDE_SESSION');
});

test('TWSE holiday schedule excludes closed dates but keeps start and last trading days', () => {
  const closed = closedDatesFromSchedule([
    { Name: '國曆新年開始交易日', Date: '1150102' },
    { Name: '農曆春節前最後交易日', Date: '1150211' },
    { Name: '市場無交易，僅辦理結算交割作業', Date: '1150212' },
    { Name: '和平紀念日', Date: '1150227' }
  ]);
  assert.equal(rocCompactToYmd('1150212'), '2026-02-12');
  assert.equal(closed.has('2026-01-02'), false);
  assert.equal(closed.has('2026-02-11'), false);
  assert.equal(closed.has('2026-02-12'), true);
  assert.equal(closed.has('2026-02-27'), true);
});

test('scheduled tick exits before repository access on a TWSE closed weekday', async () => {
  let restored = false;
  const result = await runTick({
    now: new Date('2026-02-12T01:10:00Z'),
    isTradingDay: async () => false,
    repository: { loadState: async () => { restored = true; return null; } }
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'TWSE_MARKET_CLOSED');
  assert.equal(restored, false);
});

test('monthly archive selects previous Taipei month and writes one gzip object', async () => {
  assert.equal(previousTaipeiMonth(new Date('2026-08-01T00:30:00Z')), '2026-07');
  const saved = [];
  const bucket = {
    async getFiles({ prefix }) {
      assert.equal(prefix, 'raw/2026-07-');
      return [[
        { name: 'raw/2026-07-02/b.json', download: async () => [Buffer.from('{"b":2}')] },
        { name: 'raw/2026-07-01/a.json', download: async () => [Buffer.from('{"a":1}')] }
      ]];
    },
    file(name) {
      return { save: async (body, options) => saved.push({ name, body, options }) };
    }
  };
  const result = await createMonthlyArchive({ bucket, month: '2026-07' });
  assert.equal(result.count, 2);
  assert.equal(result.destination, 'monthly/2026-07.jsonl.gz');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].options.metadata.metadata.snapshotCount, '2');
  assert.ok(saved[0].body.length > 0);
});

test('dashboard API exposes only read-only dashboard and health routes', async t => {
  const server = createDashboardServer({
    readDashboard: async () => ({ ok: true, source: 'test', scenario: [], simulation: {} })
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const dashboard = await fetch(`http://127.0.0.1:${port}/dashboard`);
  assert.equal(dashboard.status, 200);
  assert.equal((await dashboard.json()).source, 'test');
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/raw/quotes`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/dashboard`, { method: 'POST' })).status, 405);
});

test('dashboard API returns 503 until first cloud dashboard is available', async t => {
  const server = createDashboardServer({ readDashboard: async () => { throw new Error('missing'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/dashboard`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'DASHBOARD_NOT_READY');
});
