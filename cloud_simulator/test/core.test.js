'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const { buildUniverse, candidateSelectionScore } = require('../src/scanner');
const { adaptCandidatePayload } = require('../src/candidate_adapter');
const { candidateSourceUrl, runTick, tickDecision } = require('../src/main');
const { createDashboardServer } = require('../src/api');
const { closedDatesFromSchedule, rocCompactToYmd } = require('../src/trading_calendar');
const { createMonthlyArchive, previousTaipeiMonth } = require('../src/monthly_archive');
const { fetchQuotes } = require('../src/twse');
const { driveChipSignals, enrichCandidatesWithLiveScores, fetchDriveTechnicalBars } = require('../src/live_scoring');
const { aggregateBars, chartBars, chartEvents, fetchChart, fetchSupplementalHistory, weeklyBars } = require('../src/yahoo');
const { compareDailyBars, isRecent, mapLimited } = require('../scripts/download_yahoo_supplement');
const { executionRiskReasons, scoreChipSignals } = require('../src/chip');
const { economicCash, markToMarket, positionMarketValue } = require('../../台股策略系統/web/accounting');
const { DRIVE_DATASETS, MOPS_ROLLING, DriveHistorySource, parseCsv, parseJsonl } = require('../src/drive_history');
const { fee, technicalProxy } = require('../src/drive_backtest');
const { archiveEntryIdentity, attachFilingTimes, MopsClient, parseHtmlTables, parseXbrlInstance,
  rowsFromTable, toCsv, validateMopsCompleteness, validateOfficialBatch, xbrlArchiveUrl } = require('../src/mops_history');
const { parse0050, parseTaiex, rocDate, validateBenchmarks } = require('../src/benchmark_history');
const { adjustBars, buildCumulativeFactors, parseCorporateActions } = require('../src/corporate_actions');
const { repairZeroPriceSellState } = require('../src/state_repair');

function bars(count, start = 100) {
  return Array.from({ length: count }, (_, i) => ({
    open: start + i * 0.2, high: start + i * 0.2 + 1, low: start + i * 0.2 - 0.5,
    close: start + i * 0.2 + 0.5, volume: 1000 + i * 30
  }));
}

