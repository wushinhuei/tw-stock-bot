'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DriveHistorySource } = require('../src/drive_history');

const START = process.env.BACKTEST_START || '2026-04-01';
const END = process.env.BACKTEST_END || '2026-06-30';
const WARMUP_START = process.env.INTRADAY_WARMUP_START || '2026-03-20';
const OUTPUT = process.env.INTRADAY_UNIVERSE_OUTPUT
  || path.join(process.cwd(), 'data', 'backtest', '2026Q2', 'q2_top100_union.json');

function candidateCode(row) {
  const code = String(row.stock_code || '').trim();
  // 台股一般上市普通股主要為四位數且不以 0 開頭；此處寧可多抓、不可少抓。
  // 正式回測的可交易性仍由 point-in-time universe 規則再次篩選。
  return /^[1-9]\d{3}$/.test(code) ? code : null;
}

function numericVolume(row) {
  const value = Number(row.trade_volume || row.volume || 0);
  return Number.isFinite(value) ? value : 0;
}

async function buildUniverse(options = {}) {
  const source = options.source || new DriveHistorySource();
  await source.manifest('stockDaily');
  const rows = await source.rows('stockDaily', 2026);
  const byDate = new Map();

  for (const row of rows) {
    const date = String(row.trade_date || '');
    if (date < START || date > END) continue;
    const code = candidateCode(row);
    if (!code || numericVolume(row) <= 0) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      symbol: code,
      name: row.stock_name || '',
      volume: numericVolume(row)
    });
  }

  const appearances = new Map();
  const dailyTop100 = [];
  for (const date of [...byDate.keys()].sort()) {
    const ranked = byDate.get(date)
      .sort((a, b) => b.volume - a.volume || a.symbol.localeCompare(b.symbol))
      .slice(0, 100)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    dailyTop100.push({ date, symbols: ranked.map(row => row.symbol) });
    for (const row of ranked) {
      const current = appearances.get(row.symbol) || {
        symbol: row.symbol,
        name: row.name,
        appearances: 0,
        bestRank: Number.POSITIVE_INFINITY,
        firstSeen: date,
        lastSeen: date
      };
      current.appearances += 1;
      current.bestRank = Math.min(current.bestRank, row.rank);
      current.firstSeen = current.firstSeen < date ? current.firstSeen : date;
      current.lastSeen = current.lastSeen > date ? current.lastSeen : date;
      if (row.name) current.name = row.name;
      appearances.set(row.symbol, current);
    }
  }

  const symbols = [...appearances.values()]
    .sort((a, b) => b.appearances - a.appearances || a.bestRank - b.bestRank || a.symbol.localeCompare(b.symbol));

  return {
    schemaVersion: 1,
    purpose: '2026Q2 point-in-time replay intraday acquisition universe',
    period: { start: START, end: END, intradayWarmupStart: WARMUP_START },
    policy: {
      dailyPoolSize: 100,
      rankingBasisForAcquisitionOnly: 'daily trade_volume',
      note: '此檔只決定要補抓哪些股票的盤中資料；不代表正式 Top30 或進場名單。正式回測會逐時依凍結策略重新評分。'
    },
    tradingDays: dailyTop100.length,
    uniqueSymbols: symbols.length,
    symbols,
    dailyTop100
  };
}

async function main() {
  const payload = await buildUniverse();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT,
    tradingDays: payload.tradingDays,
    uniqueSymbols: payload.uniqueSymbols,
    period: payload.period
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildUniverse, candidateCode, numericVolume };
