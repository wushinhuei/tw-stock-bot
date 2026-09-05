'use strict';

const crypto = require('node:crypto');
const { DriveHistorySource } = require('../src/drive_history');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { MopsMcpHistory, conservativeQuarterAvailability } = require('../src/mops_mcp_history');

const DEFAULT_QUARTERS = 20;
const CORE_METRICS = Object.freeze([
  'revenue', 'operating_income', 'net_income', 'eps', 'assets', 'liabilities', 'equity',
  'cash', 'operating_cash_flow', 'capital_expenditure', 'current_assets', 'current_liabilities',
  'noncurrent_liabilities', 'operating_expenses'
]);
const FLOW_METRICS = Object.freeze(new Set([
  'revenue', 'operating_income', 'net_income', 'eps', 'operating_cash_flow',
  'capital_expenditure', 'operating_expenses'
]));
const INSTANT_METRICS = Object.freeze(new Set([
  'assets', 'liabilities', 'equity', 'cash', 'current_assets', 'current_liabilities',
  'noncurrent_liabilities'
]));

function normalizeSymbol(value) {
  const match = String(value || '').match(/\b\d{4}\b/);
  return match ? match[0] : '';
}

function activeTop100Symbols(universeRows, options = {}) {
  const requested = new Set((options.requestedSymbols || []).map(normalizeSymbol).filter(Boolean));
  let symbols = [...new Set((universeRows || [])
    .filter(row => row.active_top100 === true && /^[1-9]\d{3}$/.test(normalizeSymbol(row.stock_code || row.symbol))
      && !/^91/.test(normalizeSymbol(row.stock_code || row.symbol)) && !/-DR\b/i.test(String(row.stock_name || '')))
    .map(row => normalizeSymbol(row.stock_code || row.symbol)).filter(Boolean))].sort();
  if (requested.size) symbols = symbols.filter(symbol => requested.has(symbol));
  const limit = Number(options.limit || 0);
  if (Number.isInteger(limit) && limit > 0) symbols = symbols.slice(0, limit);
  return symbols;
}

function quarterKey(year, quarter) { return `${year}Q${quarter}`; }

function quarterEndDate(year, quarter) {
  return new Date(Date.UTC(Number(year), Number(quarter) * 3, 0)).toISOString().slice(0, 10);
}

function quarterStartDate(year, quarter) {
  return `${Number(year)}-${String((Number(quarter) - 1) * 3 + 1).padStart(2, '0')}-01`;
}

function previousQuarter(year, quarter) {
  return Number(quarter) === 1
    ? { year: Number(year) - 1, quarter: 4, key: quarterKey(Number(year) - 1, 4) }
    : { year: Number(year), quarter: Number(quarter) - 1, key: quarterKey(year, Number(quarter) - 1) };
}

function selectFact(facts) {
  return [...facts].sort((a, b) =>
    String(a.concept || '').localeCompare(String(b.concept || ''))
    || String(a.context_ref || '').localeCompare(String(b.context_ref || ''))
  )[0] || null;
}

function normalizedMetric(value, basis, fact, cumulativeFact = null) {
  return {
    value: value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null,
    basis,
    cumulative_value: cumulativeFact && Number.isFinite(Number(cumulativeFact.value)) ? Number(cumulativeFact.value) : null,
    concept: fact?.concept || cumulativeFact?.concept || '',
    context_ref: fact?.context_ref || cumulativeFact?.context_ref || '',
    start_date: fact?.start_date || cumulativeFact?.start_date || '',
    end_date: fact?.end_date || cumulativeFact?.end_date || '',
    instant: fact?.instant || cumulativeFact?.instant || '',
    unit: fact?.unit || cumulativeFact?.unit || ''
  };
}

