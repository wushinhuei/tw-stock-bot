'use strict';

const fs = require('node:fs');
const path = require('node:path');

const START = process.env.BACKTEST_START || '2026-04-01';
const END = process.env.BACKTEST_END || '2026-06-30';
const WARMUP_START = process.env.INTRADAY_WARMUP_START || '2026-03-20';
const MCP_DIR = path.resolve(process.env.TWSE_Q2_DIR || 'data/backtest/twse-q2-mcp');
const OUTPUT = process.env.INTRADAY_UNIVERSE_OUTPUT
  || path.join(process.cwd(), 'data', 'backtest', '2026Q2', 'q2_top100_union.json');

function candidateCode(row) {
  const code = String(row.symbol || row.stock_code || '').trim();
  return /^[1-9]\d{3}$/.test(code) ? code : null;
}

function numericVolume(row) {
  const value = Number(row.volume || row.trade_volume || 0);
  return Number.isFinite(value) ? value : 0;
}

function readBundles() {
  const dailyDir = path.join(MCP_DIR, 'daily');
  if (!fs.existsSync(dailyDir)) throw new Error(`missing TWSE MCP daily cache: ${dailyDir}`);
  return fs.readdirSync(dailyDir)
    .filter(name => /^2026-\d{2}-\d{2}\.json$/.test(name))
    .map(name => JSON.parse(fs.readFileSync(path.join(dailyDir, name), 'utf8')))
    .filter(bundle => bundle.tradingDay && bundle.date >= START && bundle.date <= END)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function buildUniverse(options = {}) {
  const bundles = options.bundles || readBundles();
  const appearances = new Map();
  const dailyMarket = [];

  for (const bundle of bundles) {
    const rows = (bundle.market?.rows || [])
      .filter(row => candidateCode(row) && numericVolume(row) > 0 && Number(row.close) > 0);
    dailyMarket.push({ date: bundle.date, symbols: rows.map(row => candidateCode(row)).sort() });
    for (const row of rows) {
      const symbol = candidateCode(row);
      const current = appearances.get(symbol) || {
        symbol,
        name: row.name || '',
        tradingDays: 0,
        firstSeen: bundle.date,
        lastSeen: bundle.date,
        maxDailyVolume: 0
      };
      current.tradingDays += 1;
      current.firstSeen = current.firstSeen < bundle.date ? current.firstSeen : bundle.date;
      current.lastSeen = current.lastSeen > bundle.date ? current.lastSeen : bundle.date;
      current.maxDailyVolume = Math.max(current.maxDailyVolume, numericVolume(row));
      if (row.name) current.name = row.name;
      appearances.set(symbol, current);
    }
  }

  // Acquisition universe intentionally contains every listed common stock that traded in Q2.
  // Using the final daily Top100 to decide which intraday data to download would leak end-of-day information
  // into the morning replay. Hourly Top100 must be reconstructed later from cumulative intraday volume.
  const symbols = [...appearances.values()]
    .sort((a, b) => b.tradingDays - a.tradingDays || b.maxDailyVolume - a.maxDailyVolume || a.symbol.localeCompare(b.symbol));

  return {
    schemaVersion: 2,
    purpose: '2026Q2 high-fidelity point-in-time intraday acquisition universe',
    period: { start: START, end: END, intradayWarmupStart: WARMUP_START },
    source: 'TWSE_MCP_PRIMARY',
    policy: {
      acquisitionUniverse: 'all listed common stocks with positive official TWSE volume during Q2',
      dailyTop100LeakageForbidden: true,
      signalSelection: 'reconstruct cumulative-volume Top100 and four-factor Top30 at each replay timestamp',
      fallback: 'other providers may supply intraday bars only because TWSE MCP public history has no minute bars'
    },
    tradingDays: dailyMarket.length,
    uniqueSymbols: symbols.length,
    symbols,
    dailyMarket
  };
}

async function main() {
  const payload = await buildUniverse();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, source: payload.source, output: OUTPUT, tradingDays: payload.tradingDays, uniqueSymbols: payload.uniqueSymbols, period: payload.period }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { buildUniverse, candidateCode, numericVolume, readBundles };
