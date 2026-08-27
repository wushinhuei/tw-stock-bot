'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const START = process.env.START_DATE || '2023-08-25';
const END = process.env.END_DATE || '2026-08-24';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'tmp/twse-history');
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1100);
const RATE_LIMIT_WAIT_MS = Number(process.env.RATE_LIMIT_WAIT_MS || 65000);

function compact(date) { return date.replaceAll('-', ''); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function number(value) {
  const cleaned = String(value ?? '').replaceAll(',', '').replace(/[+X]/g, '').trim();
  if (!cleaned || cleaned === '--') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function datesBetween(start, end) {
  const dates = [];
  for (let current = new Date(`${start}T00:00:00Z`); current <= new Date(`${end}T00:00:00Z`); current.setUTCDate(current.getUTCDate() + 1)) {
    const weekday = current.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchDay(date, attempts = 8) {
  const url = `https://wwwc.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${compact(date)}&type=ALLBUT0999`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tw-stock-bot-backtest/1.0' } });
    if (response.ok) {
      const payload = await response.json();
      if (payload.stat !== 'OK') {
        const status = payload.stat || 'NO_DATA';
        if (/沒有符合條件的資料|查無資料/.test(status)) return { date, rows: [], status: 'NO_DATA', url };
        if (attempt === attempts) throw new Error(`${date}: TWSE ${status}`);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      const table = (payload.tables || []).find(item => item.fields?.includes('證券代號') && item.fields?.includes('成交股數'));
      if (!table) return { date, rows: [], status: 'NO_STOCK_TABLE', url };
      const index = Object.fromEntries(table.fields.map((field, i) => [field.replace(/\s/g, ''), i]));
      const rows = table.data.map(row => ({
        date,
        symbol: String(row[index['證券代號']] || '').trim(),
        name: String(row[index['證券名稱']] || '').trim(),
        volume: number(row[index['成交股數']]),
        trades: number(row[index['成交筆數']]),
        value: number(row[index['成交金額']]),
        open: number(row[index['開盤價']]),
        high: number(row[index['最高價']]),
        low: number(row[index['最低價']]),
        close: number(row[index['收盤價']]),
        change: number(row[index['漲跌價差']]),
        bid: number(row[index['最後揭示買價']]),
        ask: number(row[index['最後揭示賣價']]),
        pe: number(row[index['本益比']]),
        source: 'TWSE_MI_INDEX',
        sourceUrl: url
      })).filter(row => /^\d{4}$/.test(row.symbol) && row.close != null);
      return { date, rows, status: 'OK', url };
    }
    if (attempt === attempts) throw new Error(`${date}: HTTP ${response.status}`);
    await sleep(response.status === 403 || response.status === 429 ? RATE_LIMIT_WAIT_MS : 1000 * attempt);
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const days = datesBetween(START, END);
  const outputPath = path.join(OUTPUT_DIR, `twse-mi-index-${START}-to-${END}.jsonl.gz`);
  const errorPath = path.join(OUTPUT_DIR, `twse-mi-index-${START}-to-${END}-errors.json`);
  const gzip = zlib.createGzip({ level: 9 });
  const destination = fs.createWriteStream(outputPath);
  gzip.pipe(destination);
  const errors = [];
  let tradingDays = 0;
  let rowCount = 0;

  for (let i = 0; i < days.length; i += 1) {
    const result = await fetchDay(days[i]).catch(error => ({ date: days[i], rows: [], status: String(error) }));
    if (result.status === 'OK') {
      tradingDays += 1;
      rowCount += result.rows.length;
      for (const row of result.rows) gzip.write(`${JSON.stringify(row)}\n`);
    } else if (result.status !== 'NO_DATA') {
      errors.push({ date: result.date, status: result.status });
    }
    if ((i + 1) % 25 === 0 || i + 1 === days.length) {
      process.stderr.write(`${i + 1}/${days.length} weekdays, ${tradingDays} trading days, ${rowCount} rows\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  gzip.end();
  await new Promise((resolve, reject) => destination.on('close', resolve).on('error', reject));
  fs.writeFileSync(errorPath, `${JSON.stringify(errors, null, 2)}\n`);
  const manifest = {
    generatedAt: new Date().toISOString(),
    period: { start: START, end: END },
    provider: 'Taiwan Stock Exchange',
    dataset: 'MI_INDEX ALLBUT0999',
    officialPage: 'https://www.twse.com.tw/zh/trading/historical/mi-index.html',
    stockDayCrossCheck: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html',
    contents: 'Listed common-stock daily OHLC, volume, value, trades, closing bid/ask and PE when available.',
    tradingDays,
    rowCount,
    errors,
    caveats: [
      'Raw prices are not adjusted for dividends, splits or capital reductions.',
      'Only four-digit numeric symbols with a valid close are retained.',
      'Intraday 5-minute bars, historical news, fundamentals and point-in-time industry membership are not included.'
    ],
    file: path.basename(outputPath)
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