test('TWSE benchmark parser normalizes 0050 and TAIEX official monthly rows', () => {
  assert.equal(rocDate('114/08/25'), '2025-08-25');
  const etf = parse0050({ stat: 'OK', fields: ['日期', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '成交筆數'], data: [['114/08/25', '1,000', '50,000', '50', '51', '49', '50.5', '100']] });
  const index = parseTaiex({ stat: 'OK', fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'], data: [['114/08/25', '20,000', '20,100', '19,900', '20,050']] });
  assert.deepEqual([etf[0].benchmark_id, index[0].benchmark_id], ['0050', 'TAIEX']);
  assert.equal(etf[0].volume, 1000);
  assert.equal(index[0].close, 20050);
  assert.equal(validateBenchmarks([...etf, ...index], '2025-08-25', '2025-08-25').passed, false);
});

test('corporate actions create point-in-time adjustment factors without changing post-event bars', () => {
  const actions = parseCorporateActions({ stat: 'OK', fields: ['資料日期', '股票代號', '股票名稱', '除權息前收盤價', '除權息參考價', '權值+息值', '權/息', '漲停價格', '跌停價格', '開盤競價基準', '減除股利參考價', '詳細資料'], data: [['114年08月01日', '0050', '元大台灣50', '200', '196', '4', '息', '215', '176', '196', '196', '0050,20250801']] });
  assert.equal(actions[0].adjustment_factor, 0.98);
  assert.equal(buildCumulativeFactors(actions)[0].cumulative_factor_before_date, 0.98);
  const adjusted = adjustBars([
    { symbol: '0050', tradeDate: '2025-07-31', open: 200, high: 201, low: 199, close: 200, volume: 980 },
    { symbol: '0050', tradeDate: '2025-08-01', open: 196, high: 197, low: 195, close: 196, volume: 1000 }
  ], actions);
  assert.equal(adjusted[0].adjustedClose, 196);
  assert.equal(adjusted[1].adjustedClose, 196);
});

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

test('scanner selects final 30 from volume top 50 using 50% chip weight across industries', () => {
  assert.equal(CONFIG.topVolumeLimit, 30);
  assert.equal(CONFIG.candidateSelectionPoolLimit, 50);
  assert.deepEqual(CONFIG.candidateSelectionWeights, { chip: 0.50, volume: 0.30, momentum: 0.20 });
  const rows = Array.from({ length: 60 }, (_, i) => ({
    symbol: String(1000 + i), volume: 10000 - i, market: 'TWSE',
    securityType: i === 0 ? 'ETF' : 'COMMON_STOCK', group: i % 2 ? '半導體' : '金融'
  }));
  const enrichment = Object.fromEntries(rows.map(row => [row.symbol, { chipOk: false, changePct: 0 }]));
  enrichment['1040'] = { chipOk: true, changePct: 0.05 };
  const result = buildUniverse(rows, enrichment);
  assert.equal(result.length, 30);
  assert.ok(result.every(row => row.market === 'TWSE' && row.securityType === 'COMMON_STOCK'));
  assert.ok(result.some(row => row.group === '金融'));
  assert.ok(result.some(row => row.group === '半導體'));
  assert.ok(result.some(row => row.symbol === '1040'));
  assert.ok(result.every(row => row.volumeRank <= 50));
  assert.ok(result.every(row => row.symbol !== '1051'));
  const score = candidateSelectionScore({ chipOk: true, changePct: 0.05 }, 1, 50);
  assert.deepEqual(score, { total: 100, chip: 50, volume: 30, momentum: 20 });
});

test('Apps Script volume universe rejects ETF codes before candidate weighting', () => {
  const source = fs.readFileSync('台股策略系統/apps_script/Code.gs', 'utf8');
  const api = new Function(source + '; return { isListedCommonStockCode };')();
  assert.equal(api.isListedCommonStockCode('0050'), false);
  assert.equal(api.isListedCommonStockCode('0056'), false);
  assert.equal(api.isListedCommonStockCode('2330'), true);
  assert.equal(api.isListedCommonStockCode('6770'), true);
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

test('TWSE MIS blank quote fields remain missing instead of becoming zero', async () => {
  const quotes = await fetchQuotes(['3037'], async () => ({
    ok: true,
    json: async () => ({ msgArray: [{
      c: '3037', n: '欣興', z: '-', a: '-', b: '', y: '-', f: '78_', d: '20260831', t: '09:14:52'
    }] })
  }));
  assert.equal(quotes['3037'].price, null);
  assert.equal(quotes['3037'].bidPrice, null);
  assert.equal(quotes['3037'].askPrice, null);
  assert.equal(quotes['3037'].availableQuantity, 78000);
});

test('Apps Script candidate source always requests a forced fresh daily scan', () => {
  const url = new URL(candidateSourceUrl('https://script.google.com/macros/s/example/exec'));
  assert.equal(url.searchParams.get('action'), 'refresh');
  assert.equal(url.searchParams.get('force'), '1');
  assert.ok(url.searchParams.get('_'));
  assert.equal(candidateSourceUrl('https://example.test/candidates.json'), 'https://example.test/candidates.json');
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

test('Yahoo supplement preserves adjusted close and reports official date and price differences', async () => {
  const parsed = chartBars({ timestamp: [1787587200], indicators: { quote: [{ open: [100], high: [102], low: [99], close: [101], volume: [1000] }], adjclose: [{ adjclose: [98.5] }] } });
  assert.equal(parsed[0].adjustedClose, 98.5);
  const missingAdjusted = chartBars({ timestamp: [1787587200], indicators: { quote: [{ open: [100], high: [102], low: [99], close: [101], volume: [1000] }], adjclose: [{ adjclose: [null] }] } });
  assert.equal(missingAdjusted[0].adjustedClose, null);
  assert.equal(chartEvents({ events: { dividends: { a: { date: 1787587200, amount: 2 } } } })[0].type, 'DIVIDEND');
  const result = compareDailyBars([
    { tradeDate: '2026-08-24', close: 100, volume: 1000 }, { tradeDate: '2026-08-25', close: 102, volume: 1000 }
  ], [
    { timestamp: '2026-08-24T00:00:00.000Z', close: 101, volume: 700 }, { timestamp: '2026-08-26T00:00:00.000Z', close: 103, volume: 1000 }
  ]);
  assert.deepEqual(result.missingDates, ['2026-08-25']);
  assert.deepEqual(result.extraDates, ['2026-08-26']);
  assert.equal(result.priceDifferences.length, 1);
  assert.equal(result.volumeDifferences.length, 1);
  assert.equal(result.passed, false);
});

test('Yahoo supplement fetches five-year daily and sixty-day intraday without becoming an execution quote', async () => {
  const calls = [];
  const payload = await fetchSupplementalHistory('2330', { attempts: 1, baseDelayMs: 0, fetchImpl: async url => {
    calls.push(url);
    return { ok: true, async json() { return { chart: { error: null, result: [{ timestamp: [1787587200], indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100], volume: [10] }] } }] } }; } };
  } });
  assert.equal(calls.length, 2);
  assert.ok(calls.some(url => /range=5y&interval=1d/.test(url)));
  assert.ok(calls.some(url => /range=60d&interval=5m/.test(url)));
  assert.equal(payload.provider, 'Yahoo Finance Chart API');
  assert.equal(payload.bars15m.length, 1);
  assert.equal(Object.hasOwn(payload, 'bid'), false);
});

test('Yahoo supplement helpers enforce bounded concurrency and stale timestamps', async () => {
  let active = 0;
  let maximum = 0;
  const rows = await mapLimited(['1', '2', '3'], 2, async symbol => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return symbol;
  });
  assert.deepEqual(rows, ['1', '2', '3']);
  assert.equal(maximum, 2);
  assert.equal(isRecent('2026-08-25T00:00:00Z', 10, new Date('2026-08-30T00:00:00Z')), true);
  assert.equal(isRecent('2026-08-01T00:00:00Z', 10, new Date('2026-08-30T00:00:00Z')), false);
});

test('Drive history uses fixed TOP50 and STOCK_DAILY files and rejects missing prices', async () => {
  assert.equal(DRIVE_DATASETS.top50.manifestId, '1_dUjbK480Mng6ABditIRUAtou1S9XP6m');
  assert.equal(DRIVE_DATASETS.stockDaily.manifestId, '1_0NnEjwCRkoguD9OowRnp7mQ8rovneKx');
  const files = {
    manifestTop: JSON.stringify({ last_update: { status: 'backfill_complete', error: null } }),
    manifestDaily: JSON.stringify({ last_update: { status: 'update_complete', error: null } }),
    top: 'trade_date,rank,stock_code,stock_name\n2026-08-25,1,2330,台積電',
    daily: 'trade_date,stock_code,stock_name,open,high,low,close,trade_volume,trade_value,transactions,top50_rank,is_top50\n2026-08-24,2330,台積電,100,103,99,102,10,1020,2,,0\n2026-08-25,2330,台積電,,,,,0,0,0,1,1'
  };
  const source = new DriveHistorySource({
    datasets: {
      top50: { manifestId: 'manifestTop', files: { 2026: 'top' } },
      stockDaily: { manifestId: 'manifestDaily', files: { 2026: 'daily' } }
    },
    fetchText: async id => files[id]
  });
  assert.equal((await source.top50Rows('2026-08-25', '2026-08-25'))[0].stock_code, '2330');
  const daily = await source.dailyBars('2330', '2026-08-24', '2026-08-25');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].close, 102);
  assert.equal(daily[0].isTop50, false);
  assert.equal(parseCsv('a,b\n"x,y",z')[0].a, 'x,y');
});

