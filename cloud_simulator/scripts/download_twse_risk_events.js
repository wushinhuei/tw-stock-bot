'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeField } = require('./backfill_twse_analysis');

const START_YEAR = Number(process.env.START_YEAR || 2016);
const END_YEAR = Number(process.env.END_YEAR || 2026);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'tmp/twse-risk-events');
const universe = new Set(require('../data/twse_top50_ever_2016_2025.json').symbols);
const DATASETS = {
  notice: { api: '/announcement/notice', params: '&querytype=1&selectType=ALL&sortKind=DATE', code: '證券代號', dateField: '日期', source: 'TWSE_NOTICE' },
  disposition: { api: '/announcement/punish', params: '&querytype=1&selectType=ALL&proceType=&remarkType=&sortKind=DATE', code: '證券代號', dateField: '公布日期', source: 'TWSE_PUNISH' }
};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function uniqueFields(fields) {
  const seen = new Map();
  return fields.map(field => { const base = normalizeField(field); const count = (seen.get(base) || 0) + 1; seen.set(base, count); return count === 1 ? base : `${base}_${count}`; });
}
function rocDate(value) {
  const match = String(value || '').trim().match(/^(\d{3})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
  return match ? `${Number(match[1]) + 1911}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : '';
}
async function fetchYear(name, definition, year) {
  const url = `https://wwwc.twse.com.tw/rwd/zh${definition.api}?response=json&startDate=${year}0101&endDate=${year}1231${definition.params}`;
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tw-stock-bot-risk-events/1.0' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${name} ${year}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.stat !== 'OK') return { rows: [], url, status: 'NO_DATA' };
  const fields = uniqueFields(payload.fields || []);
  const rawCodeIndex = (payload.fields || []).findIndex(field => String(field).replace(/\s/g, '') === definition.code);
  const rawDateIndex = (payload.fields || []).findIndex(field => String(field).replace(/\s/g, '') === definition.dateField);
  const rows = (payload.data || []).map(row => { const eventDate = rocDate(row[rawDateIndex]); return ({ dataset: name, stock_code: String(row[rawCodeIndex] || '').trim(),
    event_date: eventDate, source: definition.source, source_url: url, available_from: eventDate ? `${eventDate}T20:30:00+08:00` : '',
    values: Object.fromEntries(fields.map((field, index) => [field, row[index]])) }); })
    .filter(row => universe.has(row.stock_code));
  return { rows, url, status: 'OK' };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = {};
  const errors = [];
  let totalRows = 0;
  for (const [name, definition] of Object.entries(DATASETS)) {
    files[name] = {};
    for (let year = START_YEAR; year <= END_YEAR; year += 1) {
      try {
        const result = await fetchYear(name, definition, year);
        const content = `${result.rows.map(row => JSON.stringify(row)).join('\n')}${result.rows.length ? '\n' : ''}`;
        const fileName = `${name}_${year}.jsonl`;
        fs.writeFileSync(path.join(OUTPUT_DIR, fileName), content);
        files[name][year] = { file: fileName, rows: result.rows.length, sha256: crypto.createHash('sha256').update(content).digest('hex'), source_url: result.url };
        totalRows += result.rows.length;
      } catch (error) { errors.push({ dataset: name, year, error: String(error.message || error) }); }
      await sleep(1000);
    }
  }
  const manifest = { generated_at: new Date().toISOString(), status: errors.length ? 'incomplete' : 'complete', provider: 'Taiwan Stock Exchange',
    period: { start: `${START_YEAR}-01-01`, end: `${END_YEAR}-12-31` }, datasets: DATASETS, universe: '曾進入TWSE_TOP50的股票',
    record_count: totalRows, files, errors, point_in_time_rule: 'available_from使用逐筆公告日期盤後20:30，回測與交易不得提前使用。' };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.status !== 'complete') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { DATASETS, fetchYear, rocDate, uniqueFields };
