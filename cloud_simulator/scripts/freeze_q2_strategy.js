'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FILES = Object.freeze([
  'cloud_simulator/src/config.js',
  'cloud_simulator/src/scoring.js',
  'cloud_simulator/src/indicators.js',
  'cloud_simulator/src/chip.js',
  'cloud_simulator/src/scanner.js',
  'cloud_simulator/src/strategies.js',
  'cloud_simulator/src/engine.js'
]);

const OUTPUT = path.resolve(process.env.Q2_STRATEGY_SNAPSHOT || 'data/backtest/2026Q2/frozen_strategy.json');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function buildSnapshot(root = process.cwd()) {
  const files = FILES.map(relative => {
    const absolute = path.resolve(root, relative);
    const content = fs.readFileSync(absolute, 'utf8');
    return { path: relative, sha256: sha256(content), bytes: Buffer.byteLength(content) };
  });
  const aggregate = sha256(files.map(file => `${file.path}:${file.sha256}`).join('\n'));
  return {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    period: { start: '2026-04-01', end: '2026-06-30' },
    policy: {
      purpose: 'Replay 2026Q2 using the strategy rules that existed before observing the backtest result.',
      predictionForbidden: true,
      parameterTuningAfterResultForbidden: true,
      futureLeakageForbidden: true,
      sourcePolicy: 'TWSE_MCP_PRIMARY; Google Drive cache; other providers only when TWSE has no dataset.'
    },
    files,
    aggregateSha256: aggregate
  };
}

function main() {
  const snapshot = buildSnapshot();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output: OUTPUT, aggregateSha256: snapshot.aggregateSha256 }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { FILES, buildSnapshot, sha256 };
