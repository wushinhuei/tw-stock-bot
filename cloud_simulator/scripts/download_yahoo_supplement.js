'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DriveHistorySource } = require('../src/drive_history');
const { fetchSupplementalHistory } = require('../src/yahoo');

function argumentsMap(argv) {
  return Object.fromEntries(argv.filter(item => item.startsWith('--')).map(item => {
    const [key, ...value] = item.slice(2).split('=');
    return [key, value.length ? value.join('=') : true];
  }));
}

function dateOf(row) { return String(row.tradeDate || row.timestamp || '').slice(0, 10); }

function compareDailyBars(officialBars, yahooBars, options = {}) {
  const priceTolerance = Number(options.priceTolerance ?? 0.005);
  const volumeTolerance = Number(options.volumeTolerance ?? 0.05);
  const official = new Map((officialBars || []).map(row => [dateOf(row), row]));
  const yahoo = new Map((yahooBars || []).map(row => [dateOf(row), row]));
  const missingDates = [...official.keys()].filter(date => !yahoo.has(date)).sort();
  const extraDates = [...yahoo.keys()].filter(date => !official.has(date)).sort();
  const priceDifferences = [];
  const volumeDifferences = [];
  for (const [date, source] of official) {
    const supplement = yahoo.get(date);
    if (!supplement) continue;
    const closeBase = Number(source.close);
    const volumeBase = Number(source.volume || 0);
    const closePct = closeBase ? Math.abs(Number(supplement.close) - closeBase) / closeBase : 0;
    const volumePct = volumeBase ? Math.abs(Number(supplement.volume || 0) - volumeBase) / volumeBase : 0;
    if (closePct > priceTolerance) priceDifferences.push({ date, official: closeBase, yahoo: Number(supplement.close), differencePct: closePct });
    if (volumePct > volumeTolerance) volumeDifferences.push({ date, official: volumeBase, yahoo: Number(supplement.volume || 0), differencePct: volumePct });
  }
  return { missingDates, extraDates, priceDifferences, volumeDifferences, passed: missingDates.length === 0 && priceDifferences.length === 0 };
}

function jsonl(rows) { return `${(rows || []).map(row => JSON.stringify(row)).join('\n')}${rows?.length ? '\n' : ''}`; }
function writeJsonl(file, rows) { fs.writeFileSync(file, jsonl(rows)); }

async function mapLimited(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { symbol: items[index], status: 'error', error: String(error.message || error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function isRecent(timestamp, maximumAgeDays, now = new Date()) {
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && now.getTime() - time <= maximumAgeDays * 86400000;
}

async function downloadYahooSupplement(options = {}) {
  const outputDir = path.resolve(options.outputDir || 'tmp/yahoo-supplement');
  const symbols = [...new Set((options.symbols || []).map(String).map(item => item.trim()).filter(item => /^\d{4,6}(?:\.TW)?$/i.test(item)))];
  if (!symbols.length) throw new Error('至少需要一個台股代號（--symbols=2330,2303 或 SYMBOLS）');
  fs.mkdirSync(outputDir, { recursive: true });
  const drive = options.compareDrive ? (options.drive || new DriveHistorySource()) : null;
  const end = new Date().toISOString().slice(0, 10);
  const start = `${Number(end.slice(0, 4)) - 5}${end.slice(4)}`;
  const results = await mapLimited(symbols, Math.max(1, Number(options.concurrency || 3)), async symbol => {
    const code = symbol.replace(/\.TW$/i, '');
    const summaryFile = path.join(outputDir, `${code}_summary.json`);
    if (options.resume !== false && fs.existsSync(summaryFile)) {
      const previous = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
      if (previous.status === 'complete' && previous.fetched_at?.slice(0, 10) === end) return { ...previous, resumed: true };
    }
    const data = await (options.fetchHistory || fetchSupplementalHistory)(symbol, options);
    let comparison = null;
    if (drive) comparison = compareDailyBars(await drive.dailyBars(code, start, end), data.dailyBars, options);
    const warnings = [];
    if (!data.dailyBars.length) warnings.push('Yahoo日線為空');
    if (!data.bars5m.length) warnings.push('Yahoo五分鐘線為空');
    if (data.dailyBars.length && !isRecent(data.dailyBars.at(-1).timestamp, 10, options.now)) warnings.push('Yahoo日線時間戳過期');
    if (data.bars5m.length && !isRecent(data.bars5m.at(-1).timestamp, 10, options.now)) warnings.push('Yahoo盤中線時間戳過期');
    if (comparison && !comparison.passed) warnings.push('Yahoo與TWSE官方日線不一致');
    writeJsonl(path.join(outputDir, `${code}_daily.jsonl`), data.dailyBars);
    writeJsonl(path.join(outputDir, `${code}_5m.jsonl`), data.bars5m);
    writeJsonl(path.join(outputDir, `${code}_15m.jsonl`), data.bars15m);
    writeJsonl(path.join(outputDir, `${code}_events.jsonl`), data.events);
    const summary = { symbol: code, yahoo_symbol: data.yahooSymbol, provider: data.provider, fetched_at: data.fetchedAt,
      status: warnings.length ? 'incomplete' : 'complete', rows: { daily: data.dailyBars.length, bars_5m: data.bars5m.length, bars_15m: data.bars15m.length, events: data.events.length },
      official_data_overwritten: false, comparison, warnings };
    fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  });
  const errors = results.filter(item => item.status === 'error');
  const warnings = results.filter(item => item.status === 'incomplete');
  const manifest = { dataset: 'YAHOO_SUPPLEMENT', generated_at: new Date().toISOString(), provider: 'Yahoo Finance Chart API',
    role: 'supplement_only', official_data_overwritten: false, symbols_requested: symbols.length,
    status: errors.length || warnings.length ? 'incomplete' : 'complete', complete: results.filter(item => item.status === 'complete').length,
    warnings: warnings.map(item => ({ symbol: item.symbol, warnings: item.warnings })), errors, results };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const args = argumentsMap(process.argv.slice(2));
  const symbols = String(args.symbols || process.env.SYMBOLS || '').split(',');
  downloadYahooSupplement({ symbols, outputDir: args.output || process.env.OUTPUT_DIR, concurrency: args.concurrency || process.env.CONCURRENCY,
    compareDrive: args['compare-drive'] === true || args['compare-drive'] === '1' || process.env.COMPARE_DRIVE === '1', resume: args.resume !== '0' })
    .then(manifest => { console.log(JSON.stringify({ status: manifest.status, complete: manifest.complete, warnings: manifest.warnings.length, errors: manifest.errors.length })); if (manifest.errors.length) process.exitCode = 1; })
    .catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { argumentsMap, compareDailyBars, downloadYahooSupplement, isRecent, jsonl, mapLimited };