function normalizeQuarterlyRows(rows) {
  const cumulative = new Map();
  return [...(rows || [])]
    .sort((a, b) => Number(a.fiscal_year) - Number(b.fiscal_year)
      || Number(a.quarter) - Number(b.quarter)
      || String(a.stock_code).localeCompare(String(b.stock_code)))
    .map(row => {
      const year = Number(row.fiscal_year);
      const quarter = Number(row.quarter);
      const endDate = quarterEndDate(year, quarter);
      const startDate = quarterStartDate(year, quarter);
      const metrics = {};
      for (const metric of CORE_METRICS) {
        const facts = (row.facts || []).filter(fact => fact.metric === metric);
        if (INSTANT_METRICS.has(metric)) {
          const fact = selectFact(facts.filter(item => item.instant === endDate));
          metrics[metric] = normalizedMetric(fact?.value, fact ? 'INSTANT' : 'MISSING', fact);
          continue;
        }
        if (!FLOW_METRICS.has(metric)) continue;
        const ended = facts.filter(item => item.end_date === endDate && item.start_date);
        const direct = selectFact(ended.filter(item => item.start_date === startDate));
        const yearToDate = selectFact(ended.filter(item => item.start_date === `${year}-01-01`));
        const cumulativeKey = `${row.stock_code}:${year}:${quarter}:${metric}`;
        if (yearToDate) cumulative.set(cumulativeKey, yearToDate);
        if (direct) {
          metrics[metric] = normalizedMetric(direct.value, quarter === 1 ? 'Q1_EQUALS_YTD' : 'DIRECT_SINGLE_QUARTER', direct, yearToDate);
          continue;
        }
        if (quarter === 1 && yearToDate) {
          metrics[metric] = normalizedMetric(yearToDate.value, 'Q1_EQUALS_YTD', yearToDate, yearToDate);
          continue;
        }
        const prior = cumulative.get(`${row.stock_code}:${year}:${quarter - 1}:${metric}`);
        if (yearToDate && prior && Number.isFinite(Number(yearToDate.value)) && Number.isFinite(Number(prior.value))) {
          metrics[metric] = normalizedMetric(Number(yearToDate.value) - Number(prior.value), 'DERIVED_FROM_YTD_DIFFERENCE', yearToDate, yearToDate);
          metrics[metric].prior_cumulative_value = Number(prior.value);
          continue;
        }
        metrics[metric] = normalizedMetric(null, yearToDate ? 'CUMULATIVE_ONLY_NO_PRIOR' : 'MISSING', null, yearToDate);
      }
      const missing = CORE_METRICS.filter(metric => metrics[metric]?.value == null);
      return {
        ...row,
        normalized_metrics: metrics,
        missing_core_metrics: missing,
        metric_validation_ok: missing.length === 0,
        period_value_policy: 'INSTANT_BALANCE_SHEET; DIRECT_SINGLE_QUARTER_PREFERRED; OTHERWISE_YTD_MINUS_PRIOR_YTD'
      };
    });
}

function quarterWindow(endYear, endQuarter, count = DEFAULT_QUARTERS) {
  const rows = [];
  let year = Number(endYear);
  let quarter = Number(endQuarter);
  while (rows.length < Number(count)) {
    rows.push({ year, quarter, key: quarterKey(year, quarter) });
    quarter -= 1;
    if (quarter < 1) { quarter = 4; year -= 1; }
  }
  return rows.reverse();
}

function latestReportableQuarter(asOf = new Date()) {
  const cutoff = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(cutoff.getTime())) throw new Error(`invalid as-of time: ${asOf}`);
  const taipeiYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(cutoff));
  let latest = null;
  for (let year = taipeiYear - 2; year <= taipeiYear + 1; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const availableAt = new Date(conservativeQuarterAvailability(year, quarter));
      if (availableAt <= cutoff && (!latest || availableAt > latest.availableAt)) latest = { year, quarter, availableAt };
    }
  }
  if (!latest) throw new Error('unable to determine latest reportable quarter');
  return latest;
}

function metricCoverage(rows) {
  const counts = Object.fromEntries(CORE_METRICS.map(metric => [metric, 0]));
  for (const row of rows) {
    const present = row.normalized_metrics
      ? new Set(CORE_METRICS.filter(metric => row.normalized_metrics[metric]?.value != null))
      : new Set((row.facts || []).map(fact => fact.metric));
    for (const metric of CORE_METRICS) if (present.has(metric)) counts[metric] += 1;
  }
  return Object.fromEntries(CORE_METRICS.map(metric => [metric, {
    rows: counts[metric],
    ratio: rows.length ? Number((counts[metric] / rows.length).toFixed(4)) : 0
  }]));
}

function stableHash(values) {
  return crypto.createHash('sha256').update(values.slice().sort().join('\n')).digest('hex');
}

