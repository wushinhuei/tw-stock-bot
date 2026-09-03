'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MopsMcpHistory } = require('../src/mops_mcp_history');

const START = process.env.START_DATE || '2026-04-01';
const END = process.env.END_DATE || '2026-06-30';
const INPUT_DIR = path.resolve(process.env.INPUT_DIR || 'data/backtest/q2-point-in-time');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'data/backtest/q2-mops-point-in-time');

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
function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const roc = text.match(/^(\d{2,3})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (roc) return `${Number(roc[1]) + 1911}-${String(roc[2]).padStart(2, '0')}-${String(roc[3]).padStart(2, '0')}`;
  return '';
}
function normalizeTime(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '18:00:00';
  const padded = digits.padEnd(6, '0').slice(0, 6);
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
}
function symbolOf(row) { return String(row?.stock_code || row?.symbol || row?.公司代號 || '').match(/\d{4}/)?.[0] || ''; }
function availableAt(row, fallbackDate = '') {
  const explicit = String(row?.available_from || row?.availableAt || row?.source_available_at || '').trim();
  if (explicit) {
    const normalized = explicit.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T/.test(normalized)) return normalized.includes('+') || normalized.endsWith('Z') ? normalized : `${normalized}+08:00`;
  }
  const date = normalizeDate(row?.filing_date || row?.announcement_date || row?.publish_date || row?.date || fallbackDate);
  if (!date) return '';
  const time = normalizeTime(row?.filing_time || row?.announcement_time || row?.publish_time || '18:00:00');
  return `${date}T${time}+08:00`;
}
function indexBySymbol(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const symbol = symbolOf(row);
    if (!symbol) continue;
    if (!map.has(symbol)) map.set(symbol, []);
    map.get(symbol).push(row);
  }
  return map;
}
function latestAvailable(rows, asOf) {
  return (rows || []).map(row => ({ row, at: availableAt(row) })).filter(item => item.at && item.at <= asOf)
    .sort((a, b) => b.at.localeCompare(a.at))[0]?.row || null;
}
function messagesAvailable(rows, asOf) {
  return (rows || []).map(row => ({ row, at: availableAt(row) })).filter(item => item.at && item.at <= asOf)
    .sort((a, b) => a.at.localeCompare(b.at)).map(item => item.row);
}
function asOfNextSession(tradeDate) { return `${tradeDate}T08:59:59+08:00`; }

async function loadMops(source) {
  const [rev2025, rev2026, fin2025, fin2026, msg2026, filing2025, filing2026] = await Promise.all([
    source.monthlyRevenue({ year: 2025 }), source.monthlyRevenue({ year: 2026 }),
    source.quarterlyFinancials({ year: 2025 }), source.quarterlyFinancials({ year: 2026 }),
    source.majorMessages({ year: 2026 }),
    source.filingIndex({ year: 2025 }), source.filingIndex({ year: 2026 })
  ]);
  return {
    revenue: indexBySymbol([...(rev2025.rows || []), ...(rev2026.rows || [])]),
    financials: indexBySymbol([...(fin2025.rows || []), ...(fin2026.rows || [])]),
    messages: indexBySymbol(msg2026.rows || []),
    filings: indexBySymbol([...(filing2025.rows || []), ...(filing2026.rows || [])])
  };
}

function buildRows(baseRows, mops) {
  const rows = [];
  const audit = new Map();
  for (const base of baseRows) {
    if (base.tradeDate < START || base.tradeDate > END) continue;
    const symbol = String(base.symbol);
    const asOf = asOfNextSession(base.tradeDate);
    const revenue = latestAvailable(mops.revenue.get(symbol), asOf);
    const financial = latestAvailable(mops.financials.get(symbol), asOf);
    const filings = messagesAvailable(mops.filings.get(symbol), asOf);
    const messages = messagesAvailable(mops.messages.get(symbol), asOf);
    const key = base.tradeDate;
    const day = audit.get(key) || { tradeDate: key, rows: 0, missingRevenue: 0, missingFinancials: 0, messages: 0, filingRows: 0 };
    day.rows += 1;
    if (!revenue) day.missingRevenue += 1;
    if (!financial) day.missingFinancials += 1;
    day.messages += messages.length;
    day.filingRows += filings.length;
    audit.set(key, day);
    rows.push({
      ...base,
      pointInTimeAsOf: asOf,
      mopsSource: 'MOPS_MCP',
      mops: {
        monthlyRevenue: revenue,
        quarterlyFinancials: financial,
        majorMessages: messages,
        filingIndex: filings
      },
      mopsAvailability: {
        monthlyRevenue: Boolean(revenue),
        quarterlyFinancials: Boolean(financial),
        majorMessageCount: messages.length,
        filingCount: filings.length
      }
    });
  }
  return { rows, audit: [...audit.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)) };
}

async function main() {
  const basePath = path.join(INPUT_DIR, 'point_in_time_top100.jsonl');
  const baseRows = readJsonl(basePath);
  const source = new MopsMcpHistory();
  const mops = await loadMops(source);
  const built = buildRows(baseRows, mops);
  const missingRows = built.rows.flatMap(row => {
    const output = [];
    if (!row.mopsAvailability.monthlyRevenue) output.push({ tradeDate: row.tradeDate, symbol: row.symbol, dataset: 'monthlyRevenue' });
    if (!row.mopsAvailability.quarterlyFinancials) output.push({ tradeDate: row.tradeDate, symbol: row.symbol, dataset: 'quarterlyFinancials' });
    return output;
  });
  const symbols = new Set(built.rows.map(row => row.symbol));
  const manifest = {
    generatedAt: new Date().toISOString(),
    period: { start: START, end: END },
    source: 'MOPS_MCP backed by official MOPS datasets cached in Google Drive',
    pointInTimeRule: 'For each trade date, only MOPS records whose available_from/filing timestamp is <= 08:59:59 Asia/Taipei are visible. No future filings are used.',
    strategyModified: false,
    inputRows: baseRows.length,
    outputRows: built.rows.length,
    symbolCount: symbols.size,
    missingRevenueCount: missingRows.filter(row => row.dataset === 'monthlyRevenue').length,
    missingFinancialsCount: missingRows.filter(row => row.dataset === 'quarterlyFinancials').length,
    outputs: {
      merged: 'q2_pit_with_mops.jsonl',
      missing: 'mops_missing.jsonl',
      dailyAudit: 'daily_mops_audit.json',
      manifest: 'manifest.json'
    }
  };
  writeJsonl(path.join(OUTPUT_DIR, 'q2_pit_with_mops.jsonl'), built.rows);
  writeJsonl(path.join(OUTPUT_DIR, 'mops_missing.jsonl'), missingRows);
  writeJson(path.join(OUTPUT_DIR, 'daily_mops_audit.json'), built.audit);
  writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { availableAt, buildRows, latestAvailable, loadMops, messagesAvailable, normalizeDate, normalizeTime };
