'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const START = process.env.START_DATE || '2016-08-25';
const END = process.env.END_DATE || '2026-08-25';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'tmp/twse-analysis-db');
const MAX_DATES = Math.max(1, Number(process.env.MAX_DATES || 20));
const DELAY_MS = Math.max(800, Number(process.env.REQUEST_DELAY_MS || 1200));
const universe = new Set([...require('../data/twse_top50_ever_2016_2025.json').symbols, '0050']);

const DATASETS = Object.freeze({
  institutional: { api: '/fund/T86', params: '&selectType=ALL', codeField: '證券代號', nameField: '證券名稱', source: 'TWSE_T86' },
  margin: { api: '/marginTrading/MI_MARGN', params: '&selectType=ALL', codeField: '代號', nameField: '名稱', source: 'TWSE_MI_MARGN' },
  shortLending: { api: '/marginTrading/TWT93U', params: '', codeField: '代號', nameField: '名稱', source: 'TWSE_TWT93U' },
  valuation: { api: '/afterTrading/BWIBBU_d', params: '&selectType=ALL', codeField: '證券代號', nameField: '證券名稱', source: 'TWSE_BWIBBU_D' }
});

function compact(date) { return date.replaceAll('-', ''); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function weekdays(start, end) {
  const result = [];
  for (const cursor = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (![0, 6].includes(cursor.getUTCDay())) result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}
function normalizeField(value) { return String(value || '').replace(/\s+/g, '').replace(/[()（）/%]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }
function payloadTable(payload, codeField = '') {
  if (payload.fields && payload.data) return { fields: payload.fields, data: payload.data };
  const compactCode = String(codeField).replace(/\s/g, '');
  const table = (payload.tables || []).find(item => item.fields?.some(field => String(field).replace(/\s/g, '') === compactCode) && item.data)
    || (payload.tables || []).find(item => item.fields && item.data);
  return table || { fields: [], data: [] };
}
function records(payload, definition, date) {
  const table = payloadTable(payload, definition.codeField);
  const rawIndexes = Object.fromEntries(table.fields.map((field, index) => [String(field).replace(/\s/g, ''), index]));
  return table.data.map(row => {
    const stockCode = String(row[rawIndexes[definition.codeField]] || '').trim();
    const seen = new Map();
    const values = Object.fromEntries(table.fields.map((field, index) => {
      const base = normalizeField(field);
      const occurrence = (seen.get(base) || 0) + 1;
      seen.set(base, occurrence);
      return [occurrence === 1 ? base : `${base}_${occurrence}`, row[index]];
    }));
    return { trade_date: date, stock_code: stockCode, stock_name: String(row[rawIndexes[definition.nameField]] || '').trim(),
      source: definition.source, source_available_at: `${date}T20:30:00+08:00`, values };
  }).filter(row => universe.has(row.stock_code));
}

async function fetchDataset(name, definition, date, attempts = 4) {
  const url = `https://wwwc.twse.com.tw/rwd/zh${definition.api}?response=json&date=${compact(date)}${definition.params}`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tw-stock-bot-analysis-backfill/1.0' }, signal: AbortSignal.timeout(45000) });
    if (response.ok) {
      const payload = await response.json();
      if (payload.stat === 'OK') {
        const rows = records(payload, definition, date);
        return { status: rows.length ? 'OK' : 'NO_DATA', rows, url };
      }
      if (/沒有符合條件|查無資料/.test(String(payload.stat))) return { status: 'NO_DATA', rows: [], url };
    }
    if (response.status === 403 || response.status === 429) throw new Error(`${name} ${date}: RATE_LIMIT_${response.status}`);
    if (attempt < attempts) await sleep(1500 * attempt);
  }
  throw new Error(`${name} ${date}: download failed`);
}

function saveSnapshot(name, date, result) {
  const dir = path.join(OUTPUT_DIR, 'raw', name, date.slice(0, 4));
  fs.mkdirSync(dir, { recursive: true });
  const body = `${result.rows.map(row => JSON.stringify(row)).join('\n')}${result.rows.length ? '\n' : ''}`;
  const gz = zlib.gzipSync(body, { level: 9 });
  const file = path.join(dir, `${date}.jsonl.gz`);
  fs.writeFileSync(file, gz);
  return { file: path.relative(OUTPUT_DIR, file).replaceAll('\\', '/'), rows: result.rows.length,
    sha256: crypto.createHash('sha256').update(gz).digest('hex'), source_url: result.url, status: result.status };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const checkpointPath = path.join(OUTPUT_DIR, 'checkpoint.json');
  const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : { completed: {}, errors: [] };
  for (const [date, datasets] of Object.entries(checkpoint.completed)) {
    if (Object.keys(DATASETS).some(name => !datasets[name] || (datasets[name].status === 'OK' && datasets[name].rows === 0))) delete checkpoint.completed[date];
  }
  const pending = weekdays(START, END).filter(date => !checkpoint.completed[date]).slice(0, MAX_DATES);
  for (const date of pending) {
    const day = {};
    try {
      for (const [name, definition] of Object.entries(DATASETS)) {
        const result = await fetchDataset(name, definition, date);
        day[name] = saveSnapshot(name, date, result);
        await sleep(DELAY_MS);
      }
      checkpoint.completed[date] = day;
      fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
      process.stderr.write(`${date}: complete\n`);
    } catch (error) {
      checkpoint.errors.push({ date, error: String(error.message || error), at: new Date().toISOString() });
      fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
      process.stderr.write(`${date}: ${error.message}\n`);
      if (/RATE_LIMIT/.test(String(error.message))) break;
    }
  }
  const totalWeekdays = weekdays(START, END).length;
  const manifest = { generated_at: new Date().toISOString(), status: Object.keys(checkpoint.completed).length >= totalWeekdays ? 'complete' : 'backfill_in_progress',
    period: { start: START, end: END }, datasets: DATASETS, universe: '曾進入TWSE_TOP50的股票，加上0050',
    completed_dates: Object.keys(checkpoint.completed).length, total_weekdays: totalWeekdays, remaining_dates: totalWeekdays - Object.keys(checkpoint.completed).length,
    error_count: checkpoint.errors.length, storage_format: '按資料集/年度/日期分層的gzip JSONL；完成後彙整年度檔。',
    point_in_time_rule: 'source_available_at固定於交易日盤後20:30，避免盤中或回測偷看當日盤後資料。' };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { DATASETS, compact, normalizeField, payloadTable, records, weekdays };
