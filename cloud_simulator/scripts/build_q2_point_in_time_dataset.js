'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DriveHistorySource } = require('../src/drive_history');

const START = process.env.START_DATE || '2026-04-01';
const END = process.env.END_DATE || '2026-06-30';
const MCP_DIR = path.resolve(process.env.MCP_DIR || 'data/backtest/twse-q2-mcp');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'data/backtest/q2-point-in-time');
const AVAILABLE_HOUR = process.env.TWSE_AVAILABLE_HOUR || '20:30:00';

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing input: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
function key(date, symbol) { return `${date}|${symbol}`; }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function first(row, names) {
  for (const name of names) if (row && row[name] != null && row[name] !== '') return row[name];
  return null;
}
function driveDailyIndex(rows) {
  return new Map((rows || []).filter(row => row.trade_date >= START && row.trade_date <= END)
    .map(row => [key(row.trade_date, row.stock_code), row]));
}
function driveFlowIndex(rows) {
  return new Map((rows || []).filter(row => row.trade_date >= START && row.trade_date <= END)
    .map(row => [key(row.trade_date, row.stock_code), row]));
}
function near(a, b, tolerance = 1e-6) {
  const left = finite(a); const right = finite(b);
  if (left == null || right == null) return null;
  return Math.abs(left - right) <= Math.max(tolerance, Math.abs(left) * 1e-8);
}
function compareRow(mcp, daily, flow) {
  const comparisons = {
    open: daily ? near(mcp.open, daily.open) : null,
    high: daily ? near(mcp.high, daily.high) : null,
    low: daily ? near(mcp.low, daily.low) : null,
    close: daily ? near(mcp.close, daily.close) : null,
    volume: daily ? near(mcp.volume, first(daily, ['trade_volume', 'volume'])) : null,
    institutionalTotalNet: flow && mcp.institutional ? near(mcp.institutional.institutionalTotalNet, first(flow, ['institutional_total_net', 'institutionalTotalNet'])) : null,
    foreignNet: flow && mcp.institutional ? near(mcp.institutional.foreignNet, first(flow, ['foreign_net', 'foreignNet'])) : null,
    investmentTrustNet: flow && mcp.institutional ? near(mcp.institutional.investmentTrustNet, first(flow, ['investment_trust_net', 'investmentTrustNet'])) : null,
    marginCurrentBalance: flow && mcp.margin ? near(mcp.margin.marginCurrentBalance, first(flow, ['margin_current_balance', 'marginCurrentBalance'])) : null,
    shortCurrentBalance: flow && mcp.margin ? near(mcp.margin.shortCurrentBalance, first(flow, ['short_current_balance', 'shortCurrentBalance'])) : null
  };
  const checked = Object.values(comparisons).filter(value => value !== null);
  return { comparisons, checked: checked.length, mismatches: checked.filter(value => value === false).length };
}
function buildPointInTimeRow(row, daily, flow, crossCheckAvailable = true) {
  const cross = compareRow(row, daily, flow);
  return {
    tradeDate: row.tradeDate,
    sourceAvailableAt: `${row.tradeDate}T${AVAILABLE_HOUR}+08:00`,
    usableFrom: 'NEXT_TRADING_SESSION',
    volumeRank: row.volumeRank,
    symbol: row.symbol,
    name: row.name,
    market: {
      open: row.open, high: row.high, low: row.low, close: row.close,
      volume: row.volume, value: row.value, transactions: row.transactions,
      closingBid: row.closingBid, closingAsk: row.closingAsk, pe: row.pe
    },
    institutional: row.institutional || null,
    margin: row.margin || null,
    availability: {
      market: true,
      institutional: Boolean(row.institutionalAvailable),
      margin: Boolean(row.marginAvailable)
    },
    driveCrossCheck: {
      available: crossCheckAvailable,
      dailyPresent: crossCheckAvailable ? Boolean(daily) : null,
      marketFlowPresent: crossCheckAvailable ? Boolean(flow) : null,
      ...cross
    },
    provenance: {
      primary: 'TWSE_MCP_OFFICIAL',
      crossCheck: crossCheckAvailable ? 'GOOGLE_DRIVE_HISTORY' : 'UNAVAILABLE_NON_BLOCKING',
      pointInTimeRule: 'TWSE daily market, institutional and margin data are treated as post-close data and cannot be used during the same trading session.'
    }
  };
}

async function loadOptionalDriveCrossCheck() {
  if (process.env.SKIP_DRIVE_CROSSCHECK === '1') return { dailyRows: [], flowRows: [], available: false, error: 'SKIP_DRIVE_CROSSCHECK=1' };
  try {
    const source = new DriveHistorySource();
    const [dailyRows, flowRows] = await Promise.all([
      source.rows('stockDaily', 2026),
      source.rows('marketFlow', 2026)
    ]);
    return { dailyRows, flowRows, available: true, error: null };
  } catch (error) {
    return { dailyRows: [], flowRows: [], available: false, error: String(error.message || error) };
  }
}