test('Drive history exposes corporate actions and adjusted daily prices', async () => {
  const files = {
    dailyManifest: JSON.stringify({ last_update: { status: 'complete', error: null } }),
    actionManifest: JSON.stringify({ last_update: { status: 'complete', error: null } }),
    daily: 'trade_date,stock_code,stock_name,open,high,low,close,trade_volume,trade_value,transactions,top50_rank,is_top50\n2025-07-31,0050,元大台灣50,200,201,199,200,980,196000,10,,0\n2025-08-01,0050,元大台灣50,196,197,195,196,1000,196000,10,,0',
    actions: 'action_date,stock_code,stock_name,action_type,adjustment_factor\n2025-08-01,0050,元大台灣50,息,0.98'
  };
  const source = new DriveHistorySource({ datasets: {
    stockDaily: { manifestId: 'dailyManifest', files: { 2025: 'daily' } },
    corporateActions: { manifestId: 'actionManifest', files: { all: 'actions' } }
  }, fetchText: async id => files[id] });
  const adjusted = await source.adjustedDailyBars('0050', '2025-07-31', '2025-08-01');
  assert.equal(adjusted[0].adjustedClose, 196);
  assert.equal(adjusted[1].adjustedClose, 196);
});

test('Drive analysis requires aligned market flow and complete MOPS data', async () => {
  assert.equal(DRIVE_DATASETS.marketFlow.manifestId, '1euGZK6A2YzyQKrZehk7qvTLhOP83uOVm');
  assert.equal(MOPS_ROLLING.manifestId, '1Sl5pzvt3SjaHQF7gvjZDZsVMTSbf1PiD');
  const complete = date => JSON.stringify({ latest_successful_trade_date: date, total_rows: 50, stock_count: 2,
    last_update: { status: 'update_complete', error: null }, top50_alignment: { aligned: true }, source_status: {} });
  const files = {
    top: complete('2026-08-27'), dailyManifest: complete('2026-08-27'), flowManifest: complete('2026-08-27'),
    mopsManifest: JSON.stringify({ status: 'complete', warnings: [], generated_at: '2026-08-27T16:32:58Z', symbol_count: 2, results: {} }),
    revenue: '{"stock_code":"2330","year":2026,"month":7}\n'
  };
  const source = new DriveHistorySource({ datasets: {
    top50: { manifestId: 'top', files: {} }, stockDaily: { manifestId: 'dailyManifest', files: {} },
    marketFlow: { manifestId: 'flowManifest', files: {} }
  }, fetchText: async id => id === MOPS_ROLLING.manifestId ? files.mopsManifest : files[id],
  findFile: async (_folder, name) => name === 'monthly_revenue_2026.jsonl' ? 'revenue' : 'missing' });
  assert.equal((await source.analysisStatus()).tradeDate, '2026-08-27');
  assert.equal((await source.mopsRows('monthlyRevenue', 2026))[0].stock_code, '2330');
  assert.equal(parseJsonl('{"a":1}\n')[0].a, 1);

  files.flowManifest = complete('2026-08-26');
  const stale = new DriveHistorySource({ datasets: source.datasets,
    fetchText: async id => id === MOPS_ROLLING.manifestId ? files.mopsManifest : files[id] });
  await assert.rejects(() => stale.analysisStatus(), /not aligned/);
});

