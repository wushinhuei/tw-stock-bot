'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { callTool } = require('../src/twse_mcp_history');

const START = process.env.START_DATE || '2026-04-01';
const END = process.env.END_DATE || '2026-06-30';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'data/backtest/twse-q2-mcp');
const REFRESH = process.env.REFRESH === '1';
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 700);
const TOP_LIMIT = Number(process.env.TOP_LIMIT || 100);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid date: ${text}`);
  return text;
}
function weekdaysBetween(start, end) {
  const from = new Date(`${isoDate(start)}T00:00:00Z`);
  const to = new Date(`${isoDate(end)}T00:00:00Z`);
  if (from > to) throw new Error('START_DATE must be <= END_DATE');
  const dates = [];
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}
function isListedCommonStock(row) {
  return /^[1-9]\d{3}$/.test(String(row?.symbol || ''))
    && Number.isFinite(Number(row?.volume))
    && Number(row.volume) > 0
    && Number.isFinite(Number(row?.close))
    && Number(row.close) > 0;
}
function buildTop100(rows, limit = TOP_LIMIT) {
  return (rows || [])
    .filter(isListedCommonStock)
    .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0) || String(a.symbol).localeCompare(String(b.symbol)))
    .slice(0, limit)
    .map((row, index) => ({ ...row, volumeRank: index + 1 }));
}
function indexBySymbol(rows) {
  return new Map((rows || []).map(row => [String(row.symbol), row]));
}
function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}
function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}
function readCached(filePath) {
  if (!fs.existsSync(filePath) || REFRESH) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}
async function mcpCall(name, args) {
  return callTool(name, args, {
    retries: Number(process.env.TWSE_RETRIES || 6),
    retryDelayMs: Number(process.env.TWSE_RETRY_DELAY_MS || 1800),
    timeoutMs: Number(process.env.TWSE_TIMEOUT_MS || 45000)
  });
}
async function fetchTradingDay(date) {
  const cachePath = path.join(OUTPUT_DIR, 'daily', `${date}.json`);
  const cached = readCached(cachePath);
  if (cached) return cached;

  const market = await mcpCall('twse_market_daily', { date });
  if (market.status !== 'OK' || !(market.rows || []).length) {
    const result = { date, tradingDay: false, marketStatus: market.status, market, institutional: null, margin: null };
    atomicWriteJson(cachePath, result);
    return result;
  }

  await sleep(REQUEST_DELAY_MS);
  const institutional = await mcpCall('twse_institutional_daily', { date });
  await sleep(REQUEST_DELAY_MS);
  const margin = await mcpCall('twse_margin_daily', { date });

  const result = { date, tradingDay: true, marketStatus: market.status, market, institutional, margin };
  atomicWriteJson(cachePath, result);
  return result;
}
function auditTradingDay(bundle) {
  const top100 = buildTop100(bundle.market?.rows || []);
  const institutionalBySymbol = indexBySymbol(bundle.institutional?.rows || []);
  const marginBySymbol = indexBySymbol(bundle.margin?.rows || []);
  const missingInstitutional = [];
  const missingMargin = [];
  const rows = top100.map(row => {
    const institutional = institutionalBySymbol.get(row.symbol) || null;
    const margin = marginBySymbol.get(row.symbol) || null;
    if (!institutional) missingInstitutional.push(row.symbol);
    if (!margin) missingMargin.push(row.symbol);
    return {
      tradeDate: bundle.date,
      volumeRank: row.volumeRank,
      symbol: row.symbol,
      name: row.name,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      value: row.value,
      transactions: row.transactions,
      closingBid: row.bid,
      closingAsk: row.ask,
      pe: row.pe,
      institutionalAvailable: Boolean(institutional),
      marginAvailable: Boolean(margin),
      institutional,
      margin
    };
  });
  return {
    date: bundle.date,
    marketRows: bundle.market?.rows?.length || 0,
    commonStockRows: (bundle.market?.rows || []).filter(isListedCommonStock).length,
    top100Count: top100.length,
    institutionalStatus: bundle.institutional?.status || null,
    institutionalRows: bundle.institutional?.rows?.length || 0,
    marginStatus: bundle.margin?.status || null,
    marginRows: bundle.margin?.rows?.length || 0,
    missingInstitutional,
    missingMargin,
    rows
  };
}
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const weekdays = weekdaysBetween(START, END);
  const tradingAudits = [];
  const nonTradingDays = [];
  const failures = [];

  for (let index = 0; index < weekdays.length; index += 1) {
    const date = weekdays[index];
    try {
      const bundle = await fetchTradingDay(date);
      if (!bundle.tradingDay) {
        nonTradingDays.push({ date, status: bundle.marketStatus });
      } else {
        tradingAudits.push(auditTradingDay(bundle));
      }
    } catch (error) {
      failures.push({ date, error: String(error.message || error) });
    }
    process.stderr.write(`[twse-q2-mcp] ${index + 1}/${weekdays.length} ${date} trading=${tradingAudits.length} failures=${failures.length}\n`);
    await sleep(REQUEST_DELAY_MS);
  }

  const top100Rows = tradingAudits.flatMap(day => day.rows);
  const missingRows = tradingAudits.flatMap(day => [
    ...day.missingInstitutional.map(symbol => ({ tradeDate: day.date, symbol, dataset: 'institutional', classification: 'MISSING_FROM_OFFICIAL_DAILY_TABLE' })),
    ...day.missingMargin.map(symbol => ({ tradeDate: day.date, symbol, dataset: 'margin', classification: 'ABSENT_FROM_MARGIN_TABLE_MAY_BE_NOT_MARGIN_ELIGIBLE' }))
  ]);

  const incompleteDays = tradingAudits.filter(day =>
    day.top100Count !== TOP_LIMIT
    || day.institutionalStatus !== 'OK'
    || day.marginStatus !== 'OK'
    || day.missingInstitutional.length > 0
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    period: { start: START, end: END },
    interface: 'TWSE MCP callTool',
    policy: {
      topPool: `daily top ${TOP_LIMIT} by official TWSE traded volume`,
      commonStockFilter: 'four-digit listed symbols starting 1-9; positive volume and close',
      strategyModified: false,
      pointInTime: true,
      marginAbsenceMeaning: 'Absence from MI_MARGN is reported but is not automatically treated as corrupt data because a stock may not be margin eligible.'
    },
    weekdayCount: weekdays.length,
    tradingDayCount: tradingAudits.length,
    nonTradingDayCount: nonTradingDays.length,
    top100RowCount: top100Rows.length,
    incompleteDayCount: incompleteDays.length,
    missingInstitutionalCount: tradingAudits.reduce((sum, day) => sum + day.missingInstitutional.length, 0),
    missingMarginCount: tradingAudits.reduce((sum, day) => sum + day.missingMargin.length, 0),
    requestFailureCount: failures.length,
    nonTradingDays,
    failures,
    incompleteDays: incompleteDays.map(day => ({
      date: day.date,
      top100Count: day.top100Count,
      institutionalStatus: day.institutionalStatus,
      marginStatus: day.marginStatus,
      missingInstitutional: day.missingInstitutional,
      missingMargin: day.missingMargin
    })),
    outputs: {
      top100: 'top100.jsonl',
      missing: 'missing.jsonl',
      dailyAudit: 'daily_audit.json',
      manifest: 'manifest.json'
    }
  };

  writeJsonl(path.join(OUTPUT_DIR, 'top100.jsonl'), top100Rows);
  writeJsonl(path.join(OUTPUT_DIR, 'missing.jsonl'), missingRows);
  atomicWriteJson(path.join(OUTPUT_DIR, 'daily_audit.json'), tradingAudits.map(day => ({
    date: day.date,
    marketRows: day.marketRows,
    commonStockRows: day.commonStockRows,
    top100Count: day.top100Count,
    institutionalStatus: day.institutionalStatus,
    institutionalRows: day.institutionalRows,
    marginStatus: day.marginStatus,
    marginRows: day.marginRows,
    missingInstitutional: day.missingInstitutional,
    missingMargin: day.missingMargin
  })));
  atomicWriteJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (failures.length) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { auditTradingDay, buildTop100, isListedCommonStock, weekdaysBetween };
