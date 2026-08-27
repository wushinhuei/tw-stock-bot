'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeField } = require('./backfill_twse_analysis');

const START_YEAR = Number(process.env.START_YEAR || 2016);
const END_YEAR = Number(process.env.END_YEAR || 2026);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'tmp/twse-execution-history');
const universe = new Set(require('../data/twse_top50_ever_2016_2025.json').symbols);
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function uniqueFields(fields) { const seen = new Map(); return fields.map(field => { const base = normalizeField(field); const n = (seen.get(base) || 0) + 1; seen.set(base, n); return n === 1 ? base : `${base}_${n}`; }); }
function rowsFrom(fields, data, metadata = {}) { const names = uniqueFields(fields); return (data || []).map(row => ({ ...metadata, values: Object.fromEntries(names.map((name, index) => [name, row[index]])) })); }
async function json(url) { const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tw-stock-bot-execution-history/1.0' }, signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
function write(file, rows) { const content = `${rows.map(row => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`; fs.writeFileSync(file, content); return { file: path.basename(file), rows: rows.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }; }

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = { tradingHalt: {}, dayTradeSuspend: {}, dayTradeMarket: {} };
  const errors = [];
  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    const startDate = `${year}0101`; const endDate = `${year}1231`;
    try {
      const haltUrl = `https://wwwc.twse.com.tw/rwd/zh/afterTrading/TWTAWU?response=json&startDate=${startDate}&endDate=${endDate}&querytype=0&stockNo=&selectType=ALL`;
      const payload = await json(haltUrl); const fields = payload.fields || []; const codeIndex = fields.findIndex(field => String(field).replace(/\s/g, '') === '證券代號');
      const rows = rowsFrom(fields, payload.data, { dataset: 'tradingHalt', source: 'TWSE_TWTAWU', source_url: haltUrl }).filter((row, index) => universe.has(String(payload.data[index][codeIndex]).trim()));
      files.tradingHalt[year] = write(path.join(OUTPUT_DIR, `trading_halt_${year}.jsonl`), rows);
    } catch (error) { errors.push({ dataset: 'tradingHalt', year, error: String(error.message || error) }); }
    await sleep(900);
    try {
      const suspendUrl = `https://wwwc.twse.com.tw/rwd/zh/dayTrading/TWTBAU2?response=json&startDate=${startDate}&endDate=${endDate}&stockNo=`;
      const payload = await json(suspendUrl); const fields = payload.fields || []; const codeIndex = fields.findIndex(field => String(field).replace(/\s/g, '') === '股票代號');
      const rows = rowsFrom(fields, payload.data, { dataset: 'dayTradeSuspend', source: 'TWSE_TWTBAU2', source_url: suspendUrl }).filter((row, index) => universe.has(String(payload.data[index][codeIndex]).trim()));
      files.dayTradeSuspend[year] = write(path.join(OUTPUT_DIR, `day_trade_suspend_${year}.jsonl`), rows);
    } catch (error) { errors.push({ dataset: 'dayTradeSuspend', year, error: String(error.message || error) }); }
    await sleep(900);
  }
  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    const rows = [];
    for (let month = 1; month <= 12; month += 1) {
      const date = `${year}${String(month).padStart(2, '0')}01`;
      const url = `https://wwwc.twse.com.tw/rwd/zh/dayTrading/TWTB4U2?response=json&date=${date}&stockNo=`;
      try { const payload = await json(url); const table = (payload.tables || [])[0]; if (table?.fields) rows.push(...rowsFrom(table.fields, table.data, { dataset: 'dayTradeMarket', source: 'TWSE_TWTB4U2', source_url: url })); }
      catch (error) { errors.push({ dataset: 'dayTradeMarket', month: date.slice(0, 6), error: String(error.message || error) }); }
      await sleep(700);
    }
    files.dayTradeMarket[year] = write(path.join(OUTPUT_DIR, `day_trade_market_${year}.jsonl`), rows);
  }
  const recordCount = Object.values(files).flatMap(group => Object.values(group)).reduce((sum, item) => sum + item.rows, 0);
  const manifest = { generated_at: new Date().toISOString(), status: errors.length ? 'incomplete' : 'complete', provider: 'Taiwan Stock Exchange',
    period: { start: `${START_YEAR}-01-01`, end: `${END_YEAR}-12-31` }, record_count: recordCount, files, errors,
    datasets: { tradingHalt: '暫停及恢復交易日期時間', dayTradeSuspend: '暫停先賣後買當沖期間與原因', dayTradeMarket: '每月逐日市場當沖成交量值與比率' },
    caveats: ['零股不適用現股當日沖銷；此資料僅供資格與市場熱度分析。'] };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`); process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`); if (errors.length) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { rowsFrom, uniqueFields };