test('Drive backtest proxy requires warmup and includes fees', () => {
  assert.equal(technicalProxy([]), null);
  const bars = Array.from({ length: 70 }, (_, index) => ({
    open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index,
    volume: 1000 + index * 100
  }));
  const result = technicalProxy(bars);
  assert.ok(result.score >= 75);
  assert.ok(result.volumeObv > 0);
  assert.equal(fee(1000), 1);
});

test('MOPS history parser keeps announcement time and raw fields', async () => {
  const html = '<table><tr><th>公司代號</th><th>公司名稱</th><th>發言日期</th><th>發言時間</th><th>主旨</th></tr><tr><td>2330</td><td>台積電</td><td>115/08/25</td><td>17:30:00</td><td>重大訊息</td></tr></table>';
  assert.equal(rowsFromTable(parseHtmlTables(html)[0])[0]['公司代號'], '2330');
  const client = new MopsClient({ delayMs: 0, fetchImpl: async () => ({ ok: true, text: async () => html }) });
  const rows = await client.query('majorMessages', 2026, null);
  assert.equal(rows[0].stock_code, '2330');
  assert.equal(rows[0].available_from, '115/08/25 17:30:00');
  assert.match(toCsv(rows), /content_hash/);
});

test('MOPS history downloader refuses official security block pages', async () => {
  const client = new MopsClient({ delayMs: 0, fetchImpl: async () => ({ ok: true, text: async () => 'FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.' }) });
  await assert.rejects(() => client.query('monthlyRevenue', 2025, 1), /MOPS_SECURITY_BLOCK/);
});

