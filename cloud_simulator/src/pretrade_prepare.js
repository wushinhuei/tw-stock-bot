'use strict';

const { CONFIG } = require('./config');
const { DriveHistorySource } = require('./drive_history');
const { loadCandidates } = require('./main');

function ymd(date) { return date.toISOString().slice(0, 10); }
function monthsBefore(date, months) {
  const value = new Date(date);
  value.setUTCMonth(value.getUTCMonth() - months);
  return ymd(value);
}
function normalizeCode(value) { return String(value || '').replace(/\.TW$/i, '').trim(); }
function rowCode(row) { return normalizeCode(row?.stock_code || row?.company_code || row?.code || row?.symbol); }
function toCodeSet(rows) { return new Set((rows || []).map(rowCode).filter(Boolean)); }

async function mapWithConcurrency(rows, limit, mapper) {
  const output = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length || 1) }, worker));
  return output;
}

async function loadMopsCoverage(source, now) {
  const year = now.getFullYear();
  const previousYear = year - 1;
  const [manifest, companyBasic, revenueCurrent, revenuePrevious, financialCurrent, financialPrevious] = await Promise.all([
    source.mopsManifest(),
    source.mopsRows('companyBasic', year),
    source.mopsRows('monthlyRevenue', year).catch(() => []),
    source.mopsRows('monthlyRevenue', previousYear).catch(() => []),
    source.mopsRows('quarterlyFinancials', year).catch(() => []),
    source.mopsRows('quarterlyFinancials', previousYear).catch(() => []),
  ]);
  return {
    manifest,
    companyBasic: toCodeSet(companyBasic),
    monthlyRevenue: new Set([...toCodeSet(revenuePrevious), ...toCodeSet(revenueCurrent)]),
    quarterlyFinancials: new Set([...toCodeSet(financialPrevious), ...toCodeSet(financialCurrent)]),
  };
}

async function preparePretradeTop100(options = {}) {
  const now = options.now || new Date();
  const source = options.driveSource || new DriveHistorySource();
  const expectedCount = Number(options.expectedCount || CONFIG.candidateSelectionPoolLimit || 100);
  const minDailyBars = Number(options.minDailyBars || 50);
  const start = monthsBefore(now, 18);

  // 先強制刷新候選來源。Apps Script refresh 會先把可取得的最新盤前資料更新進候選快照。
  const sourceRefresh = await (options.loadCandidates || loadCandidates)().catch(error => {
    return { error: String(error) };
  });

  let analysisStatus = null;
  let universe = [];
  let mops = null;
  const globalErrors = [];
  try { analysisStatus = await source.analysisStatus(); } catch (error) { globalErrors.push(`analysis_status:${error}`); }
  try { universe = await source.analysisUniverse(); } catch (error) { globalErrors.push(`analysis_universe:${error}`); }
  try { mops = await loadMopsCoverage(source, now); } catch (error) { globalErrors.push(`mops:${error}`); }

  const active = (universe || [])
    .filter(row => row.active_top100)
    .sort((a, b) => Number(a.current_top100_rank || 9999) - Number(b.current_top100_rank || 9999))
    .slice(0, expectedCount);

  const tradeDate = analysisStatus?.tradeDate || analysisStatus?.latestSuccessfulTradeDate || null;
  const end = tradeDate || ymd(now);

  const checks = await mapWithConcurrency(active, Number(CONFIG.liveScoreConcurrency || 6), async row => {
    const symbol = normalizeCode(row.stock_code);
    const missing = new Set(Array.isArray(row.missing_datasets) ? row.missing_datasets : []);
    let dailyBars = [];
    let flowRows = [];
    try { dailyBars = await source.adjustedDailyBars(symbol, start, end); }
    catch (error) { missing.add('technical_history'); }
    try { flowRows = await source.marketFlowRows(symbol, start, end); }
    catch (error) { missing.add('chip_history'); }

    if (dailyBars.length < minDailyBars) missing.add('technical_history');
    if (!flowRows.length) missing.add('chip_history');
    if (!mops?.companyBasic?.has(symbol)) missing.add('company_basic');
    if (!mops?.monthlyRevenue?.has(symbol)) missing.add('monthly_revenue');
    if (!mops?.quarterlyFinancials?.has(symbol)) missing.add('quarterly_financials');
    if (!mops?.manifest || mops.manifest.status !== 'complete' || (mops.manifest.warnings || []).length) missing.add('news_event_dataset');

    return {
      symbol,
      name: row.stock_name || symbol,
      rank: Number(row.current_top100_rank || 0) || null,
      ready: missing.size === 0,
      missing: [...missing],
      dailyBars: dailyBars.length,
      chipRows: flowRows.length,
    };
  });

  const incomplete = checks.filter(item => !item.ready);
  const completeCount = checks.length - incomplete.length;
  const ready = globalErrors.length === 0 && active.length === expectedCount && incomplete.length === 0;
  return {
    ready,
    generatedAt: now.toISOString(),
    dataTradeDate: tradeDate,
    expectedTop100Count: expectedCount,
    activeTop100Count: active.length,
    completeCount,
    incompleteCount: incomplete.length,
    incompleteSymbols: incomplete.map(item => ({ symbol: item.symbol, missing: item.missing })),
    globalErrors,
    sourceRefreshOk: Array.isArray(sourceRefresh) || !sourceRefresh?.error,
    policy: {
      technical: `至少${minDailyBars}根日線＋可計算技術指標`,
      chip: '前一交易日以前的法人／融資融券／借券資料可用',
      fundamental: '公司基本資料＋月營收＋最近可得季度財報',
      news: 'MOPS重大訊息／申報事件資料集更新完成；沒有個股新聞本身不視為缺資料',
      tradingGate: 'Top100未全數完成盤前資料準備時，禁止新增買進；既有持倉仍照常監控與出場',
    },
    checks,
  };
}

function blockEntriesForPretradeReadiness(candidates, report) {
  if (report?.ready) return candidates;
  const reason = 'Top100盤前資料尚未全部補齊，暫停新增買進';
  return (candidates || []).map(candidate => ({
    ...candidate,
    grade: 'BLOCKED',
    entryTier: 'NONE',
    dataStatus: 'PRETRADE_INCOMPLETE',
    blockedReasons: [...new Set([...(candidate.blockedReasons || []), reason])],
    metrics: { ...candidate.metrics, pretradeReadiness: report?.generatedAt || null },
  }));
}

module.exports = { blockEntriesForPretradeReadiness, preparePretradeTop100 };
