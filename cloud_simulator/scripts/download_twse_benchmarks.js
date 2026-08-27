'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse0050, parseTaiex, toCsv, validateBenchmarks } = require('../src/benchmark_history');

const START = process.env.START_DATE || '2016-08-25';
const END = process.env.END_DATE || new Date().toISOString().slice(0, 10);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'tmp/twse-benchmarks');
const DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 450);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function monthsBetween(start, end) {
  const result = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= last) {
    result.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

async function getJson(url, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tw-stock-bot-benchmark/1.0' }, signal: AbortSignal.timeout(30000) });
    if (response.ok) return response.json();
    if (attempt === attempts) throw new Error(`HTTP ${response.status}: ${url}`);
    await sleep(Math.max(1000 * attempt, response.status === 429 ? 30000 : 0));
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const rows = [];
  const errors = [];
  const months = monthsBetween(START, END);
  for (let index = 0; index < months.length; index += 1) {
    const date = months[index];
    const stockUrl = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=0050`;
    const indexUrl = `https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${date}`;
    try {
      rows.push(...parse0050(await getJson(stockUrl)), ...parseTaiex(await getJson(indexUrl)));
    } catch (error) {
      errors.push({ month: date.slice(0, 6), error: String(error.message || error) });
    }
    if ((index + 1) % 12 === 0 || index + 1 === months.length) process.stderr.write(`${index + 1}/${months.length} months\n`);
    await sleep(DELAY_MS);
  }

  const unique = [...new Map(rows.filter(row => row.trade_date >= START && row.trade_date <= END)
    .map(row => [`${row.trade_date}:${row.benchmark_id}`, row])).values()]
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.benchmark_id.localeCompare(b.benchmark_id));
  const files = {};
  for (const year of [...new Set(unique.map(row => row.trade_date.slice(0, 4)))]) {
    const fileName = `twse_benchmarks_${year}.csv`;
    const content = toCsv(unique.filter(row => row.trade_date.startsWith(year)));
    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), content);
    files[year] = { file: fileName, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  }
  const validation = validateBenchmarks(unique, START, END);
  const manifest = {
    generated_at: new Date().toISOString(), status: validation.passed && errors.length === 0 ? 'complete' : 'incomplete',
    provider: 'Taiwan Stock Exchange', dataset: 'TWSE_BENCHMARKS', period: { start: START, end: END },
    sources: {
      '0050': 'https://www.twse.com.tw/zh/trading/historical/stock-day.html',
      TAIEX: 'https://www.twse.com.tw/zh/trading/historical/mi-index.html',
      cross_check_only: 'https://goodinfo.tw/tw/StockIdxDetail.asp?STOCK_ID=加權指數'
    },
    price_basis: { '0050': '未還原權息ETF收盤價', TAIEX: '發行量加權股價指數（價格指數）' },
    files, errors, validation,
    caveats: ['0050尚未納入現金股利再投資；比較總報酬時需另建還原權息或股利再投資序列。', 'Goodinfo僅供人工交叉查核，未作批次爬取。']
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.status !== 'complete') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { getJson, monthsBetween };