async function main() {
  const now = new Date();
  const asOf = process.env.MOPS_20Q_AS_OF ? new Date(process.env.MOPS_20Q_AS_OF) : now;
  if (Number.isNaN(asOf.getTime())) throw new Error(`invalid MOPS_20Q_AS_OF: ${process.env.MOPS_20Q_AS_OF}`);
  const quarterCount = Number(process.env.MOPS_20Q_COUNT || DEFAULT_QUARTERS);
  if (!Number.isInteger(quarterCount) || quarterCount < 1 || quarterCount > 40) throw new Error('MOPS_20Q_COUNT must be an integer between 1 and 40');

  const history = new DriveHistorySource();
  const universeRows = await history.analysisUniverse();
  const requestedSymbols = String(process.env.MOPS_20Q_SYMBOLS || '').split(',');
  const symbolLimit = Number(process.env.MOPS_20Q_SYMBOL_LIMIT || 0);
  const symbols = activeTop100Symbols(universeRows, { requestedSymbols, limit: symbolLimit });
  if (!symbols.length) throw new Error('analysis universe is empty');

  const latest = latestReportableQuarter(asOf);
  const window = quarterWindow(latest.year, latest.quarter, quarterCount);
  const supportQuarter = previousQuarter(window[0].year, window[0].quarter);
  const fetchWindow = [supportQuarter, ...window];
  const byYear = new Map();
  for (const item of fetchWindow) {
    if (!byYear.has(item.year)) byYear.set(item.year, []);
    byYear.get(item.year).push(item.quarter);
  }

  const mcp = new MopsMcpHistory({ allowPublicFallback: true });
  const writer = new DrivePrimaryWriter({
    parentFolderId: process.env.MOPS_20Q_DRIVE_PARENT_FOLDER_ID || '1oNlmeY46SpjBoZCUUlLCGGu8AV1W-knd',
    folderName: process.env.MOPS_20Q_DRIVE_FOLDER_NAME || '20Q_MCP_PRIMARY'
  });

  const rawRows = [];
  for (const [year, quarters] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    // Bulk archive parsing is implemented by the MOPS MCP history provider. One official XBRL archive
    // is downloaded per requested quarter and filtered to the current analysis universe.
    rawRows.push(...await mcp.publicQuarterlyFinancials(year, { quarters: [...new Set(quarters)], symbols }));
  }
  const normalizedRows = normalizeQuarterlyRows(rawRows.map(row => ({
    ...row,
    available_from: row.available_from || conservativeQuarterAvailability(row.fiscal_year, row.quarter),
    timing_policy: row.timing_policy || 'CONSERVATIVE_STATUTORY_DEADLINE_PLUS_ONE_DAY',
    provider: 'MOPS_MCP'
  })));

  const summaries = [];
  for (const item of window) {
      const { year, quarter } = item;
      const quarterRows = normalizedRows.filter(row => Number(row.fiscal_year) === year && Number(row.quarter) === quarter);
      if (!quarterRows.length) throw new Error(`MOPS MCP returned no rows for ${quarterKey(year, quarter)}`);
      const reportedSymbols = new Set(quarterRows.map(row => normalizeSymbol(row.stock_code)).filter(Boolean));
      const summary = {
        quarter: quarterKey(year, quarter), year, fiscalQuarter: quarter,
        records: quarterRows.length,
        reportedSymbols: reportedSymbols.size,
        universeSymbols: symbols.length,
        unreportedUniverseSymbols: symbols.filter(symbol => !reportedSymbols.has(symbol)),
        metricCoverage: metricCoverage(quarterRows)
      };
      const filename = `quarterly_financials_${year}Q${quarter}.jsonl`;
      const body = `${quarterRows.map(row => JSON.stringify(row)).join('\n')}\n`;
      const saved = await writer.upsertText(filename, body, 'application/x-ndjson');
      summary.driveFileId = saved.id;
      summary.filename = filename;
      summaries.push(summary);
      process.stdout.write(`${JSON.stringify({ event: 'mops-20q-quarter', ...summary, unreportedUniverseSymbols: summary.unreportedUniverseSymbols.length })}\n`);
  }

  const totalRecords = summaries.reduce((sum, item) => sum + item.records, 0);
  const presentMetricCells = summaries.reduce((sum, item) => sum + CORE_METRICS.reduce((metricSum, metric) => metricSum + Number(item.metricCoverage[metric]?.rows || 0), 0), 0);
  const expectedMetricCells = totalRecords * CORE_METRICS.length;
  const metricValidation = {
    status: presentMetricCells === expectedMetricCells ? 'complete' : 'incomplete',
    requiredMetricCount: CORE_METRICS.length,
    requiredMetrics: CORE_METRICS,
    totalRecords,
    expectedMetricCells,
    presentMetricCells,
    missingMetricCells: expectedMetricCells - presentMetricCells,
    byMetric: Object.fromEntries(CORE_METRICS.map(metric => {
      const present = summaries.reduce((sum, item) => sum + Number(item.metricCoverage[metric]?.rows || 0), 0);
      return [metric, { expected: totalRecords, present, missing: totalRecords - present }];
    }))
  };

  const manifest = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    asOf: asOf.toISOString(),
    status: summaries.length === quarterCount && metricValidation.status === 'complete' ? 'complete' : 'incomplete',
    sourcePolicy: 'MOPS_MCP_PRIMARY',
    sourceProvider: 'MOPS official XBRL archive through MopsMcpHistory bulk provider',
    timingPolicy: 'Exact filing availability when present; otherwise conservative statutory deadline plus one day',
    universeSource: 'Google Drive analysis_universe.jsonl where active_top100=true',
    universeSymbols: symbols.length,
    universeSha256: stableHash(symbols),
    quarterCount,
    startQuarter: window[0].key,
    endQuarter: window.at(-1).key,
    latestReportableQuarter: quarterKey(latest.year, latest.quarter),
    quarters: summaries,
    coreMetrics: CORE_METRICS,
    metricValidation,
    periodValuePolicy: 'Balance-sheet metrics use quarter-end instants. Flow metrics prefer direct single-quarter contexts; cumulative YTD values are differenced against prior-quarter YTD.'
  };
  const savedManifest = await writer.upsertText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: manifest.status === 'complete', event: 'mops-20q-complete', status: manifest.status,
    startQuarter: manifest.startQuarter, endQuarter: manifest.endQuarter, quarterCount: summaries.length,
    universeSymbols: symbols.length, metricValidation, manifestDriveFileId: savedManifest.id
  }, null, 2)}\n`);
  if (manifest.status !== 'complete') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = {
  CORE_METRICS, FLOW_METRICS, INSTANT_METRICS, activeTop100Symbols, latestReportableQuarter, metricCoverage,
  normalizeQuarterlyRows, previousQuarter, quarterEndDate, quarterKey, quarterStartDate, quarterWindow, stableHash
};