test('MOPS XBRL archive URL uses the official bulk download path', () => {
  const url = xbrlArchiveUrl(2025, 4);
  assert.match(url, /mopsov\.twse\.com\.tw\/server-java\/FileDownLoad/);
  assert.match(url, /tifrs-2025Q4\.zip/);
  assert.match(url, /%2Fifrs%2F2025%2F/);
});

test('MOPS XBRL parser filters core non-dimensional facts and requires filing time', () => {
  const xml = `<?xml version="1.0"?><xbrl><context id="From20250101To20250331"><entity><identifier>2330</identifier></entity><period><startDate>2025-01-01</startDate><endDate>2025-03-31</endDate></period></context><context id="AsOf20250331"><entity><identifier>2330</identifier></entity><period><instant>2025-03-31</instant></period></context><context id="Dim"><entity><identifier>2330</identifier></entity><period><instant>2025-03-31</instant></period><scenario><member>segment</member></scenario></context><tifrs:Revenue contextRef="From20250101To20250331" unitRef="TWD" decimals="-3">1000</tifrs:Revenue><tifrs:NetCashFlowsFromUsedInOperatingActivities contextRef="From20250101To20250331" unitRef="TWD">600</tifrs:NetCashFlowsFromUsedInOperatingActivities><tifrs:PaymentsToAcquirePropertyPlantAndEquipment contextRef="From20250101To20250331" unitRef="TWD">200</tifrs:PaymentsToAcquirePropertyPlantAndEquipment><tifrs:OperatingExpenses contextRef="From20250101To20250331" unitRef="TWD">300</tifrs:OperatingExpenses><tifrs:CurrentAssets contextRef="AsOf20250331" unitRef="TWD">5000</tifrs:CurrentAssets><tifrs:CurrentLiabilities contextRef="AsOf20250331" unitRef="TWD">1800</tifrs:CurrentLiabilities><tifrs:NoncurrentLiabilities contextRef="AsOf20250331" unitRef="TWD">1200</tifrs:NoncurrentLiabilities><tifrs:Revenue contextRef="Dim" unitRef="TWD">99</tifrs:Revenue></xbrl>`;
  const identity = archiveEntryIdentity('tifrs-fr1-m1-ci-cr-2330-2025Q1.xml');
  const parsed = parseXbrlInstance(xml, identity, 'https://example.invalid/official.zip');
  assert.equal(parsed.stock_code, '2330');
  assert.deepEqual(new Set(parsed.facts.map(fact => fact.metric)), new Set([
    'revenue', 'operating_cash_flow', 'capital_expenditure', 'operating_expenses',
    'current_assets', 'current_liabilities', 'noncurrent_liabilities'
  ]));
  assert.equal(validateMopsCompleteness({ expectedArchives: 1, archives: [{}], financials: [parsed], monthlyRevenueComplete: true, majorMessagesComplete: true }).passed, false);
  const [enriched] = attachFilingTimes([parsed], [{ stock_code: '2330', fiscal_year: 2025, quarter: 1, filing_date: '2025-05-08', filing_time: '14:31:00', source_url: 'https://mops.twse.com.tw/' }]);
  assert.equal(enriched.available_from, '2025-05-08T14:31:00');
  assert.equal(validateMopsCompleteness({ expectedArchives: 1, archives: [{}], financials: [enriched], monthlyRevenueComplete: true, majorMessagesComplete: true }).passed, true);
});

