'use strict';

const fs = require('node:fs');
const { buildQuarterlyXbrlHistory } = require('../src/mops_history');
const { parseCsv } = require('../src/drive_history');

function readCsvIfConfigured(name) {
  const file = process.env[name];
  return file && fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
}

function readTop50Symbols() {
  const file = process.env.TOP50_SYMBOLS_JSON || 'cloud_simulator/data/twse_top50_ever_2016_2025.json';
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(payload.symbols) || !payload.symbols.length) throw new Error('TOP50 symbols snapshot is empty');
  return payload.symbols;
}

buildQuarterlyXbrlHistory({
  startYear: process.env.START_YEAR || 2016,
  endYear: process.env.END_YEAR || 2025,
  quarters: process.env.QUARTERS ? process.env.QUARTERS.split(',').map(Number) : [1, 2, 3, 4],
  outputDir: process.env.OUTPUT_DIR || 'tmp/mops-history',
  symbols: readTop50Symbols(),
  filingRows: readCsvIfConfigured('MOPS_FILING_INDEX_CSV'),
  monthlyRevenueComplete: process.env.MONTHLY_REVENUE_COMPLETE === '1',
  majorMessagesComplete: process.env.MAJOR_MESSAGES_COMPLETE === '1',
  removeArchivesAfterParse: process.env.REMOVE_XBRL_AFTER_PARSE === '1',
  onQuarter: progress => console.log(JSON.stringify({ event: 'mops-xbrl-quarter', ...progress }))
}).then(result => {
  const validation = result.manifest.validation;
  console.log(JSON.stringify({ event: 'mops-xbrl-history', status: result.manifest.status, checks: validation.checks, counts: validation.counts }));
  if (!validation.passed) process.exitCode = 2;
}).catch(error => { console.error(error); process.exitCode = 1; });
