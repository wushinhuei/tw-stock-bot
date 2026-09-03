'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { auditQ2BacktestReadiness } = require('../src/q2_backtest_readiness');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'data/backtest/q2-readiness');
const report = auditQ2BacktestReadiness({
  root: process.env.BACKTEST_ROOT || 'data/backtest',
  twseDir: process.env.TWSE_Q2_DIR,
  pitDir: process.env.Q2_PIT_DIR,
  mopsDir: process.env.Q2_MOPS_DIR,
  intradayDir: process.env.Q2_INTRADAY_DIR
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'readiness.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.targetReached) process.exitCode = 2;
