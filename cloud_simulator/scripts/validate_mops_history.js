'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { attachFilingTimes, dedupeCompanyQuarters, validateMopsCompleteness, xbrlArchiveUrl } = require('../src/mops_history');
const { parseCsv } = require('../src/drive_history');

const startYear = Number(process.env.START_YEAR || 2016);
const endYear = Number(process.env.END_YEAR || 2025);
const outputDir = path.resolve(process.env.OUTPUT_DIR || 'tmp/mops-history-2016-2025');
const filingRows = process.env.MOPS_FILING_INDEX_CSV && fs.existsSync(process.env.MOPS_FILING_INDEX_CSV)
  ? parseCsv(fs.readFileSync(process.env.MOPS_FILING_INDEX_CSV, 'utf8')) : [];
const records = [];
const archives = [];
const quarters = [];
const duplicateKeys = [];
const seen = new Set();

for (let year = startYear; year <= endYear; year += 1) {
  for (const quarter of [1, 2, 3, 4]) {
    const file = path.join(outputDir, 'staging', `quarterly_${year}Q${quarter}.jsonl`);
    const rows = fs.existsSync(file) && fs.statSync(file).size > 2
      ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
    let emptyCoreFacts = 0;
    for (const row of rows) {
      const key = `${row.stock_code}:${row.fiscal_year}:Q${row.quarter}`;
      if (seen.has(key)) duplicateKeys.push(key); else seen.add(key);
      if (!Array.isArray(row.facts) || !row.facts.length) emptyCoreFacts += 1;
    }
    records.push(...rows);
    archives.push({ year, quarter, name: `tifrs-${year}Q${quarter}.zip`, source_url: xbrlArchiveUrl(year, quarter) });
    quarters.push({ year, quarter, rows: rows.length, empty_core_facts: emptyCoreFacts, present: rows.length > 0 });
  }
}

const normalized = dedupeCompanyQuarters(records);
const financials = attachFilingTimes(normalized.records, filingRows);
const validation = validateMopsCompleteness({
  expectedArchives: (endYear - startYear + 1) * 4,
  archives: archives.filter((_, index) => quarters[index].present), financials,
  monthlyRevenueComplete: process.env.MONTHLY_REVENUE_COMPLETE === '1',
  majorMessagesComplete: process.env.MAJOR_MESSAGES_COMPLETE === '1'
});
validation.checks.nonempty_quarters = quarters.every(item => item.present);
validation.checks.core_facts = quarters.every(item => item.empty_core_facts === 0);
validation.checks.unique_company_quarters = financials.length === seen.size;
validation.passed = Object.values(validation.checks).every(Boolean);

const report = {
  dataset: 'MOPS_10Y', generated_at: new Date().toISOString(), start_year: startYear, end_year: endYear,
  status: validation.passed ? 'complete' : 'incomplete', backtest_allowed: validation.passed,
  validation, normalization: { rule: 'cr_then_ir_then_er_then_most_core_facts', suppressed_records: normalized.suppressed.length },
  duplicate_keys: [...new Set(duplicateKeys)].slice(0, 100), quarters
};
fs.writeFileSync(path.join(outputDir, 'mops_10y_validation.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, backtest_allowed: report.backtest_allowed, checks: validation.checks, counts: validation.counts }));
if (!validation.passed) process.exitCode = 2;
