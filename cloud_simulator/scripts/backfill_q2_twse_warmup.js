'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { callTool } = require('../src/twse_mcp_history');

const START = process.env.Q2_WARMUP_DAILY_START || '2025-10-01';
const END = process.env.Q2_WARMUP_DAILY_END || '2026-06-30';
const UNIVERSE = path.resolve(process.env.INTRADAY_UNIVERSE_OUTPUT || 'data/backtest/2026Q2/q2_top100_union.json');
const OUTPUT = path.resolve(process.env.Q2_WARMUP_OUTPUT || 'data/backtest/2026Q2/twse-daily-warmup');
const DELAY_MS = Number(process.env.TWSE_WARMUP_DELAY_MS || 350);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function readUniverse() {
  if (!fs.existsSync(UNIVERSE)) throw new Error(`missing acquisition universe: ${UNIVERSE}`);
  const payload = JSON.parse(fs.readFileSync(UNIVERSE, 'utf8'));
  return (payload.symbols || []).map(row => String(row.symbol || row)).filter(symbol => /^[1-9]\d{3}$/.test(symbol));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const symbols = readUniverse();
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'TWSE_MCP_PRIMARY',
    purpose: 'daily/weekly indicator warmup for frozen 2026Q2 strict replay',
    period: { start: START, end: END },
    requestedSymbols: symbols.length,
    completeSymbols: [],
    insufficientSymbols: [],
    errors: {}
  };
  fs.mkdirSync(OUTPUT, { recursive: true });

  for (let i = 0; i < symbols.length; i += 1) {
    const symbol = symbols[i];
    const file = path.join(OUTPUT, `${symbol}.json`);
    try {
      let result;
      if (fs.existsSync(file) && process.env.REFRESH !== '1') result = JSON.parse(fs.readFileSync(file, 'utf8'));
      else {
        result = await callTool('twse_stock_daily', { symbol, start: START, end: END });
        writeJson(file, result);
        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
      const count = Array.isArray(result.rows) ? result.rows.length : 0;
      if (count >= 120) manifest.completeSymbols.push(symbol);
      else manifest.insufficientSymbols.push({ symbol, rows: count });
      process.stdout.write(`[warmup ${i + 1}/${symbols.length}] ${symbol} rows=${count}\n`);
    } catch (error) {
      manifest.errors[symbol] = String(error.message || error);
      process.stderr.write(`[warmup ${i + 1}/${symbols.length}] ${symbol} ERROR ${error}\n`);
    }
    manifest.generatedAt = new Date().toISOString();
    writeJson(path.join(OUTPUT, 'manifest.json'), manifest);
  }

  manifest.completeCount = manifest.completeSymbols.length;
  manifest.insufficientCount = manifest.insufficientSymbols.length;
  manifest.errorCount = Object.keys(manifest.errors).length;
  manifest.status = manifest.errorCount === 0 && manifest.insufficientCount === 0 ? 'complete' : 'partial';
  writeJson(path.join(OUTPUT, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.status !== 'complete') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