async function main() {
  const mcpRows = readJsonl(path.join(MCP_DIR, 'top100.jsonl'))
    .filter(row => row.tradeDate >= START && row.tradeDate <= END);
  const drive = await loadOptionalDriveCrossCheck();
  const dailyByKey = driveDailyIndex(drive.dailyRows);
  const flowByKey = driveFlowIndex(drive.flowRows);

  const output = mcpRows.map(row => buildPointInTimeRow(
    row,
    dailyByKey.get(key(row.tradeDate, row.symbol)),
    flowByKey.get(key(row.tradeDate, row.symbol)),
    drive.available
  ));

  const discrepancies = [];
  if (drive.available) {
    for (const row of output) {
      const cc = row.driveCrossCheck;
      if (!cc.dailyPresent) discrepancies.push({ tradeDate: row.tradeDate, symbol: row.symbol, type: 'DRIVE_DAILY_MISSING' });
      if (!cc.marketFlowPresent) discrepancies.push({ tradeDate: row.tradeDate, symbol: row.symbol, type: 'DRIVE_MARKET_FLOW_MISSING' });
      for (const [field, same] of Object.entries(cc.comparisons)) {
        if (same === false) discrepancies.push({ tradeDate: row.tradeDate, symbol: row.symbol, type: 'VALUE_MISMATCH', field });
      }
    }
  }

  const tradingDates = [...new Set(output.map(row => row.tradeDate))].sort();
  const symbols = [...new Set(output.map(row => row.symbol))].sort();
  const totalChecks = output.reduce((sum, row) => sum + row.driveCrossCheck.checked, 0);
  const totalMismatches = output.reduce((sum, row) => sum + row.driveCrossCheck.mismatches, 0);
  const dailyMissing = drive.available ? output.filter(row => !row.driveCrossCheck.dailyPresent).length : null;
  const flowMissing = drive.available ? output.filter(row => !row.driveCrossCheck.marketFlowPresent).length : null;
  const institutionalMissing = output.filter(row => !row.availability.institutional).length;
  const marginMissing = output.filter(row => !row.availability.margin).length;

  const byDate = tradingDates.map(date => {
    const rows = output.filter(row => row.tradeDate === date);
    return {
      tradeDate: date,
      top100Count: rows.length,
      driveCrossCheckAvailable: drive.available,
      driveDailyMissing: drive.available ? rows.filter(row => !row.driveCrossCheck.dailyPresent).length : null,
      driveMarketFlowMissing: drive.available ? rows.filter(row => !row.driveCrossCheck.marketFlowPresent).length : null,
      institutionalMissing: rows.filter(row => !row.availability.institutional).length,
      marginMissing: rows.filter(row => !row.availability.margin).length,
      valueMismatches: rows.reduce((sum, row) => sum + row.driveCrossCheck.mismatches, 0)
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    period: { start: START, end: END },
    status: drive.available ? (discrepancies.length === 0 ? 'cross_check_clean' : 'cross_check_has_discrepancies') : 'official_primary_complete_cross_check_unavailable',
    primarySource: 'TWSE MCP official historical interface',
    crossCheckSource: drive.available ? 'Google Drive stockDaily + marketFlow' : null,
    crossCheckAvailable: drive.available,
    crossCheckError: drive.error,
    crossCheckRequiredForReplay: false,
    pointInTime: {
      enabled: true,
      sourceAvailableAt: `trade date ${AVAILABLE_HOUR} Asia/Taipei`,
      sameSessionUseForbidden: true,
      usableFrom: 'next trading session'
    },
    tradingDayCount: tradingDates.length,
    top100RowCount: output.length,
    uniqueSymbolCount: symbols.length,
    totalCrossChecks: totalChecks,
    totalValueMismatches: totalMismatches,
    driveDailyMissing: dailyMissing,
    driveMarketFlowMissing: flowMissing,
    institutionalMissing,
    marginMissing,
    discrepancyCount: discrepancies.length,
    files: {
      dataset: 'point_in_time_top100.jsonl',
      discrepancies: 'discrepancies.jsonl',
      dailyAudit: 'daily_cross_check.json',
      manifest: 'manifest.json'
    },
    notes: [
      'TWSE MCP is the primary source. Google Drive is only a non-blocking cross-check and never overwrites the official row silently.',
      'If Drive credentials are absent, the official TWSE MCP row remains valid and the cross-check is recorded as unavailable rather than fabricating a mismatch.',
      'Margin absence is preserved because a stock may be ineligible for margin trading.',
      'This dataset contains post-close daily facts only; intraday bars are a separate dataset and are still required for high-fidelity signal replay.'
    ]
  };

  writeJsonl(path.join(OUTPUT_DIR, 'point_in_time_top100.jsonl'), output);
  writeJsonl(path.join(OUTPUT_DIR, 'discrepancies.jsonl'), discrepancies);
  writeJson(path.join(OUTPUT_DIR, 'daily_cross_check.json'), byDate);
  writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { buildPointInTimeRow, compareRow, driveDailyIndex, driveFlowIndex, loadOptionalDriveCrossCheck, near };
