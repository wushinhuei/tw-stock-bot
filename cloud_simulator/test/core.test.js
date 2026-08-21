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