test('MOPS official batch gate rejects unlicensed or incomplete history', () => {
  const rows = [{ fiscal_year: 2025, month: 1, available_from: '2025-02-10T14:00:00', source_url: 'https://mops.twse.com.tw/' }];
  const manifest = { source_kind: 'SCRAPED_WEB', complete: true, coverage_start: '2016-01-01', coverage_end: '2025-12-31', record_count: 1, content_sha256: 'a'.repeat(64) };
  assert.equal(validateOfficialBatch(manifest, rows).passed, false);
  const valid = { ...manifest, source_kind: 'MOPS_OFFICIAL_BATCH' };
  assert.equal(validateOfficialBatch(valid, rows).passed, true);
  assert.equal(validateOfficialBatch(valid, rows, { dataset: 'monthlyRevenue', expectedMonths: 120 }).passed, false);
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
  assert.equal(complete.scoringMethod, 'CLOUD_DRIVE_LONG_ONLY_V1');
  assert.equal(complete.metrics.obv.bullish, true);
  const [stale] = await enrichCandidatesWithLiveScores([{ ...candidate, timestamp: '2026-08-25T09:00:00+08:00' }], { now: new Date('2026-08-25T03:01:00Z'), fetchBars: async () => completeBars });
  assert.equal(stale.entryTier, 'NONE');
  assert.equal(stale.grade, 'BLOCKED');
  const [incomplete] = await enrichCandidatesWithLiveScores([candidate], { now: new Date('2026-08-25T03:01:00Z'), fetchBars: async () => ({ bars5m: [], bars15m: [], dailyBars: [], weeklyBars: [] }) });
  assert.equal(incomplete.grade, 'BLOCKED');
  assert.equal(incomplete.dataStatus, 'INCOMPLETE');
  assert.match(incomplete.blockedReasons.join(','), /OBV不足/);
});

test('Apps Script scenario adapter accepts weighted selections from ranks 31-50 and enforces final 30', () => {
  const candidate = rank => ({
    symbol: String(2300 + rank), name: '測試股', group: '半導體', price: 100, bidPrice: 99.9, askPrice: 100,
    grade: 'A', dayTradeOk: false, overnightOk: false, industryOk: true, fundamentalOk: true,
    chipOk: true, trendOk: true, volumePriceOk: true, momentumOk: true,
    executionPlan: { spreadPct: 0.001 }, metrics: { volumeRank: rank, volumeRatio: 1.6, ma20: 95, ma50: 90, latestQuoteTime: '2026-08-21T03:52:00Z' }
  });
  const rows = [candidate(5), candidate(30), candidate(40), candidate(51), ...Array.from({ length: 28 }, (_, i) => candidate(i + 1))];
  const result = adaptCandidatePayload({ generatedAt: '2026-08-21T03:52:52Z', scenario: [{ date: '2026-08-21', candidates: rows }] }, { time: '11:52' });
  assert.equal(result.mode, 'APPS_SCRIPT_SCENARIO');
  assert.equal(result.candidates.length, 30);
  assert.equal(result.candidates[0].metrics.volumeRank, 5);
  assert.equal(result.candidates[1].metrics.volumeRank, 30);
  assert.equal(result.candidates[2].metrics.volumeRank, 40);
  assert.ok(result.candidates.every(item => item.metrics.volumeRank <= 50));
  assert.equal(Object.values(result.candidates[0].components).reduce((a, b) => a + b, 0), result.candidates[0].score);
  assert.equal(result.candidates[0].strategy, 'SWING');
});

test('long-only adapter never keeps a legacy odd-lot day-trade strategy', () => {
  const result = adaptCandidatePayload({ candidates: [{
    symbol: '2330', price: 100, bidPrice: 99.9, askPrice: 100, strategy: 'DAY_TRADE',
    grade: 'A', dayTradeOk: true, overnightOk: false, fundamentalOk: true, chipOk: true,
    trendOk: true, momentumOk: true, volumePriceOk: true,
    metrics: { latestQuoteTime: '2026-08-28T01:10:00Z', spreadPct: 0.001 }
  }] }, { time: '09:10' });
  assert.equal(result.candidates[0].strategy, 'SWING');
  assert.equal(CONFIG.strategyMode, 'LONG_ONLY');
});

