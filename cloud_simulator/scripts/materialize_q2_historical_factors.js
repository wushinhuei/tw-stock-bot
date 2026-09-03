'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { materializeHistoricalFactors } = require('../src/q2_historical_factors');

const ROOT = path.resolve(process.env.Q2_BACKTEST_ROOT || 'data/backtest');
const DIR = path.join(ROOT, 'q2-mops-point-in-time');
const INPUT = path.join(DIR, 'q2_pit_with_mops.jsonl');
const OUTPUT = path.join(DIR, 'q2_pit_with_factors.jsonl');
const MANIFEST = path.join(DIR, 'historical_factors_manifest.json');
const BLOCKERS = path.join(DIR, 'historical_factor_blockers.jsonl');

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`missing input: ${file}`);
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const rows = readJsonl(INPUT).map(materializeHistoricalFactors);
  const blockers = rows.filter(row => !row.historicalFactors?.complete).map(row => ({
    tradeDate: row.tradeDate,
    symbol: row.symbol,
    fundamentalMissing: row.historicalFactors?.fundamentalScore == null,
    officialNewsMissing: row.historicalFactors?.officialNewsScore == null,
    pointInTimeAsOf: row.historicalFactors?.pointInTimeAsOf
  }));
  const complete = rows.length - blockers.length;
  const manifest = {
    generatedAt: new Date().toISOString(),
    period: { start: '2026-04-01', end: '2026-06-30' },
    sourcePolicy: 'TWSE_MCP_PRIMARY + MOPS_OFFICIAL; no inferred or future factor values',
    input: path.basename(INPUT),
    output: path.basename(OUTPUT),
    replayInput: path.basename(INPUT),
    rows: rows.length,
    completeRows: complete,
    blockerRows: blockers.length,
    completionPct: rows.length ? Math.round((complete / rows.length) * 10000) / 100 : 0,
    strict: true,
    status: blockers.length ? 'BLOCKED_MISSING_EXPLICIT_HISTORICAL_FACTORS' : 'COMPLETE'
  };
  // Keep a dedicated factor artifact and also enrich the generated replay dataset in place.
  // build_q2_mops_point_in_time.js recreates INPUT on every pipeline run, so this never mutates source archives.
  writeJsonl(OUTPUT, rows);
  writeJsonl(INPUT, rows);
  writeJsonl(BLOCKERS, blockers);
  writeJson(MANIFEST, manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (blockers.length) process.exitCode = 2;
}

if (require.main === module) main();
