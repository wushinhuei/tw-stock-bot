'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildCumulativeFactors, parseCorporateActions } = require('../src/corporate_actions');

const START_YEAR = Number(process.env.START_YEAR || 2016);
const END_YEAR = Number(process.env.END_YEAR || 2026);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'tmp/twse-corporate-actions');
const universe = new Set([...require('../data/twse_top50_ever_2016_2025.json').symbols, '0050']);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function csv(rows, fields) {
  const quote = value => /[",\n]/.test(String(value ?? '')) ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '');
  return `${fields.join(',')}\n${rows.map(row => fields.map(field => quote(row[field])).join(',')).join('\n')}\n`;
}

async function yearRows(year) {
  const url = `https://wwwc.twse.com.tw/rwd/zh/exRight/TWT49U?response=json&startDate=${year}0101&endDate=${year}1231`;
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tw-stock-bot-corporate-actions/1.0' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${year}: HTTP ${response.status}`);
  return { rows: parseCorporateActions(await response.json()), url };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const allRows = [];
  const errors = [];
  const sources = [];
  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    try {
      const result = await yearRows(year);
      allRows.push(...result.rows.filter(row => universe.has(row.stock_code)));
      sources.push(result.url);
    } catch (error) { errors.push({ year, error: String(error.message || error) }); }
    await sleep(1000);
  }
  const rows = [...new Map(allRows.map(row => [`${row.stock_code}:${row.action_date}:${row.action_type}`, row])).values()]
    .sort((a, b) => a.action_date.localeCompare(b.action_date) || a.stock_code.localeCompare(b.stock_code));
  const actionFields = ['action_date', 'stock_code', 'stock_name', 'action_type', 'previous_close', 'reference_price', 'rights_dividend_value', 'limit_up', 'limit_down', 'auction_base', 'ex_dividend_reference', 'detail_key', 'adjustment_factor', 'source'];
  const factorFields = ['stock_code', 'action_date', 'action_type', 'event_factor', 'cumulative_factor_before_date', 'source'];
  const actionContent = csv(rows, actionFields);
  const factorContent = csv(buildCumulativeFactors(rows), factorFields);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'corporate_actions.csv'), actionContent);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'adjustment_factors.csv'), factorContent);
  const manifest = {
    generated_at: new Date().toISOString(), status: errors.length ? 'incomplete' : 'complete',
    period: { start: `${START_YEAR}-01-01`, end: `${END_YEAR}-12-31` }, provider: 'Taiwan Stock Exchange',
    dataset: 'TWSE_CORPORATE_ACTIONS', official_page: 'https://www.twse.com.tw/zh/announcement/ex-right/twt49u.html',
    source_endpoints: sources, universe: '曾進入TWSE_TOP50的股票，加上0050', record_count: rows.length,
    symbol_count: new Set(rows.map(row => row.stock_code)).size, errors,
    files: {
      corporate_actions: { file: 'corporate_actions.csv', sha256: crypto.createHash('sha256').update(actionContent).digest('hex') },
      adjustment_factors: { file: 'adjustment_factors.csv', sha256: crypto.createHash('sha256').update(factorContent).digest('hex') }
    },
    adjustment_method: '事件日前價格乘以 reference_price / previous_close；多次事件採連乘。',
    caveats: ['此因子消除除權息機械性跳空，非報價替代品。', '完整還原股價需與stock_daily逐日合併後另存 adjusted OHLCV。', '減資、分割及合併等非TWT49U事件需由其他官方公司行動資料表補齊。']
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.status !== 'complete') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { yearRows };