test('Drive technical enrichment combines Drive daily bars with intraday bars', async () => {
  const daily = bars(100).map((bar, index) => ({ ...bar, timestamp: new Date(Date.UTC(2025, 0, 1 + index * 2)).toISOString() }));
  const result = await fetchDriveTechnicalBars({ symbol: '2330' }, {
    now: new Date('2026-08-28T01:10:00Z'), driveTradeDate: '2026-08-27',
    driveSource: {
      adjustedDailyBars: async (symbol) => { assert.equal(symbol, '2330'); return daily; },
      marketFlowRows: async () => [{
        trade_date: '2026-08-27', institutional_total_net: '1000', foreign_net: '800',
        investment_trust_net: '100', dealer_total_net: '100', margin_previous_balance: '1000',
        margin_current_balance: '990', short_previous_balance: '100', short_current_balance: '90',
        sbl_previous_balance: '200', sbl_current_balance: '180'
      }]
    },
    fetchIntradayBars: async () => ({ bars5m: bars(80), bars15m: bars(30), provider: 'intraday-test' })
  });
  assert.equal(result.dailyBars.length, 100);
  assert.ok(result.weeklyBars.length >= 20);
  assert.equal(result.driveTradeDate, '2026-08-27');
  assert.match(result.provider, /Google Drive/);
  assert.equal(result.chipSignals.institutional.totalNet, 1000);
});

