'use strict';

const crypto = require('node:crypto');
const { DriveHistorySource } = require('../src/drive_history');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { MopsMcpHistory, conservativeQuarterAvailability } = require('../src/mops_mcp_history');

const DEFAULT_QUARTERS = 20;
const CORE_METRICS = Object.freeze([
  'revenue', 'operating_income', 'net_income', 'eps', 'assets', 'liabilities', 'equity',
  'cash', 'operating_cash_flow', 'capital_expenditure', 'current_assets', 'current_liabilities'
]);

function normalizeSymbol(value) {
  const match = String(value || '').match(/\b\d{4}\b/);
  return match ? match[0] : '';
}

function quarterKey(year, quarter) { return `${year}Q${quarter}`; }

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
    const present = new Set((row.facts || []).map(fact => fact.metric));
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
  const symbols = [...new Set(universeRows.map(row => normalizeSymbol(row.stock_code || row.symbol)).filter(Boolean))].sort();
  if (!symbols.length) throw new Error('analysis universe is empty');

  const latest = latestReportableQuarter(asOf);
  const window = quarterWindow(latest.year, latest.quarter, quarterCount);
  const byYear = new Map();
  for (const item of window) {
    if (!byYear.has(item.year)) byYear.set(item.year, []);
    byYear.get(item.year).push(item.quarter);
  }

  const mcp = new MopsMcpHistory({ allowPublicFallback: true });
  const writer = new DrivePrimaryWriter({
    parentFolderId: process.env.MOPS_20Q_DRIVE_PARENT_FOLDER_ID || '1oNlmeY46SpjBoZCUUlLCGGu8AV1W-knd',
    folderName: process.env.MOPS_20Q_DRIVE_FOLDER_NAME || '20Q_MCP_PRIMARY'
  });

  const summaries = [];
  for (const [year, quarters] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    // Bulk archive parsing is implemented by the MOPS MCP history provider. One official XBRL archive
    // is downloaded per requested quarter and filtered to the current analysis universe.
    const rows = await mcp.publicQuarterlyFinancials(year, { quarters, symbols });
    for (const quarter of quarters) {
      const quarterRows = rows.filter(row => Number(row.fiscal_year) === year && Number(row.quarter) === quarter)
        .map(row => ({
          ...row,
          available_from: row.available_from || conservativeQuarterAvailability(year, quarter),
          timing_policy: row.timing_policy || 'CONSERVATIVE_STATUTORY_DEADLINE_PLUS_ONE_DAY',
          provider: 'MOPS_MCP'
        }));
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
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    asOf: asOf.toISOString(),
    status: summaries.length === quarterCount ? 'complete' : 'incomplete',
    sourcePolicy: 'MOPS_MCP_PRIMARY',
    sourceProvider: 'MOPS official XBRL archive through MopsMcpHistory bulk provider',
    timingPolicy: 'Exact filing availability when present; otherwise conservative statutory deadline plus one day',
    universeSource: 'Google Drive analysis_universe.jsonl',
    universeSymbols: symbols.length,
    universeSha256: stableHash(symbols),
    quarterCount,
    startQuarter: window[0].key,
    endQuarter: window.at(-1).key,
    latestReportableQuarter: quarterKey(latest.year, latest.quarter),
    quarters: summaries,
    coreMetrics: CORE_METRICS
  };
  const savedManifest = await writer.upsertText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: manifest.status === 'complete', event: 'mops-20q-complete', status: manifest.status,
    startQuarter: manifest.startQuarter, endQuarter: manifest.endQuarter, quarterCount: summaries.length,
    universeSymbols: symbols.length, manifestDriveFileId: savedManifest.id
  }, null, 2)}\n`);
  if (manifest.status !== 'complete') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { CORE_METRICS, latestReportableQuarter, metricCoverage, quarterKey, quarterWindow, stableHash };