test('Drive market flow becomes the long-only chip scoring source', () => {
  const chip = driveChipSignals([{
    trade_date: '2026-08-27', institutional_total_net: '500', foreign_net: '300',
    investment_trust_net: '100', dealer_total_net: '100', margin_previous_balance: '1000',
    margin_current_balance: '1100', short_previous_balance: '200', short_current_balance: '180',
    sbl_previous_balance: '400', sbl_current_balance: '360'
  }]);
  assert.equal(chip.source, 'Google Drive TWSE每日籌碼');
  assert.equal(chip.marginChangeRatio, 0.1);
  assert.equal(chip.securitiesLendingChangeRatio, -0.1);
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

test('zero-price orders and zero-price market quotes never fill', () => {
  const manager = new OrderManager(CONFIG);
  const rejected = manager.create({ tradeDate: '2026-08-31', strategy: 'SWING', symbol: '3037', side: 'SELL', quantity: 8, price: 0, signalTimestamp: 'zero' });
  assert.equal(rejected, null);

  const valid = manager.create({
    tradeDate: '2026-08-31', strategy: 'SWING', symbol: '3037', side: 'SELL', quantity: 8,
    price: 1110, signalTimestamp: 'valid', createdAt: '2026-08-31T01:00:00Z'
  });
  const matched = manager.match(valid, { timestamp: '2026-08-31T01:14:52Z', bidPrice: 0, availableQuantity: 78000 });
  assert.equal(matched.status, 'OPEN');
  assert.equal(matched.filledQuantity, 0);
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

test('dashboard cash reconciles unsettled trades with reported equity', () => {
  const engine = new SimulationEngine({ repository: new MemoryRepository() });
  engine.account.bankCash = 100000;
  engine.account.positions = [{ symbol: '2303', strategy: 'SWING', quantity: 38, averagePrice: 127, marketValue: 4826 }];
  engine.account.settlements = [{ date: '2026-09-01', netPayable: 14472 }];
  engine.markToMarket({ '2303': { bidPrice: 127 } });
  const simulation = engine.dashboard([]).simulation;
  assert.equal(simulation.cash, 85528);
  assert.equal(simulation.finalEquity, 90354);
  assert.equal(simulation.cash + simulation.positions[0].marketValue, simulation.finalEquity);
});

test('dashboard reconstructs fee-and-tax-adjusted realized pnl and execution time', () => {
  const account = createAccount(100000);
  account.trades = [
    { tradeDate: '2026-08-28', symbol: '2303', side: 'BUY', status: 'FILLED', filledQuantity: 38, averagePrice: 128.5, fee: 7, tax: 0, orderId: 'buy-1' },
    { tradeDate: '2026-08-28', symbol: '2303', side: 'BUY', status: 'FILLED', filledQuantity: 38, averagePrice: 126, fee: 7, tax: 0, orderId: 'buy-2' },
    { tradeDate: '2026-08-28', symbol: '2303', side: 'SELL', status: 'FILLED', filledQuantity: 38, averagePrice: 125.5, fee: 7, tax: 14, orderId: 'sell-1' },
  ];
  account.orders = [{ id: 'sell-1', filledAt: '2026-08-28T05:00:00.000Z' }];
  const result = new SimulationEngine({ account }).dashboard([{ symbol: '2303', name: '聯電' }]);
  assert.equal(result.simulation.trades[0].grossAmount, 4883);
  assert.equal(result.simulation.trades[0].pnl, null);
  assert.equal(result.simulation.trades[2].grossAmount, 4769);
  assert.equal(result.simulation.trades[2].pnl, -94.5);
  assert.equal(result.simulation.trades[2].filledAt, '2026-08-28T05:00:00.000Z');
});

test('front-end mark-to-market derives economic cash from server equity', () => {
  const result = { initialCapital: 100000, cash: 100000, finalEquity: 90354, positions: [{ marketValue: 4826 }] };
  assert.equal(economicCash(result), 85528);
  assert.deepEqual(markToMarket(result, 4805), {
    cash: 85528, positionValue: 4805, finalEquity: 90333, totalReturn: -0.09667000000000003
  });
});

test('front-end zero quote preserves the last valid position value', () => {
  const positions = [
    { symbol: '3037', shares: 8, averagePrice: 1191.75, marketValue: 9534 },
    { symbol: '2303', shares: 38, averagePrice: 127, marketValue: 4826 },
  ];
  assert.equal(positionMarketValue(positions[0], 0), 9534);
  assert.equal(positionMarketValue(positions[1], 127), 4826);
  const result = { initialCapital: 100000, cash: 100000, finalEquity: 99889, positions };
  const marked = markToMarket(result, 14360);
  assert.equal(marked.cash, 85529);
  assert.equal(marked.positionValue, 14360);
  assert.equal(marked.finalEquity, 99889);
  assert.ok(Math.abs(marked.totalReturn - (-0.00111)) < 1e-12);
});

test('zero-price sell repair removes the fake trade and restores the position', () => {
  const account = createAccount(100000);
  account.trades = [
    { tradeDate: '2026-08-27', symbol: '3037', strategy: 'SWING', side: 'BUY', status: 'FILLED', filledQuantity: 4, averagePrice: 1190, fee: 7, tax: 0, orderId: 'buy-1' },
    { tradeDate: '2026-08-27', symbol: '3037', strategy: 'SWING', side: 'BUY', status: 'FILLED', filledQuantity: 4, averagePrice: 1190, fee: 7, tax: 0, orderId: 'buy-2' },
    { tradeDate: '2026-08-31', symbol: '3037', strategy: 'SWING', side: 'SELL', status: 'FILLED', filledQuantity: 8, averagePrice: 0, fee: 1, tax: 0, orderId: 'bad-sell' },
  ];
  account.orders = [{ id: 'buy-1' }, { id: 'buy-2' }, { id: 'bad-sell' }];
  account.realizedPnl = -9535;
  account.totalFees = 15;
  account.equity = 90465;
  const result = repairZeroPriceSellState(account, { symbol: '3037' });
  assert.equal(result.audit.removedTrades.length, 1);
  assert.equal(result.account.trades.length, 2);
  assert.equal(result.account.orders.some(order => order.id === 'bad-sell'), false);
  assert.equal(result.account.realizedPnl, 0);
  assert.equal(result.account.totalFees, 14);
  assert.equal(result.account.positions.length, 1);
  assert.equal(result.account.positions[0].symbol, '3037');
  assert.equal(result.account.positions[0].quantity, 8);
  assert.equal(result.account.positions[0].averagePrice, 1191.75);
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
  const candidate = { symbol: '2330', grade: 'A', score: 90, strategy: 'SWING', price: 100, askPrice: 100, blockedReasons: [] };
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

test('missing or zero execution quote cannot trigger a stop-loss exit', () => {
  const position = { strategy: 'SWING', averagePrice: 1191.75, stopPrice: 1118.6, highestPrice: 1190 };
  const result = exitDecision(position, { symbol: '3037', price: null, bidPrice: null }, { time: '09:15' }, CONFIG);
  assert.equal(result.exit, false);
  assert.match(result.reason, /無有效執行報價/);
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
